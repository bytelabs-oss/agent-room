#!/usr/bin/env node
// Run at every turn end: may the turn end? Each program runs this in every session, and most sessions have no
// agent. A hook never stands in the way: on any failure the session goes on as if agent-room were not installed.

import fs from 'node:fs';
import { findSessionAgent, ancestors } from './registry.ts';
import { postLocal } from './rpc.ts';

const STOP_MS = 10_000;

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const agent = findSessionAgent(ancestors(process.ppid), input.sessionId ?? input.session_id);
  if (agent) {
    const { block } = await postLocal(`http://127.0.0.1:${agent.port}`, '/hook/stop', {}, STOP_MS);
    if (block) console.log(JSON.stringify({ decision: 'block', reason: block }));
  }
} catch (error) {
  console.error(`agent-room hook: ${(error as Error).message}`);
}
