// What only the host does. A member's own card and shared skills are its own: it hands them to the host, which tells
// the rest.

import { QUICK_TIMEOUT_MS, Refused, SLOW_TIMEOUT_MS, rpc } from '../rpc.ts';
import { extensionOf, cardToJson, messageToJson, messagesMissingFrom, newId, removeItem, roomToJson, setItem } from '../room.ts';
import { canInvite, inviteToNetwork, listPendingInvites } from '../tailscale.ts';
import { cardAddress, callMember, buildCard, checkPresence, newSecret, registerAgent, held, requireHost, isHost, memberIds, agentName, room, isSameSecret } from './index.ts';
import { leftRoomError, postEvent } from './messages.ts';
import type { Agent } from './index.ts';
import type { Card, Part, Room } from '../room.ts';

export const joinInstruction = (agent: Agent) => `join room at ${agent.self.url}/r/${requireHost(agent).invite}`;

export function renewInvite(agent: Agent) {
  requireHost(agent).invite = newSecret();
}

/** Members sync with the host when told the room changed. */
const notifyRoomChanged = (agent: Agent) => {
  for (const id of memberIds(agent)) callMember(agent, id, 'NotifyRoomChanged', { roomId: room(agent).id }, QUICK_TIMEOUT_MS).catch(() => {});
};

export function admitAgent(agent: Agent, given: string, theirs: Card) {
  const agentId = extensionOf(theirs)?.agentId;
  if (!agent.inRoom || !agent.hosted || !isSameSecret(given, agent.hosted.invite)) throw new Refused('that invite is not for a room at this address');
  if (!agentId || agentId === agent.me.id) throw new Refused('that card is not another agent');
  const token = newSecret();
  agent.hosted.tokens.set(agentId, token);
  setItem(room(agent), 'agents', theirs, agentId);
  agent.here.set(agentId, true);
  registerAgent(agent);
  notifyRoomChanged(agent);
  return { room: roomToJson(room(agent)), messages: held(agent).messages.map(messageToJson), token, key: agent.key };
}

export function verifyMember(agent: Agent, roomId: string, agentId: string, token: string | null) {
  if (agent.inRoom && !agent.hosted && roomId === room(agent).id) throw new Refused(`${agentName(agent, room(agent).hostAgentId)} hosts this room now`, { host: room(agent).hostAgentId });
  if (!agent.inRoom || !agent.hosted || roomId !== room(agent).id) throw new Refused('no room with that id is hosted at this address');
  if (!isSameSecret(token, agent.hosted.tokens.get(agentId))) throw new Refused('that agent is not in this room', 'removed');
}

/** Returns the room, the messages the member lacks, the ids the host lacks, and the room key. */
export function answerSync(agent: Agent, agentId: string, have: string[], leaving: boolean) {
  if (leaving) {
    requireHost(agent).tokens.delete(agentId);
    const theirs = room(agent).agents[agentId];
    if (theirs) theirs.left = true;
  }
  agent.here.set(agentId, !leaving);
  const has = new Set(held(agent).messages.map((message) => message.messageId));
  return { room: roomToJson(room(agent)), messages: messagesMissingFrom(held(agent), have).map(messageToJson), want: have.filter((id) => !has.has(id)), key: agent.key };
}

export function setMemberItem(agent: Agent, agentId: string, part: 'agents' | 'skills', item: any) {
  if (part === 'skills' && Object.values(room(agent).skills).some((had) => had.name === item.name && had.id !== item.id)) throw new Refused(`the room already has a skill called "${item.name}"`);
  setItem(room(agent), part, item, part === 'agents' ? agentId : item.id);
  registerAgent(agent);
  notifyRoomChanged(agent);
}

/** A member's own items go through the host, which refuses duplicates and tells the rest. */
export async function setOwnItem(agent: Agent, part: 'agents' | 'skills', item: any) {
  if (isHost(agent) || !agent.host) return setMemberItem(agent, agent.me.id, part, item);
  await rpc(agent.host.address, 'SetMemberItem', { roomId: room(agent).id, agentId: agent.me.id, part, item: part === 'agents' ? cardToJson(item) : item }, { key: agent.host.token }).catch((error) => {
    throw error instanceof Refused ? error : new Error(`${agentName(agent, room(agent).hostAgentId)}, the host, did not answer, so the room was not changed. Try again.`);
  });
  setItem(room(agent), part, item, part === 'agents' ? agent.me.id : item.id);
  registerAgent(agent);
}

export async function setCard(agent: Agent, { name, description, skills }: { name?: string; description?: string; skills?: string[] }) {
  const mine = agent.me.skills ?? [];
  if (skills) {
    const unknown = skills.find((wanted) => !mine.some((skill) => skill.name === wanted));
    if (unknown) throw new Error(`your program has no skill called "${unknown}". It has: ${mine.map((skill) => skill.name).join(', ') || 'none'}`);
  }
  const was = { name: agent.me.name, description: agent.me.description, shown: mine.filter((skill) => skill.onCard).map((skill) => skill.name) };
  const applyCard = (one: { name: string; description: string; shown: string[] }) => {
    Object.assign(agent.me, { name: one.name, description: one.description });
    for (const skill of mine) skill.onCard = one.shown.includes(skill.name);
  };
  applyCard({ name: name || was.name, description: description ?? was.description, shown: skills ?? was.shown });
  await setOwnItem(agent, 'agents', buildCard(agent)).catch((error) => {
    applyCard(was);
    throw error;
  });
}

export async function changeRoom(agent: Agent, part: string, text: string, edit: (room: Room) => void) {
  requireHost(agent);
  edit(room(agent));
  registerAgent(agent);
  await postEvent(agent, text, 'updated', { part });
  notifyRoomChanged(agent);
}

/** The returned key is what the channel shows when it hands the host a message. */
export async function addChannel(agent: Agent, { name, url }: { name: string; url: string }) {
  requireHost(agent);
  if (Object.values(room(agent).channels).some((one) => one.name === name)) throw new Error(`the room already has a channel called "${name}"`);
  const channel = { id: newId(), name, url, key: newSecret() };
  await changeRoom(agent, 'channels', `connected the outside channel "${name}"`, (one) => setItem(one, 'channels', channel));
  return { id: channel.id, key: channel.key };
}

/** Its token stops working, and the room gets a new invite and key, which the others take when they sync. */
export async function removeAgent(agent: Agent, id: string) {
  if (id === agent.me.id) throw new Error('the host cannot remove itself. Leave the room to end it.');
  const hosted = requireHost(agent);
  const { name } = room(agent).agents[id];
  await postEvent(agent, `removed ${name} from the room`, 'updated');
  hosted.tokens.delete(id);
  hosted.invite = newSecret();
  agent.key = newSecret();
  room(agent).agents[id].left = true;
  agent.here.set(id, false);
  registerAgent(agent);
  notifyRoomChanged(agent);
  return name;
}

/**
 * Sends the invite, the room key and every member's host token, including a new one for this agent. Holding the tokens
 * is how the new host proves to each member that the room was handed to it.
 */
export async function handOverRoom(agent: Agent, id: string) {
  const hosted = requireHost(agent);
  if (id === agent.me.id) throw new Error('you are the host already');
  if (!(await checkPresence(agent, id))) throw leftRoomError(agent, id);
  const token = newSecret();
  const tokens = Object.fromEntries([...hosted.tokens, [agent.me.id, token]].filter(([one]) => one !== id && room(agent).agents[one] && !room(agent).agents[one].left));
  const handed = { ...room(agent), hostAgentId: id };
  await rpc(cardAddress(room(agent).agents[id]), 'HandOverRoom', { roomId: room(agent).id, room: roomToJson(handed), invite: hosted.invite, tokens, key: agent.key }, { key: hosted.tokens.get(id), ms: SLOW_TIMEOUT_MS }).catch((error) => {
    throw new Error(`${agentName(agent, id)} did not take the room, so you are still its host${error instanceof Refused ? `: ${error.message}` : '.'}`);
  });
  room(agent).hostAgentId = id;
  agent.host = { address: cardAddress(room(agent).agents[id]), token };
  agent.hosted = null;
  registerAgent(agent);
  return agentName(agent, id);
}

export async function removeFromRoom(agent: Agent, part: Part, id: string) {
  requireHost(agent);
  if (!room(agent)[part][id]) throw new Refused(`nothing with that id in the room's ${part}`);
  if (part === 'agents') return removeAgent(agent, id);
  const { name, text } = (room(agent)[part][id] as { name?: string; text?: string });
  await changeRoom(agent, part, `took the ${part.slice(0, -1)} "${name ?? text}" out of the room`, (one) => removeItem(one, part, id));
}

/** Null outside a shared room this agent hosts. */
export const canEmailInvites = (agent: Agent) => (agent.inRoom && agent.hosted && agent.self.otherMachines ? canInvite() : null);

export async function emailInvites(agent: Agent, emails: string[]) {
  requireHost(agent);
  if (!agent.self.otherMachines) throw new Refused('this room is for this machine only.');
  if (!canInvite()) throw new Refused('no Tailscale API token is saved. Run: npx github:bytelabs-oss/agent-room tailscale-key');
  return inviteToNetwork(emails).catch((error) => {
    throw new Refused(error.message);
  });
}

export const listSentInvites = async (agent: Agent) => (canEmailInvites(agent) ? listPendingInvites() : []);
