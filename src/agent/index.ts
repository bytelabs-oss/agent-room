// An agent is a session's place in a room: a plain state object, with the other files in this folder as functions
// over it. Nothing here listens or serves; the network is handed in as `net`.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { EXTENSION, extensionOf, cardFromJson, cardToJson, metaOf, newId } from '../room.ts';
import { A2A_VERSION, Refused, TIMEOUT_MS, fetchCard, rpc } from '../rpc.ts';
import { register, unregister } from '../registry.ts';
import type { Card, Held, Message } from '../room.ts';

export type HarnessSkill = { name: string; description: string; folder: string };

/** File bytes keyed by path inside the skill folder. */
export type SkillFiles = Record<string, Buffer>;

/** The harness owns its skills and installs shared ones its own way. `use` returns what to tell the agent once the skill is ready. */
export type SkillHost = {
  list(): HarnessSkill[];
  use(name: string, files: SkillFiles): string;
  remove(name: string): void;
};

type Net = { listen(): Promise<{ port: number; url: string }>; share(port: number): Promise<string>; stop(): void };

export type Agent = {
  me: { id: string; name: string; description: string; skills: (HarnessSkill & { onCard: boolean })[] | null };
  self: {
    port: number;
    url: string;
    otherMachines: boolean;
    program: string | null;
    provider: { organization: string; url: string } | null;
    reach: Record<string, any>;
  };
  held: Held | null;
  inRoom: boolean;
  removed: boolean;
  host: { address: string; token: string } | null;
  hosted: { invite: string; tokens: Map<string, string> } | null;
  key: string | null;
  here: Map<string, boolean>;
  /** Message ids, so the agent hears of each message once. */
  seen: {
    /** Counted once in the `news` on a tool result. */
    counted: Set<string>;
    /** Shown to it in full. */
    viewed: Set<string>;
  };
  net: Net;
  harness: SkillHost;
  /** Room skills this agent took into its harness, taken out again when it leaves. */
  usedSkills: Set<string>;
  onMessage: (message: Message) => void;
};

const NO_SKILLS: SkillHost = {
  list: () => [],
  use: () => {
    throw new Error('this session\'s program takes in no shared skills');
  },
  remove: () => {},
};

export function createAgent({ net, harness = NO_SKILLS }: { net: Net; harness?: SkillHost }): Agent {
  return {
    me: { id: newId(), name: '', description: '', skills: null },
    self: { port: 0, url: '', otherMachines: false, program: null, provider: null, reach: {} },
    held: null,
    inRoom: false,
    removed: false,
    host: null,
    hosted: null,
    key: null,
    here: new Map(),
    seen: { counted: new Set(), viewed: new Set() },
    net,
    harness,
    usedSkills: new Set(),
    onMessage: () => {},
  };
}

export const newSecret = () => randomBytes(18).toString('base64url');

/** Compares two secrets in constant time. */
export function isSameSecret(one: string | null | undefined, other: string | null | undefined) {
  if (!one || !other) return false;
  const [a, b] = [Buffer.from(one), Buffer.from(other)];
  return a.length === b.length && timingSafeEqual(a, b);
}

export function held(agent: Agent) {
  if (!agent.held) throw new Error('this session has not been in a room');
  return agent.held;
}

export const room = (agent: Agent) => held(agent).room;

export const isHost = (agent: Agent) => room(agent).hostAgentId === agent.me.id;

/** Returns the secrets only the host holds. */
export function requireHost(agent: Agent) {
  if (!isHost(agent) || !agent.hosted) throw new Refused(`only the host, ${agentName(agent, room(agent).hostAgentId)}, can do that.`);
  return agent.hosted;
}

export function buildCard(agent: Agent): Card {
  return cardFromJson({
    name: agent.me.name,
    description: agent.me.description,
    version: '1.0.0',
    ...(agent.self.provider && { provider: agent.self.provider }),
    supportedInterfaces: [...new Set([agent.self.url, `http://127.0.0.1:${agent.self.port}`])].map((url) => ({ url, protocolBinding: 'JSONRPC', protocolVersion: A2A_VERSION })),
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extensions: [{ uri: EXTENSION, description: 'Rooms that agent sessions message each other in.', required: false, params: { agentId: agent.me.id, program: agent.self.program, roomId: agent.inRoom ? room(agent).id : null } }],
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: (agent.me.skills ?? []).filter((skill) => skill.onCard).map((skill) => ({ id: skill.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: skill.name, description: skill.description, tags: [] })),
  });
}

/** The card others fetch, as A2A JSON. None outside a room. */
export const publicCard = (agent: Agent) => (agent.inRoom ? cardToJson(buildCard(agent)) : null);

export const cardAddress = (one: Card) => one.supportedInterfaces[0].url;

export const agentName = (agent: Agent, id: string) => room(agent).agents[id]?.name ?? 'an agent that left';

/** The other agents in the room, whether or not they answer. */
export const memberIds = (agent: Agent) => Object.entries(room(agent).agents).filter(([id, one]) => id !== agent.me.id && !one.left).map(([id]) => id);

export const isHere = (agent: Agent, id: string) => id === agent.me.id || Boolean(agent.here.get(id) && room(agent).agents[id] && !room(agent).agents[id].left);

export const presentMemberIds = (agent: Agent) => memberIds(agent).filter((id) => isHere(agent, id));

/** This agent first, then the members that are here. */
export const presentAgentIds = (agent: Agent) => [agent.me.id, ...presentMemberIds(agent)];

/** Someone on a channel can always be answered. */
export function canAnswer(agent: Agent, message: Message) {
  const { from } = metaOf(message);
  return typeof from !== 'string' || isHere(agent, from);
}

/** An agent is present when its address answers with its own id and this room's id. */
export async function checkPresence(agent: Agent, id: string) {
  const roomId = room(agent).id;
  const theirs = await fetchCard(cardAddress(room(agent).agents[id]));
  const params = extensionOf(theirs);
  if (agent.inRoom && roomId === room(agent).id) agent.here.set(id, params?.agentId === id && params?.roomId === roomId);
  return Boolean(agent.here.get(id));
}

/** Accepts a name or an id. Two agents can share a name, so a present one wins and a tie is an error. */
export function findAgentId(agent: Agent, wanted: string) {
  const agents = room(agent).agents;
  if (agents[wanted] && !agents[wanted].left) return wanted;
  const named = Object.keys(agents).filter((id) => agents[id].name === wanted && !agents[id].left);
  const picked = named.some((id) => isHere(agent, id)) ? named.filter((id) => isHere(agent, id)) : named;
  if (!picked.length) throw new Error(`no agent "${wanted}" in ${room(agent).name}. here now: ${presentAgentIds(agent).map((id) => agentName(agent, id)).join(', ')}`);
  if (picked.length > 1) throw new Error(`${picked.length} agents here are called ${wanted}. Use an id instead: ${picked.join(', ')}`);
  return picked[0];
}

export const callMember = (agent: Agent, id: string, method: string, params: object, ms = TIMEOUT_MS) => rpc(cardAddress(room(agent).agents[id]), method, params, { key: agent.key, ms });

/** Lists this agent where hooks and other agents on this machine find it. */
export function registerAgent(agent: Agent) {
  const now = room(agent);
  register({
    session: agent.self.reach.session ?? null,
    port: agent.self.port,
    agent: { id: agent.me.id, name: agent.me.name },
    room: { id: now.id, name: now.name, goals: Object.values(now.goals).map((goal) => goal.text), host: agentName(agent, now.hostAgentId) },
  });
}

/** What it holds stays, so its web app still shows what was said. Room skills it took in are taken out. */
export function exitRoom(agent: Agent) {
  agent.inRoom = false;
  agent.here.clear();
  for (const name of agent.usedSkills) agent.harness.remove(name);
  agent.usedSkills.clear();
  unregister();
}
