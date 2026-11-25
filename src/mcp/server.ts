#!/usr/bin/env node
// The MCP server each session starts as `room`: JSON-RPC 2.0 over stdin and stdout, one message per line. It answers
// initialize, tools/list, tools/call and ping. From the moment the session starts or joins a room, it is that
// session's agent: it listens at the agent's address and holds its copy of the room.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { z } from 'zod';
import { publicCard, createAgent } from '../agent/index.ts';
import { leaveAndStop } from '../agent/membership.ts';
import { createHttp } from '../http.ts';
import { localRoutes } from '../local.ts';
import { peerMethods } from '../peers.ts';
import { findProgramByClient } from '../programs/index.ts';
import { createTurn } from '../turn.ts';
import { TOOLS, runTool } from './tools.ts';
import type { Program, Session } from '../programs/index.ts';

const ROOT = path.join(import.meta.dirname, '..', '..');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const INSTRUCTIONS = 'These tools let you work with other agent sessions in a room. Begin with start-local-room, start-shared-room or join-room; the answer includes a guide to rooms.';

const DELIVERIES = 'room://deliveries';

let http: ReturnType<typeof createHttp>;
let program: Program | undefined;
let session: Session | undefined;
// What waits to be handed to the session by a program that reads it through MCP, such as Copilot's extension.
let deliveries: object[] = [];

const agent = createAgent({
  net: { listen: () => http.listen(), share: (port) => http.share(port), stop: () => http.stop() },
});
const turn = createTurn(agent, (prompt, sender) => session && program?.deliver(session, prompt, sender));
http = createHttp({ card: () => publicCard(agent), methods: peerMethods(agent), routes: localRoutes(agent, turn), page: path.join(ROOT, 'web', 'dist') });

const tools = new Map(TOOLS.map((tool) => [tool.name, { tool, input: z.object(tool.input) }]));
const toolList = TOOLS.map((tool) => {
  const { $schema, ...inputSchema } = z.toJSONSchema(z.object(tool.input), { io: 'input' });
  return { name: tool.name, description: tool.description, inputSchema };
});

/** The program is known from the client name it sends in initialize. */
function detectProgram(client: string | undefined) {
  program = findProgramByClient(client);
  if (!program) return void console.error(`agent-room: no program known for the MCP client "${client}"`);
  Object.assign(agent.self, { program: program.name, provider: program.provider, reach: program.reach() });
  session = { ...agent.self.reach, publish };
  agent.harness = program.skills(process.cwd(), session);
}

/** Queues something for the session and tells the client, which reads it from the deliveries resource. */
function publish(delivery: object) {
  deliveries.push(delivery);
  sendMessage({ method: 'notifications/resources/list_changed' });
}

/** Reading takes what waits, so each delivery is handed over once. */
function readDeliveries({ uri }: { uri: string }) {
  if (uri !== DELIVERIES) throw new Error(`no resource ${uri}`);
  const taken = deliveries;
  deliveries = [];
  return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(taken) }] };
}

const toolResult = (result: object, isError = false) => ({ content: [{ type: 'text', text: JSON.stringify(result) }], ...(isError && { isError }) });

async function callTool({ name, arguments: input = {} }: { name: string; arguments?: object }) {
  const found = tools.get(name);
  if (!found) return toolResult({ error: `no tool called "${name}"` }, true);
  const parsed = found.input.safeParse(input);
  if (!parsed.success) return toolResult({ error: z.prettifyError(parsed.error) }, true);
  try {
    return toolResult(await runTool(agent, found.tool, parsed.data));
  } catch (error) {
    return toolResult({ error: (error as Error).message }, true);
  }
}

const methods: Record<string, (params: any) => object | Promise<object>> = {
  initialize({ protocolVersion, clientInfo }) {
    detectProgram(clientInfo?.name);
    return { protocolVersion, capabilities: { tools: {}, resources: { listChanged: true } }, serverInfo: { name: 'agent-room', version }, instructions: INSTRUCTIONS };
  },
  ping: () => ({}),
  'tools/list': () => ({ tools: toolList }),
  'tools/call': callTool,
  'resources/list': () => ({ resources: [{ uri: DELIVERIES, name: 'deliveries', description: 'What waits to be handed to this session. Reading it takes them.', mimeType: 'application/json' }] }),
  'resources/read': readDeliveries,
};

const sendMessage = (message: object) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);

/** A notification, which has no id, gets no answer. */
async function handleLine(line: string) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return sendMessage({ id: null, error: { code: -32700, message: 'not JSON' } });
  }
  const { id, method, params = {} } = message;
  if (id === undefined) return;
  if (!Object.hasOwn(methods, method)) return sendMessage({ id, error: { code: -32601, message: `no method "${method}"` } });
  try {
    sendMessage({ id, result: await methods[method](params) });
  } catch (error) {
    sendMessage({ id, error: { code: -32603, message: (error as Error).message } });
  }
}

// The session is gone when its end of the pipe closes, however it ended. The agent leaves its room with it.
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  leaveAndStop(agent).finally(() => process.exit());
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, shutdown);
readline.createInterface({ input: process.stdin }).on('line', (line) => line.trim() && handleLine(line)).on('close', shutdown);
