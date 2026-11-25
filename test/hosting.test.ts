import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkOf, makeAgent } from './helpers.ts';
import { syncWithHost, joinRoom, leaveAndStop, startRoom } from '../src/agent/membership.ts';
import { handOverRoom, removeAgent } from '../src/agent/hosting.ts';
import { isHost } from '../src/agent/index.ts';
import { postMessage } from '../src/agent/messages.ts';
import { textOf } from '../src/room.ts';

async function threeInARoom() {
  const [a, b, c] = [makeAgent(), makeAgent(), makeAgent()];
  await startRoom(a, { room: 'R', goal: 'g', name: 'A' });
  await joinRoom(b, { link: linkOf(a), name: 'B' });
  await joinRoom(c, { link: linkOf(a), name: 'C' });
  return [a, b, c];
}

test('the host hands the room to another agent', async () => {
  const [a, b, c] = await threeInARoom();
  await handOverRoom(a, b.me.id);
  await syncWithHost(c);
  assert.equal(isHost(b), true);
  assert.equal(c.held?.room.hostAgentId, b.me.id);
  await postMessage(c, { where: 'board', text: 'still here' });
  assert.ok(b.held?.messages.some((one) => textOf(one) === 'still here'));
  await leaveAndStop(c);
  await leaveAndStop(a);
  await leaveAndStop(b);
});

test('removing an agent changes the room key and shuts it out', async () => {
  const [a, b, c] = await threeInARoom();
  const old = b.key;
  await removeAgent(a, c.me.id);
  await syncWithHost(b);
  assert.notEqual(b.key, old);
  await syncWithHost(c);
  assert.equal(c.removed, true);
  await leaveAndStop(b);
  await leaveAndStop(c);
  await leaveAndStop(a);
});
