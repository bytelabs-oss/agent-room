// The room document and its messages. Messages and cards are A2A's own model; agent-room's fields sit in the
// extension's place on each. Nothing here touches the network or the disk.

import { AgentCard, Message as A2AMessage } from '@a2a-js/sdk';

export const EXTENSION = 'https://github.com/bytelabs-oss/agent-room';

export type Item = {
  id: string;
  text: string;
};

export type Skill = {
  id: string;
  /** The agent that shares it, and so the one that hands out its files. */
  agentId: string;
  name: string;
  description: string;
};

export type Channel = {
  id: string;
  name: string;
  url: string;
  /** What the channel shows when it hands the host a message. */
  key: string;
};

/** An A2A agent card, and whether the agent has left. The card stays so its messages keep its name. */
export type Card = AgentCard & { left?: boolean };

export const extensionOf = (one: { capabilities?: { extensions?: { uri: string; params?: Record<string, any> }[] } } | null | undefined): { agentId?: string; program?: string | null; roomId?: string | null } | undefined => one?.capabilities?.extensions?.find((extension) => extension.uri === EXTENSION)?.params;

export type Room = {
  id: string;
  name: string;
  hostAgentId: string;
  at: string;
  ended: boolean;
  goals: Record<string, Item>;
  rules: Record<string, Item>;
  agents: Record<string, Card>;
  skills: Record<string, Skill>;
  channels: Record<string, Channel>;
};

type Parts = { goals: Item; rules: Item; agents: Card; skills: Skill; channels: Channel };
export type Part = keyof Parts;

export type Where = 'board' | 'dm' | { channel: string };
/** An agent's id, or someone on a channel by their name and the channel's own id for them. */
export type From = string | { name: string; outsideId?: string | null };
export type Event = 'joined' | 'left' | 'updated' | 'ended';

/** agent-room's fields on a message, in its metadata under EXTENSION. */
type Meta = {
  where: Where;
  from: From;
  to: string[];
  at: string;
  replyTo?: string;
  event?: Event;
  /** Whether the agents in `to` must act on it. When left out: true on the board and in DMs, false on a channel. */
  requiresResponse?: boolean;
};

/** This agent's own state for a message it must act on: new until it replies or acks. It is never sent. */
type Status = 'new' | 'ack' | 'replied';

export type Message = A2AMessage & { status?: Status };

export type Lists = { messages: Message[]; dms: Message[] };
export type Held = Lists & { room: Room };

export const newId = () => crypto.randomUUID();
const timestamp = () => new Date().toISOString();

export function newRoom({ name, goal, hostId, card }: { name: string; goal: string; hostId: string; card: Card }): Room {
  const goalId = newId();
  return {
    id: newId(),
    name,
    hostAgentId: hostId,
    at: timestamp(),
    ended: false,
    goals: { [goalId]: { id: goalId, text: goal } },
    rules: {},
    agents: { [hostId]: card },
    skills: {},
    channels: {},
  };
}

/** Adds or replaces one item in a part of the room. A card has no id of its own, so it goes in under its agent's id. */
export function setItem<P extends Part>(room: Room, part: P, item: Parts[P], id = (item as { id: string }).id) {
  (room[part] as Record<string, Parts[P]>)[id] = item;
}

export function removeItem(room: Room, part: Part, id: string) {
  delete room[part][id];
}

type NewMessage = { roomId: string; where: Where; from: From; to?: string[]; text: string; replyTo?: string; event?: Event; requiresResponse?: boolean };

export function newMessage({ roomId, where, from, to = [], text, replyTo, event, requiresResponse }: NewMessage): Message {
  const fields: Meta = { where, from, to, at: timestamp() };
  if (replyTo) fields.replyTo = replyTo;
  if (event) fields.event = event;
  if (requiresResponse !== undefined) fields.requiresResponse = requiresResponse;
  return A2AMessage.fromJSON({ messageId: newId(), contextId: roomId, role: 'ROLE_USER', parts: [{ text }], metadata: { [EXTENSION]: fields } });
}

export const metaOf = (message: Message): Meta => message.metadata?.[EXTENSION];

export const placeOf = (message: Message): 'board' | 'dm' | 'outside' => {
  const { where } = metaOf(message);
  return typeof where === 'string' ? where : 'outside';
};

export const channelOf = (message: Message) => {
  const { where } = metaOf(message);
  return typeof where === 'string' ? null : where.channel;
};

export const textOf = (message: Message) => message.parts.map((part) => (part.content?.$case === 'text' ? part.content.value : '')).join('');

export const isSaidBy = (message: Message, agentId: string) => metaOf(message).from === agentId;

export const isResponseRequired = (message: Message) => metaOf(message).requiresResponse ?? placeOf(message) !== 'outside';

const withoutStatus = ({ status, ...message }: Message): Message => message;

/** Returns false for a message it already has. */
export function addMessage(held: Lists, message: Message, status?: Status) {
  const list = placeOf(message) === 'dm' ? held.dms : held.messages;
  if (list.some((had) => had.messageId === message.messageId)) return false;
  list.push(status ? { ...withoutStatus(message), status } : withoutStatus(message));
  list.sort((a, b) => metaOf(a).at.localeCompare(metaOf(b).at));
  return true;
}

export function messagesMissingFrom(held: Lists, ids: string[]) {
  const has = new Set(ids);
  return held.messages.filter((message) => !has.has(message.messageId));
}

export const findMessage = (held: Lists, id: string) => [...held.dms, ...held.messages].find((message) => message.messageId === id);

export const waitingMessages = (held: Lists) => [...held.dms, ...held.messages].filter((message) => message.status === 'new');

// A2A's JSON, as messages, cards and rooms travel between agents, to the web app and to channels. This agent's own
// status for a message, and whether an agent has left, are not A2A's: they are carried beside it.

export const messageToJson = (message: Message) => A2AMessage.toJSON(withoutStatus(message)) as Record<string, any>;
export const messageFromJson = (json: unknown): Message => A2AMessage.fromJSON(json);

export const cardToJson = ({ left, ...card }: Card) => ({ ...(AgentCard.toJSON(card) as Record<string, any>), ...(left && { left }) });
export const cardFromJson = (json: any): Card => ({ ...AgentCard.fromJSON(json), ...(json?.left && { left: true }) });

export const roomToJson = (room: Room) => ({ ...room, agents: Object.fromEntries(Object.entries(room.agents).map(([id, card]) => [id, cardToJson(card)])) });
export const roomFromJson = (json: any): Room => ({ ...json, agents: Object.fromEntries(Object.entries(json.agents).map(([id, card]) => [id, cardFromJson(card)])) });

const messageWithStatusToJson = (message: Message) => ({ ...messageToJson(message), ...(message.status && { status: message.status }) });

/** For this agent's own web app, so each message keeps its status. */
export const heldToJson = (held: Held) => ({ room: roomToJson(held.room), messages: held.messages.map(messageWithStatusToJson), dms: held.dms.map(messageWithStatusToJson) });
