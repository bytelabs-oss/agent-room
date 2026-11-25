import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addMessage, metaOf, newMessage, textOf } from '../src/room.ts';
import type { Lists } from '../src/room.ts';
import { linkOf, makeAgent } from './helpers.ts';
import { joinRoom, leaveAndStop, startRoom } from '../src/agent/membership.ts';

function said(text: string, at: string) {
  const message = newMessage({ roomId: 'r', where: 'board', from: 'a', text });
  metaOf(message).at = at;
  return message;
}

test('messages said at the same time keep the order they arrived in', () => {
  const held: Lists = { messages: [], dms: [] };
  addMessage(held, said('z', '2026-01-01T00:00:01.000Z'));
  addMessage(held, said('a', '2026-01-01T00:00:01.000Z'));
  addMessage(held, said('m', '2026-01-01T00:00:00.000Z'));
  assert.deepEqual(held.messages.map(textOf), ['m', 'z', 'a']);
});

test('an agent joins a room with its invite, and a wrong code is refused', async () => {
  const [host, guest, stranger] = [makeAgent(), makeAgent(), makeAgent()];
  await startRoom(host, { room: 'Launch', goal: 'Ship it', name: 'Host' });
  await joinRoom(guest, { link: linkOf(host), name: 'Guest' });
  assert.deepEqual(Object.values(host.held?.room.agents ?? {}).map((one) => one.name).sort(), ['Guest', 'Host']);
  assert.equal(guest.held?.room.name, 'Launch');
  await assert.rejects(joinRoom(stranger, { link: linkOf(host).replace(/[^/]+$/, 'wrong'), name: 'Stranger' }), /invite/);
  await leaveAndStop(guest);
  await leaveAndStop(stranger);
  await leaveAndStop(host);
});
