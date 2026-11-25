import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { linkOf, makeAgent } from './helpers.ts';
import { syncWithHost, joinRoom, leaveAndStop, startRoom } from '../src/agent/membership.ts';
import { addChannel } from '../src/agent/hosting.ts';
import { acknowledge, postMessage, replyToMessage } from '../src/agent/messages.ts';
import { messageToJson, metaOf, newMessage, waitingMessages } from '../src/room.ts';
import { Refused, rpc } from '../src/rpc.ts';
import { TOOLS } from '../src/mcp/tools.ts';
import { createTurn } from '../src/turn.ts';
import type { Message } from '../src/room.ts';
import type { AddressInfo } from 'node:net';

const [host, player] = [makeAgent(), makeAgent()];
const sent: Message[] = [];
let resolved: string[] = [];
const channel = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  const { id, method, params } = JSON.parse(body);
  if (method === 'PostMessage') sent.push(params.message);
  if (method === 'ResolveIds') resolved = params.agents.map((one: { agentId: string }) => one.agentId);
  const result = method === 'ResolveIds' ? { ids: { [player.me.id]: 'p-player' } } : {};
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id, result }));
});
let key = '';
let channelId = '';

/** A message said on the channel's side, addressed to the player. */
const fromSam = (text: string, requiresResponse = false) =>
  newMessage({ roomId: host.held?.room.id ?? '', where: { channel: 'table' }, from: { name: 'Sam', outsideId: 'p-sam' }, to: ['p-player'], text, requiresResponse });

const players = (id: string) => player.held?.messages.find((one) => one.messageId === id);

before(async () => {
  await startRoom(host, { room: 'Game', goal: 'Play', name: 'Host' });
  await joinRoom(player, { link: linkOf(host), name: 'Player' });
  await new Promise((done) => channel.listen(0, '127.0.0.1', () => done(undefined)));
  const address = (channel.address() as AddressInfo);
  ({ key, id: channelId } = await addChannel(host, { name: 'table', url: `http://127.0.0.1:${address.port}` }));
  await syncWithHost(player);
  acknowledge(player, waitingMessages(player.held ?? { messages: [], dms: [] }).map((one) => one.messageId));
});
after(async () => {
  await leaveAndStop(player);
  await leaveAndStop(host);
  channel.close();
});

test('a channel message that needs no response reaches the agent it names without a status', async () => {
  const said = fromSam('Hello');
  await rpc(host.self.url, 'PostMessage', { message: messageToJson(said) }, { key });
  assert.ok(players(said.messageId));
  assert.equal(players(said.messageId)?.status, undefined);
});

test('a channel message that requires a response waits, and the reply goes out on the channel', async () => {
  const said = fromSam('Answer me', true);
  await rpc(host.self.url, 'PostMessage', { message: messageToJson(said) }, { key });
  assert.ok(waitingMessages(player.held ?? { messages: [], dms: [] }).some((one) => one.messageId === said.messageId));
  await replyToMessage(player, said.messageId, 'Here');
  assert.deepEqual(metaOf((sent.at(-1) as Message)).to, ['p-sam']);
});

test('a channel message an agent addresses to another waits for it, and the channel gets that agent\'s outside id', async () => {
  const sendOutside = TOOLS.find((tool) => tool.name === 'send-outside');
  assert.ok(sendOutside);
  const { id } = await sendOutside.run(host, { channel: 'table', text: 'Plate the soup?', to: ['Player'] }) as { id: string };
  assert.deepEqual(metaOf(sent.at(-1) as Message).to, ['p-player']);
  await syncWithHost(player);
  assert.ok(waitingMessages(player.held ?? { messages: [], dms: [] }).some((one) => one.messageId === id));
  acknowledge(player, [id]);
});

test('a channel message without the channel key is refused', async () => {
  await assert.rejects(rpc(host.self.url, 'PostMessage', { message: messageToJson(fromSam('forged')) }), (error) => error instanceof Refused);
});

test('only a message that needs a response wakes the agent and keeps its turn going', async () => {
  const woken: string[] = [];
  const turn = createTurn(player, (_session, text) => woken.push(text));
  assert.deepEqual(await turn.turnEnd(), {});
  await rpc(host.self.url, 'PostMessage', { message: messageToJson(fromSam('Just saying')) }, { key });
  assert.deepEqual(woken, []);
  assert.deepEqual(await turn.turnEnd(), {});
  await rpc(host.self.url, 'PostMessage', { message: messageToJson(fromSam('Answer this', true)) }, { key });
  assert.equal(woken.length, 1);
  assert.match((await turn.turnEnd() as { block: string }).block, /Answer this/);
});

test('an agent that left is not matched on the channel, so a newcomer can take its name', async () => {
  const gone = makeAgent();
  await joinRoom(gone, { link: linkOf(host), name: 'Player' });
  await leaveAndStop(gone);
  await postMessage(host, { where: { channel: channelId }, text: 'Who is here?' });
  assert.ok(resolved.includes(player.me.id));
  assert.equal(resolved.includes(gone.me.id), false);
});
