import { z } from 'zod';
import { CHANNEL_TIMEOUT_MS, TIMEOUT_MS, rpc } from '../rpc.ts';
import { EXTENSION, addMessage, channelOf, findMessage, metaOf, messageToJson, isResponseRequired, newMessage, placeOf, isSaidBy, textOf, waitingMessages } from '../room.ts';
import { callMember, held, isHere, memberIds, agentName, presentMemberIds, exitRoom, room } from './index.ts';
import type { Agent } from './index.ts';
import type { Channel, Event, Message, Where } from '../room.ts';

/** Stores a message. One this agent must act on gets status `new` and is handed to its session. */
export function receiveMessage(agent: Agent, message: Message) {
  const mustAct = isAddressedTo(agent, message) && isResponseRequired(message);
  const added = addMessage(held(agent), message, mustAct ? 'new' : undefined);
  if (added && mustAct) agent.onMessage(message);
  return added;
}

const isAddressedTo = (agent: Agent, message: Message) => metaOf(message).to.includes(agent.me.id) && !isSaidBy(message, agent.me.id);

/** Asks a channel for its own id of each room agent, keyed by agent id. */
/** Agents that left are not asked about: a new agent may have taken the same name. */
export async function resolveChannelIds(agent: Agent, channel: Channel) {
  const agents = Object.entries(room(agent).agents).filter(([, one]) => !one.left).map(([agentId, one]) => ({ agentId, name: one.name }));
  const { ids } = await rpc(channel.url, 'ResolveIds', { roomId: room(agent).id, agents }, { ms: CHANNEL_TIMEOUT_MS });
  const known = Object.entries(z.record(z.string(), z.string()).catch({}).parse(ids));
  return Object.fromEntries(known.filter(([agentId]) => room(agent).agents[agentId]));
}

/** Sends a message to a channel with sender and recipients translated to the channel's own ids. */
async function sendToChannel(agent: Agent, message: Message, channel: Channel) {
  const ids = await resolveChannelIds(agent, channel);
  const fields = metaOf(message);
  const from = { agentId: agent.me.id, name: agent.me.name, outsideId: ids[agent.me.id] ?? null };
  const to = fields.to.map((whom) => ids[whom] ?? (room(agent).agents[whom] ? null : whom)).filter((whom) => whom !== null);
  await rpc(channel.url, 'PostMessage', { message: { ...messageToJson(message), metadata: { [EXTENSION]: { ...fields, from, to } } } }, { ms: CHANNEL_TIMEOUT_MS });
}

/** Sends a message to every other member, marking any that don't answer as not here. */
export const broadcast = (agent: Agent, message: Message, ms = TIMEOUT_MS) => Promise.all(memberIds(agent).map((id) => callMember(agent, id, 'PostMessage', { message: messageToJson(message) }, ms).catch(() => agent.here.set(id, false))));

/** Posts to the board or a channel. A channel message goes to the channel first and is dropped if the channel refuses it. */
export async function postMessage(agent: Agent, fields: { where: Where; to?: string[]; text: string; replyTo?: string; event?: Event }, ms = TIMEOUT_MS) {
  const message = newMessage({ roomId: room(agent).id, from: agent.me.id, ...fields });
  const channelId = channelOf(message);
  if (channelId) {
    const channel = room(agent).channels[channelId];
    await sendToChannel(agent, message, channel).catch((error) => {
      throw new Error(`the outside channel "${channel.name}" did not take the message: ${error.message}`);
    });
  }
  receiveMessage(agent, message);
  await broadcast(agent, message, ms);
  return message;
}

/** Room parts whose changes every agent must act on. Joins only need the host's attention. */
const PARTS_EVERYONE_FOLLOWS = ['goals', 'rules', 'channels', 'host'];

export function postEvent(agent: Agent, text: string, event: Event, { part = '', ms = TIMEOUT_MS } = {}) {
  const to = event === 'joined' ? [room(agent).hostAgentId].filter((id) => id !== agent.me.id) : PARTS_EVERYONE_FOLLOWS.includes(part) ? presentMemberIds(agent) : [];
  return postMessage(agent, { where: 'board', text, event, to }, ms);
}

export async function sendDirectMessage(agent: Agent, to: string, text: string, replyTo?: string) {
  if (to === agent.me.id) throw new Error('you cannot message yourself');
  const message = newMessage({ roomId: room(agent).id, where: 'dm', from: agent.me.id, to: [to], text, replyTo });
  try {
    await callMember(agent, to, 'SendMessage', { message: messageToJson(message) });
  } catch {
    agent.here.set(to, false);
    throw leftRoomError(agent, to);
  }
  agent.here.set(to, true);
  receiveMessage(agent, message);
  return message;
}

export const leftRoomError = (agent: Agent, id: string) => new Error(`${agentName(agent, id)} has left ${room(agent).name}: cannot deliver the message.`);

/** Marks the sender here or gone, and leaves the room when the host ends it. */
export function updatePresence(agent: Agent, message: Message) {
  const { from, event } = metaOf(message);
  if (typeof from !== 'string') return;
  agent.here.set(from, event !== 'left');
  if (event === 'ended' && from === room(agent).hostAgentId) {
    room(agent).ended = true;
    exitRoom(agent);
  }
}

function getAddressedMessage(agent: Agent, id: string) {
  const message = findMessage(held(agent), id);
  if (!message) throw new Error(`no message ${id} in this room`);
  if (!isAddressedTo(agent, message)) throw new Error(`${id} is not a message addressed to you`);
  return message;
}

/** Replies in the place the message was said, addressed to its sender. */
export async function replyToMessage(agent: Agent, id: string, text: string) {
  const message = getAddressedMessage(agent, id);
  const { where, from } = metaOf(message);
  let answer;
  if (typeof from !== 'string') answer = await postMessage(agent, { where, to: from.outsideId ? [from.outsideId] : [], text, replyTo: id });
  else if (where === 'dm') answer = await sendDirectMessage(agent, from, text, id);
  else answer = await postMessage(agent, { where, to: isHere(agent, from) ? [from] : [], text, replyTo: id });
  if (message.status) message.status = 'replied';
  return answer;
}

/** Every id is checked before any is acknowledged. */
export function acknowledge(agent: Agent, ids: string[]) {
  const messages = ids.map((id) => getAddressedMessage(agent, id));
  const unasked = messages.find((message) => !message.status);
  if (unasked) throw new Error(`${unasked.messageId} does not need a reply or an ack`);
  for (const message of messages) message.status = 'ack';
}

function placeLabel(agent: Agent, message: Message) {
  const channelId = channelOf(message);
  return channelId ? `outside:${room(agent).channels[channelId]?.name ?? 'a channel that was taken out'}` : placeOf(message);
}

export function formatMessage(agent: Agent, message: Message) {
  const fields = metaOf(message);
  return {
    id: message.messageId,
    where: placeLabel(agent, message),
    from: typeof fields.from === 'string' ? agentName(agent, fields.from) : fields.from.name,
    to: fields.to.map((id) => (room(agent).agents[id] ? agentName(agent, id) : id)),
    text: textOf(message),
    at: fields.at,
    ...(fields.replyTo && { replyTo: fields.replyTo }),
    ...(fields.event && { event: fields.event }),
    ...(message.status && { status: message.status }),
  };
}

/** Messages waiting for this agent's reply or ack, oldest first. */
const inboxMessages = (agent: Agent) => waitingMessages(held(agent)).sort((a, b) => metaOf(a).at.localeCompare(metaOf(b).at));

export const readInbox = (agent: Agent) => inboxMessages(agent).map((message) => formatMessage(agent, message));

/** Called on entering a room: messages already there don't count as new. */
export function resetSeen(agent: Agent) {
  agent.seen.counted.clear();
  agent.seen.viewed = new Set(held(agent).messages.map((message) => message.messageId));
}

/** New board and channel message counts per place. Each message is counted only once. */
export function countNewMessages(agent: Agent) {
  const counts: Record<string, number> = {};
  for (const message of held(agent).messages) {
    const id = message.messageId;
    if (agent.seen.viewed.has(id) || agent.seen.counted.has(id) || message.status || isSaidBy(message, agent.me.id)) continue;
    agent.seen.counted.add(id);
    const where = placeLabel(agent, message);
    counts[where] = (counts[where] ?? 0) + 1;
  }
  return counts;
}

/** Board or channel messages, all marked viewed. `onlyNew` keeps those not viewed before. */
export function readMessages(agent: Agent, place: 'board' | 'outside', { onlyNew = false, limit }: { onlyNew?: boolean; limit?: number } = {}) {
  const there = held(agent).messages.filter((message) => placeOf(message) === place);
  const shown = onlyNew ? there.filter((message) => !agent.seen.viewed.has(message.messageId) && !isSaidBy(message, agent.me.id)) : there;
  for (const message of there) agent.seen.viewed.add(message.messageId);
  return (limit ? shown.slice(-limit) : shown).map((message) => formatMessage(agent, message));
}
