import { QUICK_TIMEOUT_MS, Refused, TIMEOUT_MS, rpc } from '../rpc.ts';
import { cardToJson, messageFromJson, messageToJson, newRoom, roomFromJson } from '../room.ts';
import { setOwnItem } from './hosting.ts';
import { cardAddress, callMember, buildCard, checkPresence, newSecret, registerAgent, held, isHost, memberIds, agentName, exitRoom, room, isSameSecret } from './index.ts';
import { resetSeen, postEvent, receiveMessage } from './messages.ts';
import type { Agent } from './index.ts';
import type { Room } from '../room.ts';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];

/** Skills are optional, so a harness that cannot list them leaves the agent with none rather than stopping it. */
function listHarnessSkills(agent: Agent) {
  try {
    return agent.harness.list();
  } catch (error) {
    console.error(`agent-room: could not list this program's skills: ${(error as Error).message}`);
    return [];
  }
}

/** Names this agent, reads its harness's skills, and starts listening. */
async function prepare(agent: Agent, name?: string, description?: string) {
  if (!agent.me.name && !name) throw new Error('give your agent a name');
  if (name) agent.me.name = name;
  if (description) agent.me.description = description;
  agent.me.skills ??= listHarnessSkills(agent).map((skill) => ({ ...skill, onCard: false }));
  if (!agent.self.port) Object.assign(agent.self, await agent.net.listen());
}

const withDescription = (agent: Agent, text: string) => (agent.me.description ? `${text}. ${agent.me.description}` : text);

async function shareWithOtherMachines(agent: Agent) {
  if (agent.self.otherMachines) return;
  agent.self.url = await agent.net.share(agent.self.port);
  agent.self.otherMachines = true;
}

export async function startRoom(agent: Agent, { room: roomName, goal, name, description, shared }: { room: string; goal: string; name?: string; description?: string; shared?: boolean }) {
  // A room for this machine only must not keep listening on the tailnet from an earlier shared room.
  if (!shared && agent.self.otherMachines) await leaveAndStop(agent);
  await prepare(agent, name, description);
  if (shared) await shareWithOtherMachines(agent);
  await leaveRoom(agent);
  agent.held = { room: newRoom({ name: roomName, goal, hostId: agent.me.id, card: buildCard(agent) }), messages: [], dms: [] };
  Object.assign(agent, { host: null, hosted: { invite: newSecret(), tokens: new Map() }, key: newSecret(), inRoom: true, removed: false });
  resetSeen(agent);
  await postEvent(agent, withDescription(agent, 'started the room'), 'joined');
  registerAgent(agent);
}

export async function joinRoom(agent: Agent, { link, name, description }: { link: string; name?: string; description?: string }) {
  await prepare(agent, name, description);
  const { origin, hostname, pathname } = new URL(link);
  const nobody = new Error(
    LOCAL_HOSTS.includes(hostname)
      ? `no agent answered at ${origin}. The host that gave the invite may have left.`
      : `no agent answered at ${origin}. That room is on another machine: \`tailscale status\` should list ${hostname}. If it does, the host may have left.`,
  );
  // A host that has closed frees its port, and this agent may be the one listening there now.
  if ([agent.self.url, `http://127.0.0.1:${agent.self.port}`, `http://localhost:${agent.self.port}`].includes(origin)) throw nobody;
  if (!LOCAL_HOSTS.includes(hostname)) await shareWithOtherMachines(agent);
  await leaveRoom(agent);
  const welcome = await rpc(origin, 'JoinRoom', { code: pathname.split('/').pop(), card: cardToJson(buildCard(agent)) }).catch((error) => {
    throw error instanceof Refused ? error : nobody;
  });
  agent.held = { room: roomFromJson(welcome.room), messages: welcome.messages.map(messageFromJson), dms: [] };
  Object.assign(agent, { host: { address: origin, token: welcome.token }, hosted: null, key: welcome.key, inRoom: true, removed: false });
  resetSeen(agent);
  await Promise.all(memberIds(agent).map((id) => checkPresence(agent, id)));
  await setOwnItem(agent, 'agents', buildCard(agent));
  await postEvent(agent, withDescription(agent, 'joined the room'), 'joined');
  await syncWithHost(agent);
}

/**
 * Takes the host's room and key, and the two swap the messages the other lacks. A host that does not answer is tried
 * again next time; members carry on between themselves until then.
 */
export async function syncWithHost(agent: Agent, leaving = false) {
  if (!agent.inRoom || isHost(agent) || !agent.host) return;
  const [was, host] = [held(agent), agent.host];
  try {
    const have = was.messages.map((message) => message.messageId);
    const answer = await rpc(host.address, 'SyncRoom', { roomId: room(agent).id, agentId: agent.me.id, have, leaving }, { key: host.token, ms: leaving ? QUICK_TIMEOUT_MS : TIMEOUT_MS });
    if (agent.held !== was || !agent.inRoom) return;
    was.room = roomFromJson(answer.room);
    agent.key = answer.key;
    for (const message of answer.messages) receiveMessage(agent, messageFromJson(message));
    for (const message of was.messages.filter((one) => answer.want.includes(one.messageId))) rpc(host.address, 'PostMessage', { message: messageToJson(message) }, { key: agent.key }).catch(() => {});
    if (answer.room.ended) exitRoom(agent);
    else registerAgent(agent);
  } catch (error) {
    if (agent.held !== was || !(error instanceof Refused)) return;
    if (error.reason === 'removed') {
      agent.removed = true;
      exitRoom(agent);
      return;
    }
    // The room was handed to another host while this agent was not told.
    const moved = typeof error.reason === 'object' ? error.reason.host : undefined;
    const next = moved && moved !== agent.me.id ? room(agent).agents[moved] : null;
    if (moved && next && host.address !== cardAddress(next)) {
      room(agent).hostAgentId = moved;
      agent.host = { ...host, address: cardAddress(next) };
      await syncWithHost(agent, leaving);
    }
  }
}

/** A host leaving ends the room for everyone. */
async function leaveRoom(agent: Agent) {
  if (!agent.inRoom) return;
  if (isHost(agent)) {
    room(agent).ended = true;
    await postEvent(agent, 'ended the room', 'ended', { ms: QUICK_TIMEOUT_MS });
  } else {
    await postEvent(agent, 'left the room', 'left', { ms: QUICK_TIMEOUT_MS });
    await syncWithHost(agent, true);
  }
  exitRoom(agent);
}

export async function leaveAndStop(agent: Agent) {
  await leaveRoom(agent);
  agent.net.stop();
  Object.assign(agent.self, { port: 0, url: '', otherMachines: false });
}

/**
 * The host token proves the caller is the host. This agent syncs once more while the old host still hosts, then tells
 * every member it is the host now.
 */
export async function acceptHandOver(agent: Agent, { roomId, room: given, invite, tokens, key }: { roomId: string; room: Room; invite: string; tokens: Record<string, string>; key: string }, token: string | null) {
  if (!agent.inRoom || isHost(agent) || roomId !== room(agent).id || !isSameSecret(token, agent.host?.token) || given.hostAgentId !== agent.me.id) throw new Refused('only the host of this room can hand it to this agent');
  const was = room(agent).hostAgentId;
  await syncWithHost(agent);
  held(agent).room = given;
  Object.assign(agent, { host: null, hosted: { invite, tokens: new Map(Object.entries(tokens)) }, key });
  registerAgent(agent);
  // After this call is answered, so the old host knows it no longer hosts before anyone is told.
  setImmediate(async () => {
    const told = memberIds(agent).filter((id) => id !== was && tokens[id]);
    await Promise.all(told.map((id) => callMember(agent, id, 'NotifyHostChanged', { roomId, agentId: agent.me.id, token: tokens[id] }, QUICK_TIMEOUT_MS).catch(() => {})));
    await postEvent(agent, `is now the host, handed the room by ${agentName(agent, was)}. The room has a new join link: invite gives it.`, 'updated', { part: 'host' });
  });
  return {};
}

/** The new host proves itself with this agent's host token, which only a host holds. */
export function applyHostChange(agent: Agent, roomId: string, agentId: string, token: string) {
  if (!agent.inRoom || isHost(agent) || roomId !== room(agent).id || !agent.host || !isSameSecret(token, agent.host.token) || !room(agent).agents[agentId]) throw new Refused('that agent is not the host of this room');
  room(agent).hostAgentId = agentId;
  agent.host = { address: cardAddress(room(agent).agents[agentId]), token };
  registerAgent(agent);
  syncWithHost(agent);
  return {};
}
