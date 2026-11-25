// The routes this machine's own callers use: the web app and the session's turn-end hook. They answer on 127.0.0.1
// only.

import { z } from 'zod';
import { changeRoom, emailInvites, canEmailInvites, joinInstruction, renewInvite, removeFromRoom, listSentInvites, setCard } from './agent/hosting.ts';
import { requireHost, isHere, room } from './agent/index.ts';
import { leaveAndStop } from './agent/membership.ts';
import { PROGRAMS } from './programs/index.ts';
import { heldToJson, newId } from './room.ts';
import { uuidSchema, linesSchema, nonEmptySchema } from './schema.ts';
import { Refused } from './rpc.ts';
import type { Agent } from './agent/index.ts';
import type { Item } from './room.ts';
import type { createTurn } from './turn.ts';
import type { Routes } from './http.ts';

function requireInRoom(agent: Agent) {
  if (!agent.inRoom) throw new Refused('this session is not in a room');
  return agent;
}

function withoutChannelKeys(held: ReturnType<typeof heldToJson>) {
  const channels = Object.fromEntries(Object.entries(held.room.channels).map(([id, { key, ...channel }]) => [id, channel]));
  return { ...held, room: { ...held.room, channels } };
}

/** Everything the web app shows. Channel keys stay out of it. */
function webState(agent: Agent) {
  const now = agent.held;
  return {
    agentId: agent.me.id,
    skills: (agent.me.skills ?? []).map(({ folder, ...skill }) => skill),
    programs: Object.fromEntries(Object.values(PROGRAMS).map((program) => [program.name, program.label])),
    held: now && withoutChannelKeys(heldToJson(now)),
    inRoom: agent.inRoom,
    removed: agent.removed,
    here: now ? Object.fromEntries(Object.keys(now.room.agents).map((one) => [one, agent.inRoom && isHere(agent, one)])) : {},
    invite: agent.inRoom && agent.hosted && !now?.room.ended ? joinInstruction(agent) : null,
    emailInvites: canEmailInvites(agent),
  };
}

/** Keeps the goal or rule that has the same words, so its id survives an edit. */
const keepItemIds = (texts: string[], before: Record<string, Item>) => Object.fromEntries(texts.map((text) => Object.values(before).find((one) => one.text === text) ?? { id: newId(), text }).map((one) => [one.id, one]));

export function localRoutes(agent: Agent, turn: ReturnType<typeof createTurn>): Routes {
  const emptySchema = z.object({});
  return {
    get: {
      '/state': () => webState(agent),
      '/invite/emails': () => listSentInvites(agent),
    },
    post: {
      '/card': {
        input: z.object({ name: nonEmptySchema.optional(), description: z.string().optional(), skills: z.array(z.string()).optional() }),
        handle: (changes) => setCard(requireInRoom(agent), changes),
      },
      '/room': {
        input: z.object({ name: nonEmptySchema, goals: linesSchema, rules: linesSchema }),
        handle({ name, goals, rules }) {
          const now = room(requireInRoom(agent));
          const texts = (items: Record<string, Item>) => Object.values(items).map((item) => item.text).join('\n');
          const changed = [name !== now.name && 'name', goals.join('\n') !== texts(now.goals) && 'goals', rules.join('\n') !== texts(now.rules) && 'rules'].filter((part) => part !== false);
          if (!changed.length) return;
          // A rename alone needs nobody's attention; goal and rule changes go to every agent.
          const part = changed.find((one) => one !== 'name') ?? 'name';
          return changeRoom(agent, part, `changed the room's ${changed.join(' and ')}. view-room shows them.`, (one) => Object.assign(one, { name, goals: keepItemIds(goals, one.goals), rules: keepItemIds(rules, one.rules) }));
        },
      },
      '/room/remove': {
        input: z.object({ part: z.enum(['goals', 'rules', 'skills', 'agents']), id: uuidSchema }),
        handle: ({ part, id: itemId }) => removeFromRoom(requireInRoom(agent), part, itemId),
      },
      '/room/end': {
        input: emptySchema,
        handle() {
          requireHost(requireInRoom(agent));
          return leaveAndStop(agent);
        },
      },
      '/invite': { input: emptySchema, handle: () => renewInvite(requireInRoom(agent)) },
      '/invite/email': {
        input: z.object({ emails: z.array(z.email()).min(1) }),
        async handle({ emails }) {
          await emailInvites(requireInRoom(agent), emails);
        },
      },
      '/hook/stop': { input: emptySchema, handle: () => turn.turnEnd() },
    },
  };
}
