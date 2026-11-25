// The tools a session gets. room.md is returned as `guide` when a session comes into a room.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { addChannel, changeRoom, emailInvites, handOverRoom, joinInstruction, removeFromRoom, setCard } from '../agent/hosting.ts';
import { cardAddress, buildCard, checkPresence, requireHost, isHost, memberIds, agentName, presentAgentIds, room, findAgentId, held } from '../agent/index.ts';
import { syncWithHost, joinRoom, leaveAndStop, startRoom } from '../agent/membership.ts';
import { acknowledge, readMessages, sendDirectMessage, leftRoomError, readInbox, countNewMessages, replyToMessage, postMessage, formatMessage } from '../agent/messages.ts';
import { shareSkill, findRoomSkill, useSkill } from '../agent/skills.ts';
import { PROGRAMS } from '../programs/index.ts';
import { openAgents } from '../registry.ts';
import { extensionOf, findMessage, newId, setItem } from '../room.ts';
import { nonEmptySchema } from '../schema.ts';
import { canInvite } from '../tailscale.ts';
import type { Agent } from '../agent/index.ts';

type Tool = { name: string; description: string; input: Record<string, z.ZodType>; run(agent: Agent, input: any): Promise<object> | object };

const GUIDE = fs.readFileSync(path.join(import.meta.dirname, 'room.md'), 'utf8');

/** With `full`, each skill's description too. */
function describeAgent(agent: Agent, id: string, full = false) {
  const one = id === agent.me.id ? buildCard(agent) : room(agent).agents[id];
  const program = extensionOf(one)?.program;
  return {
    id,
    name: one.name,
    ...(one.description && { description: one.description }),
    ...(program && { program: PROGRAMS[program]?.label ?? program }),
    skills: one.skills.map((skill) => (full ? { name: skill.name, description: skill.description } : skill.name)),
    address: cardAddress(one),
    ...(id === agent.me.id && { you: true }),
    ...(id === room(agent).hostAgentId && { host: true }),
    ...(one.left && { left: true }),
  };
}

function summarizeRoom(agent: Agent) {
  const now = room(agent);
  return {
    name: now.name,
    goals: Object.values(now.goals).map((goal) => goal.text),
    rules: Object.values(now.rules).map((rule) => rule.text),
    skills: Object.values(now.skills).map((skill) => ({ name: skill.name, description: skill.description, sharedBy: agentName(agent, skill.agentId) })),
    channels: Object.values(now.channels).map((channel) => channel.name),
  };
}

const roomBriefing = (agent: Agent) => ({
  guide: GUIDE,
  room: summarizeRoom(agent),
  agents: presentAgentIds(agent).map((id) => describeAgent(agent, id)),
  installedSkills: (agent.me.skills ?? []).map((skill) => skill.name),
  waiting: readInbox(agent),
  ...(isHost(agent) && { youHost: true }),
});

function openInBrowser(url: string) {
  const [command, ...args] = process.platform === 'darwin' ? ['open'] : process.platform === 'win32' ? ['cmd', '/c', 'start', ''] : ['xdg-open'];
  spawn(command, [...args, url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

const webAppUrl = (agent: Agent) => `http://localhost:${agent.self.port}`;

/** For a shared room, also what the other machine needs. */
async function buildInvite(agent: Agent, emails: string[] = []) {
  requireHost(agent);
  const line = joinInstruction(agent);
  if (!agent.self.otherMachines) return { invite: line };
  const needs = 'A session on another machine needs agent-room installed, and that machine on the same Tailscale network as this one.';
  if (!canInvite()) return { invite: line, needs, emailInvites: 'Save a Tailscale API token once to email invites: npx github:bytelabs-oss/agent-room tailscale-key. Until then, invite people at https://login.tailscale.com/admin/users' };
  if (!emails.length) return { invite: line, needs, emailInvites: 'Give the emails of people to let onto your Tailscale network, and Tailscale emails each an invite.' };
  const sent = await emailInvites(agent, emails);
  return { invite: line, needs, emailed: sent.map((one) => one.email) };
}

function findItem(agent: Agent, part: 'goals' | 'rules', ref: string) {
  const found = Object.values(room(agent)[part]).find((one) => one.id === ref || one.text === ref);
  if (!found) throw new Error(`no ${part.slice(0, -1)} "${ref}" in the room. view-room part=${part} lists them.`);
  return found;
}

function findChannel(agent: Agent, ref: string) {
  const found = Object.values(room(agent).channels).find((one) => one.id === ref || one.name === ref);
  if (!found) throw new Error(`no channel "${ref}" is connected. Connected: ${Object.values(room(agent).channels).map((one) => one.name).join(', ') || 'none'}`);
  return found;
}

const nameSchema = nonEmptySchema.optional().describe('Your name in the room, needed the first time. Say what you do here, unless your person gave you a name.');
const descriptionSchema = z.string().optional().describe('One line on what you do. It goes on your card.');
const goalSchema = z.string().min(1).describe('What the room is for, as your person said it. Ask them if they have not said; never make one up.');
const ROOM_PARTS = (['name', 'goals', 'rules', 'agents', 'skills', 'channels', 'board', 'outside'] as const);

async function startAndOpenRoom(agent: Agent, input: { room: string; goal: string; name?: string; description?: string }, shared: boolean) {
  await startRoom(agent, { ...input, shared });
  openInBrowser(webAppUrl(agent));
  return { ...roomBriefing(agent), app: webAppUrl(agent), ...(await buildInvite(agent)) };
}

// The agents a message is addressed to, by id, without the sender. @name in the text addresses nobody, so it is refused,
// and so is an agent who has left.
async function addressees(agent: Agent, text: string, to: string[]) {
  const written = memberIds(agent).map((id) => agentName(agent, id)).find((one) => text.includes(`@${one}`));
  if (written) throw new Error(`@${written} in the text addresses nobody. Put the names in to, and write the text without @.`);
  const named = [...new Set<string>(to.map((one) => findAgentId(agent, one)))].filter((id) => id !== agent.me.id);
  for (const id of named) if (!(await checkPresence(agent, id))) throw leftRoomError(agent, id);
  return named;
}

export const TOOLS: Tool[] = [
  {
    name: 'start-local-room',
    description: 'Start a room for sessions on this machine, as its host, and open its web app. Returns the guide, the room, the agents and the invite.',
    input: { room: nonEmptySchema.describe('A name for the room'), goal: goalSchema, name: nameSchema, description: descriptionSchema },
    run: (agent, input) => startAndOpenRoom(agent, input, false),
  },
  {
    name: 'start-shared-room',
    description: 'Start a room that sessions on other machines can join over Tailscale, as its host. Needs Tailscale running and signed in. Returns the guide, the room, the agents and the invite.',
    input: { room: nonEmptySchema.describe('A name for the room'), goal: goalSchema, name: nameSchema, description: descriptionSchema },
    run: (agent, input) => startAndOpenRoom(agent, input, true),
  },
  {
    name: 'join-room',
    description: 'Join a room with the link from its invite. You are in one room at a time. Returns the guide, the room, the agents and what waits for you.',
    input: { link: z.url().describe('The link from the invite, exactly as given'), name: nameSchema, description: descriptionSchema },
    async run(agent, input) {
      await joinRoom(agent, input);
      return roomBriefing(agent);
    },
  },
  {
    name: 'list-rooms',
    description: 'The rooms open on this machine: name, goals, agents and host of each.',
    input: {},
    run() {
      const rooms: Map<string, { name: string; goals: string[]; host: string; agents: string[] }> = new Map();
      for (const one of openAgents()) {
        if (!rooms.has(one.room.id)) rooms.set(one.room.id, { name: one.room.name, goals: one.room.goals, host: one.room.host, agents: [] });
        rooms.get(one.room.id)?.agents.push(one.agent.name);
      }
      return { rooms: [...rooms.values()] };
    },
  },
  {
    name: 'invite',
    description: 'The invite to your room, for your person to paste into the session that should join. Show it unchanged. Host only.',
    input: { emails: z.array(z.email()).optional().describe('For a shared room: emails of people to let onto your Tailscale network. Ask your person for them.') },
    run: (agent, { emails }) => buildInvite(agent, emails),
  },
  {
    name: 'list-agents',
    description: 'The agents here, or one agent with what each of its skills does.',
    input: { agent: z.string().optional().describe('The name or id of one agent') },
    async run(agent, { agent: wanted }) {
      await Promise.all(memberIds(agent).map((id) => checkPresence(agent, id)));
      if (!wanted) return { agents: presentAgentIds(agent).map((id) => describeAgent(agent, id)) };
      return { agent: describeAgent(agent, wanted === agent.me.name ? agent.me.id : findAgentId(agent, wanted), true) };
    },
  },
  {
    name: 'set-card',
    description: 'Change your card: name, description, and which installed skills it shows. With no input, returns your card and the skills you can add.',
    input: { name: nonEmptySchema.optional().describe('A new name'), description: descriptionSchema, skills: z.array(z.string()).optional().describe('The installed skills to show, in place of the ones shown now') },
    async run(agent, changes) {
      if (Object.values(changes).some((one) => one !== undefined)) await setCard(agent, changes);
      return { card: describeAgent(agent, agent.me.id), notOnCard: (agent.me.skills ?? []).filter((skill) => !skill.onCard).map((skill) => skill.name) };
    },
  },
  {
    name: 'post',
    description: 'Write on the board. Addressed with `to`, it waits for each of those agents to reply or ack. Returns its id.',
    input: { text: z.string().min(1).describe('What it says. Do not write @name in it.'), to: z.array(z.string()).optional().describe('Names or ids of the agents it is addressed to') },
    async run(agent, { text, to = [] }) {
      return { id: (await postMessage(agent, { where: 'board', to: await addressees(agent, text, to), text })).messageId };
    },
  },
  {
    name: 'send-dm',
    description: 'A DM to one agent. Returns its id once the agent has it; an answer comes later as a DM to you.',
    input: { to: z.string().describe('The name or id of an agent'), text: z.string().min(1) },
    run: async (agent, { to, text }) => ({ id: (await sendDirectMessage(agent, findAgentId(agent, to), text)).messageId }),
  },
  {
    name: 'send-outside',
    description: 'Send to a channel connected to your room. Addressed with `to`, it waits for each of those agents to reply or ack, and the channel is told who it names. Returns its id.',
    input: {
      channel: z.string().trim().min(1).describe('The name of a connected channel'),
      text: z.string().min(1).describe('What it says. Do not write @name in it.'),
      to: z.array(z.string()).optional().describe('Names or ids of the agents it is addressed to'),
    },
    async run(agent, { channel, text, to = [] }) {
      const named = await addressees(agent, text, to);
      const where = { channel: findChannel(agent, channel).id };
      return { id: (await postMessage(agent, { where, to: named, text, ...(named.length && { requiresResponse: true }) })).messageId };
    },
  },
  {
    name: 'view-inbox',
    description: 'What waits for you, oldest first.',
    input: {},
    run: (agent) => ({ waiting: readInbox(agent) }),
  },
  {
    name: 'read',
    description: 'One message in full, by id.',
    input: { id: z.string() },
    run(agent, { id }) {
      const message = findMessage(held(agent), id);
      if (!message) throw new Error(`no message ${id} in this room`);
      agent.seen.viewed.add(id);
      return formatMessage(agent, message);
    },
  },
  {
    name: 'reply',
    description: 'Answer a message addressed to you, and close it. The answer goes where the message was said. Returns its id.',
    input: { id: z.string().describe('The message you answer'), text: z.string().min(1) },
    run: async (agent, { id, text }) => ({ id: (await replyToMessage(agent, id, text)).messageId }),
  },
  {
    name: 'ack',
    description: 'Close messages addressed to you that need no answer. The senders are told nothing.',
    input: { ids: z.array(z.string()).min(1) },
    run(agent, { ids }) {
      acknowledge(agent, ids);
      return { acked: ids };
    },
  },
  {
    name: 'view-room',
    description: 'The room: with no part, its goals, rules, skills, channels, who is here and the board. With board or outside, the messages there you have not seen. With another part, that part.',
    input: { part: z.enum(ROOM_PARTS).optional(), limit: z.int().positive().optional().describe('Only the latest this many messages') },
    run(agent, { part, limit }) {
      if (!part) return { ...summarizeRoom(agent), here: presentAgentIds(agent).map((id) => agentName(agent, id)), board: readMessages(agent, 'board', { limit }) };
      if (part === 'board' || part === 'outside') return { messages: readMessages(agent, part, { onlyNew: true, limit }) };
      if (part === 'name') return { name: room(agent).name };
      if (part === 'channels') return { channels: Object.values(room(agent).channels).map(({ key, ...channel }) => channel) };
      if (part === 'agents') return { agents: Object.keys(room(agent).agents).map((id) => describeAgent(agent, id)) };
      return { [part]: room(agent)[part as 'goals' | 'rules' | 'skills'] };
    },
  },
  {
    name: 'share-skill',
    description: 'Share one of your program\'s skills with the room. Others take its files from you while you are here.',
    input: { skill: z.string().trim().min(1).describe('The name of one of your skills') },
    run: async (agent, { skill: wanted }) => ({ id: (await shareSkill(agent, wanted)).id }),
  },
  {
    name: 'use-skill',
    description: 'Take a skill the room shares into your program, which then has it as one of its own skills. It is taken out again when you leave the room.',
    input: { skill: z.string().describe('The name or id of a room skill') },
    async run(agent, { skill: ref }) {
      const { skill, ready } = await useSkill(agent, ref);
      return { skill: skill.name, sharedBy: agentName(agent, skill.agentId), ready };
    },
  },
  {
    name: 'room-add',
    description: 'Add a goal, a rule or a channel. A channel returns the key its program shows the host. Host only.',
    input: {
      part: z.enum(['goals', 'rules', 'channels']),
      value: z.string().trim().min(1).describe('The goal or rule, or the channel\'s name'),
      url: z.url().optional().describe('For a channel: where it takes messages'),
    },
    async run(agent, { part, value, url }) {
      if (part === 'channels') {
        if (!url) throw new Error('a channel needs url, where it takes messages');
        return addChannel(agent, { name: value, url });
      }
      const item = { id: newId(), text: value };
      await changeRoom(agent, part, `added a ${part.slice(0, -1)}: "${value}"`, (now) => setItem(now, part, item));
      return { id: item.id };
    },
  },
  {
    name: 'room-edit',
    description: 'Change a goal, a rule, or the room\'s name. Host only.',
    input: { part: z.enum(['goals', 'rules', 'name']), id: z.string().optional().describe('For a goal or rule: its id or its words'), value: z.string().trim().min(1) },
    async run(agent, { part, id, value }) {
      if (part === 'name') {
        await changeRoom(agent, 'name', `renamed the room "${value}"`, (now) => (now.name = value));
        return { name: value };
      }
      requireHost(agent);
      const item = findItem(agent, part, id ?? '');
      await changeRoom(agent, part, `changed a ${part.slice(0, -1)} from "${item.text}" to "${value}"`, () => (item.text = value));
      return { id: item.id };
    },
  },
  {
    name: 'room-remove',
    description: 'Take a goal, rule, skill, channel or agent out. A removed agent can no longer post here, and the room gets a new join link. Host only.',
    input: { part: z.enum(['goals', 'rules', 'skills', 'channels', 'agents']), id: z.string().describe('Its id; or a name for a skill, channel or agent; or the words of a goal or rule') },
    async run(agent, { part, id: ref }) {
      requireHost(agent);
      const itemId = part === 'agents' ? findAgentId(agent, ref) : part === 'skills' ? findRoomSkill(agent, ref).id : part === 'channels' ? findChannel(agent, ref).id : findItem(agent, part, ref).id;
      await removeFromRoom(agent, part, itemId);
      return { removed: itemId };
    },
  },
  {
    name: 'hand-over',
    description: 'Make another agent the host. You stay in the room; the room gets a new join link from the new host. Host only.',
    input: { agent: z.string().describe('The name or id of the new host') },
    run: async (agent, { agent: wanted }) => ({ host: await handOverRoom(agent, findAgentId(agent, wanted)) }),
  },
  {
    name: 'open-app',
    description: 'Open your web app in your person\'s browser.',
    input: {},
    run(agent) {
      openInBrowser(webAppUrl(agent));
      return { app: webAppUrl(agent) };
    },
  },
  {
    name: 'leave-room',
    description: 'Leave the room and stop listening. As the host, this ends the room for every agent.',
    input: {},
    async run(agent) {
      const [was, ended] = [room(agent).name, isHost(agent)];
      await leaveAndStop(agent);
      return ended ? { ended: was } : { left: was };
    },
  },
];

const TOOLS_OUTSIDE_ROOM = ['start-local-room', 'start-shared-room', 'join-room', 'list-rooms'];

/** Syncs with the host first, and adds counts of what is new on the board and channels. */
export async function runTool(agent: Agent, tool: Tool, input: any) {
  await syncWithHost(agent);
  if (!agent.inRoom && !TOOLS_OUTSIDE_ROOM.includes(tool.name)) {
    throw new Error(agent.removed ? 'the host removed this agent from the room.' : agent.held?.room.ended ? 'the room has ended.' : 'start a room with start-local-room or start-shared-room, or join one with join-room, first.');
  }
  const result = await tool.run(agent, input);
  const fresh = agent.inRoom ? countNewMessages(agent) : {};
  return Object.keys(fresh).length ? { ...result, news: fresh } : result;
}

