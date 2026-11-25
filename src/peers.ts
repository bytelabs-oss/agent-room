// The JSON-RPC methods at an agent's address. SendMessage is A2A's; the rest are agent-room's extension. Calls come
// from other processes or machines, so `input` checks params and each handler checks the key.

import { z } from 'zod';
import { Refused } from './rpc.ts';
import { extensionOf, cardFromJson, channelOf, messageFromJson, metaOf, roomFromJson } from './room.ts';
import { cardSchema, uuidSchema, messageSchema, roomSchema, secretSchema, skillSchema } from './schema.ts';
import { verifyMember, answerSync, admitAgent, setMemberItem } from './agent/hosting.ts';
import { isHost, room, isSameSecret } from './agent/index.ts';
import { syncWithHost, applyHostChange, acceptHandOver } from './agent/membership.ts';
import { updatePresence, broadcast, resolveChannelIds, receiveMessage } from './agent/messages.ts';
import { getSkillFiles } from './agent/skills.ts';
import type { Agent } from './agent/index.ts';
import type { Method } from './http.ts';
import type { Message } from './room.ts';

function requireRoom(agent: Agent, roomId: string) {
  if (!agent.inRoom || room(agent).id !== roomId) throw new Refused('no agent in that room at this address');
}

function requireRoomKey(agent: Agent, key: string | null) {
  if (!isSameSecret(key, agent.key)) throw new Refused("that call does not carry this room's key", 'key');
}

/** An agent this one has not heard of may have just joined, so it syncs with the host first. */
async function isMember(agent: Agent, agentId: string) {
  if (agent.inRoom && !room(agent).agents[agentId]) await syncWithHost(agent);
  return Boolean(agent.inRoom && room(agent).agents[agentId] && !room(agent).agents[agentId].left);
}

async function receiveFromMember(agent: Agent, one: Message) {
  const { from } = metaOf(one);
  if (typeof from === 'string' && !(await isMember(agent, from))) throw new Refused('the sender is not in this room');
  receiveMessage(agent, one);
  updatePresence(agent, one);
}

/** The channel uses its own ids; the host maps those that are room agents back to agent ids before broadcasting. */
async function receiveFromChannel(agent: Agent, one: Message, key: string | null) {
  const fields = metaOf(one);
  const named = channelOf(one);
  const channel = Object.values(room(agent).channels).find((had) => had.id === named || had.name === named);
  if (!isHost(agent) || !channel || !isSameSecret(key, channel.key)) throw new Refused("that call does not carry a connected channel's key", 'key');
  const ids = await resolveChannelIds(agent, channel).catch((error) => {
    throw new Refused(`the channel did not say who its ids are: ${error.message}`);
  });
  const agentOf = Object.fromEntries(Object.entries(ids).map(([agentId, theirs]) => [theirs, agentId]));
  fields.where = { channel: channel.id };
  fields.to = [...new Set(fields.to.map((theirs) => agentOf[theirs]).filter(Boolean))];
  const from = (fields.from as { outsideId?: string | null });
  if (from.outsideId && agentOf[from.outsideId]) fields.from = agentOf[from.outsideId];
  if (receiveMessage(agent, one)) await broadcast(agent, one);
}

export function peerMethods(agent: Agent): Record<string, Method> {
  return {
    JoinRoom: {
      input: z.object({ code: secretSchema, card: cardSchema }),
      handle: ({ code, card: theirs }) => admitAgent(agent, code, cardFromJson(theirs)),
    },

    SyncRoom: {
      input: z.object({ roomId: uuidSchema, agentId: uuidSchema, have: z.array(uuidSchema), leaving: z.boolean() }),
      handle({ roomId, agentId, have, leaving }, { key }) {
        verifyMember(agent, roomId, agentId, key);
        return answerSync(agent, agentId, have, leaving);
      },
    },

    SetMemberItem: {
      input: z.discriminatedUnion('part', [z.object({ roomId: uuidSchema, agentId: uuidSchema, part: z.literal('agents'), item: cardSchema }), z.object({ roomId: uuidSchema, agentId: uuidSchema, part: z.literal('skills'), item: skillSchema })]),
      handle({ roomId, agentId, part, item }, { key }) {
        verifyMember(agent, roomId, agentId, key);
        if ((part === 'agents' ? extensionOf(item)?.agentId : item.agentId) !== agentId) throw new Refused("that is another agent's");
        setMemberItem(agent, agentId, part, part === 'agents' ? cardFromJson(item) : item);
        return {};
      },
    },

    NotifyRoomChanged: {
      input: z.object({ roomId: uuidSchema }),
      handle({ roomId }) {
        if (agent.inRoom && room(agent).id === roomId) syncWithHost(agent);
        return {};
      },
    },

    HandOverRoom: {
      input: z.object({ roomId: uuidSchema, room: roomSchema, invite: secretSchema, tokens: z.record(uuidSchema, secretSchema), key: secretSchema }),
      handle: (handed, { key }) => acceptHandOver(agent, { ...handed, room: roomFromJson(handed.room) }, key),
    },

    NotifyHostChanged: {
      input: z.object({ roomId: uuidSchema, agentId: uuidSchema, token: secretSchema }),
      handle: ({ roomId, agentId, token }) => applyHostChange(agent, roomId, agentId, token),
    },

    PostMessage: {
      input: z.object({ message: messageSchema }),
      async handle({ message: json }, { key }) {
        const one = messageFromJson(json);
        requireRoom(agent, one.contextId);
        if (typeof metaOf(one).from === 'object' && !isSameSecret(key, agent.key)) {
          await receiveFromChannel(agent, one, key);
          return {};
        }
        requireRoomKey(agent, key);
        if (metaOf(one).where === 'dm') throw new Refused('a DM comes through SendMessage');
        await receiveFromMember(agent, one);
        return {};
      },
    },

    SendMessage: {
      input: z.object({ message: messageSchema }),
      async handle({ message: json }, { key }) {
        const one = messageFromJson(json);
        requireRoom(agent, one.contextId);
        requireRoomKey(agent, key);
        const { from, where, to } = metaOf(one);
        if (where !== 'dm' || to.length !== 1 || to[0] !== agent.me.id || typeof from !== 'string' || from === agent.me.id) throw new Refused('that message is not a DM for this agent');
        await receiveFromMember(agent, one);
        return { message: { messageId: crypto.randomUUID(), contextId: one.contextId, role: 'ROLE_AGENT', parts: [{ text: 'delivered' }] } };
      },
    },

    GetSkillFiles: {
      input: z.object({ roomId: uuidSchema, skillId: uuidSchema }),
      handle({ roomId, skillId }, { key }) {
        requireRoom(agent, roomId);
        requireRoomKey(agent, key);
        return getSkillFiles(agent, skillId);
      },
    },
  };
}
