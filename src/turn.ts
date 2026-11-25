// The turn. A message the agent must act on is handed to its program, which delivers it into the turn under way or
// starts one. The turn cannot end while such a message waits from someone who can still be answered.

import { syncWithHost } from './agent/membership.ts';
import { canAnswer, checkPresence, held, room } from './agent/index.ts';
import { formatMessage } from './agent/messages.ts';
import { channelOf, metaOf, waitingMessages } from './room.ts';
import type { Agent } from './agent/index.ts';
import type { Message } from './room.ts';

/** @param deliver hands the session a message from another agent or a channel */
export function createTurn(agent: Agent, deliver: (prompt: string, sender: string) => void) {
  const turnHoldingMessages = () => waitingMessages(held(agent)).filter((message) => canAnswer(agent, message));

  agent.onMessage = (message: Message) => {
    const { from } = metaOf(message);
    const prompt = `agent-room: a message for you as "${agent.me.name}" in room "${room(agent).name}". Reply to it or ack it: ${JSON.stringify(formatMessage(agent, message))}`;
    deliver(prompt, typeof from === 'string' ? from : `channel-${channelOf(message)}`);
  };

  return {
    /** At turn end: `block` sends the session back to work while a message holds its turn. */
    async turnEnd() {
      if (!agent.inRoom) return {};
      await syncWithHost(agent);
      if (!agent.inRoom) return {};
      const senders = new Set(waitingMessages(held(agent)).map((message) => metaOf(message).from).filter((from) => typeof from === 'string'));
      await Promise.all([...senders].filter((id) => room(agent).agents[id]).map((id) => checkPresence(agent, id)));
      if (!turnHoldingMessages().length) return {};
      return { block: `agent-room: reply to or ack each of these before ending your turn: ${JSON.stringify(turnHoldingMessages().map((message) => formatMessage(agent, message)))}` };
    },
  };
}
