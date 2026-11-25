import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHttp } from '../src/http.ts';
import { createAgent, publicCard } from '../src/agent/index.ts';
import { joinInstruction } from '../src/agent/hosting.ts';
import { peerMethods } from '../src/peers.ts';
import type { Agent, SkillHost } from '../src/agent/index.ts';

process.env.AGENT_ROOM_DIR = mkdtempSync(path.join(tmpdir(), 'agent-room-test-'));

/** A real agent on a localhost port, with no session. */
export function makeAgent(harness?: SkillHost) {
  let http: ReturnType<typeof createHttp>;
  const agent = createAgent({ net: { listen: () => http.listen(), share: (port) => http.share(port), stop: () => http.stop() }, harness });
  http = createHttp({ card: () => publicCard(agent), methods: peerMethods(agent), routes: { get: {}, post: {} }, page: '' });
  return agent;
}

/** The link in a host's invite. */
export const linkOf = (host: Agent) => joinInstruction(host).replace('join room at ', '');
