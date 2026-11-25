import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { linkOf, makeAgent } from './helpers.ts';
import { joinRoom, leaveAndStop, startRoom } from '../src/agent/membership.ts';
import { acknowledge, sendDirectMessage, replyToMessage, postMessage } from '../src/agent/messages.ts';
import { messageToJson, metaOf, newMessage, waitingMessages } from '../src/room.ts';
import { Refused, rpc } from '../src/rpc.ts';

const [host, guest] = [makeAgent(), makeAgent()];

before(async () => {
  await startRoom(host, { room: 'Talk', goal: 'Talk', name: 'Host' });
  await joinRoom(guest, { link: linkOf(host), name: 'Guest' });
});
after(async () => {
  await leaveAndStop(guest);
  await leaveAndStop(host);
});

test('a board post addressed to an agent waits until it acks', async () => {
  const posted = await postMessage(host, { where: 'board', to: [guest.me.id], text: 'Review?' });
  assert.deepEqual(waitingMessages(guest.held ?? { messages: [], dms: [] }).map((one) => one.messageId), [posted.messageId]);
  acknowledge(guest, [posted.messageId]);
  assert.equal(waitingMessages(guest.held ?? { messages: [], dms: [] }).length, 0);
});

test('a reply to a DM is a DM back to its sender', async () => {
  const sent = await sendDirectMessage(host, guest.me.id, 'Private');
  const answer = await replyToMessage(guest, sent.messageId, 'Got it');
  assert.equal(metaOf(answer).where, 'dm');
  assert.equal(host.held?.dms.at(-1)?.messageId, answer.messageId);
});

test('a message without the room key is refused', async () => {
  const forged = newMessage({ roomId: host.held?.room.id ?? '', where: 'board', from: host.me.id, text: 'forged' });
  await assert.rejects(rpc(guest.self.url, 'PostMessage', { message: messageToJson(forged) }), (error) => error instanceof Refused);
});
