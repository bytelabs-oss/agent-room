import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { after, test } from 'node:test';
import { linkOf, makeAgent } from './helpers.ts';
import { leaveAndStop, startRoom } from '../src/agent/membership.ts';
import { sendDirectMessage } from '../src/agent/messages.ts';

const server = spawn(process.execPath, [path.join(import.meta.dirname, '..', 'src', 'mcp', 'server.ts')], {
  env: { ...process.env, AGENT_ROOM_DIR: mkdtempSync(path.join(tmpdir(), 'agent-room-mcp-')) },
  stdio: ['pipe', 'pipe', 'ignore'],
});
const answers: Map<number, (message: any) => void> = new Map();
const notificationWaiters: ((method: string) => void)[] = [];
readline.createInterface({ input: server.stdout }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) for (const resolve of notificationWaiters.splice(0)) resolve(message.method);
  else answers.get(message.id)?.(message);
});
const nextNotification = () => new Promise<string>((resolve) => notificationWaiters.push(resolve));
let next = 0;
function request(method: string, params: object = {}): Promise<any> {
  const id = ++next;
  server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return new Promise((resolve) => answers.set(id, resolve));
}
after(() => server.kill());

test('initialize, then list the tools with a JSON Schema for each input', async () => {
  const { result } = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'copilot-cli', version: '1' } });
  assert.equal(result.protocolVersion, '2025-06-18');
  assert.deepEqual(result.capabilities, { tools: {}, resources: { listChanged: true } });
  const { result: listed } = await request('tools/list');
  const start = listed.tools.find((tool: any) => tool.name === 'start-local-room');
  assert.deepEqual(start.inputSchema.required, ['room', 'goal']);
});

test('a tool call with input that does not fit is an error result, not a crash', async () => {
  const { result } = await request('tools/call', { name: 'start-local-room', arguments: { goal: 'no room name' } });
  assert.equal(result.isError, true);
  const { result: outside } = await request('tools/call', { name: 'view-inbox', arguments: {} });
  assert.match(JSON.parse(outside.content[0].text).error, /start a room/);
});

test('a message for the agent is published as a delivery, and one read takes it', async () => {
  const host = makeAgent();
  await startRoom(host, { room: 'R', goal: 'g', name: 'Host' });
  const { result } = await request('tools/call', { name: 'join-room', arguments: { link: linkOf(host), name: 'Guest' } });
  const guestId = JSON.parse(result.content[0].text).agents.find((one: any) => one.you).id;
  const notified = nextNotification();
  await sendDirectMessage(host, guestId, 'hello');
  assert.equal(await notified, 'notifications/resources/list_changed');
  const read = async () => JSON.parse((await request('resources/read', { uri: 'room://deliveries' })).result.contents[0].text);
  const [delivery] = await read();
  assert.match(delivery.prompt, /hello/);
  assert.deepEqual(await read(), []);
  await leaveAndStop(host);
});
