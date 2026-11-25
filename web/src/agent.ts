// What the agent sends the web app, and what the web app asks of it. The agent serves this page itself, so every
// path here is on the same address as the page.

// An agent's card as A2A's JSON. A field that holds its default, such as an empty description or no skills, is left out.
export type Card = {
  name: string
  description?: string
  version?: string
  provider?: { organization: string; url: string }
  documentationUrl?: string
  supportedInterfaces: { url: string; protocolBinding: string; protocolVersion: string }[]
  capabilities?: { streaming?: boolean; pushNotifications?: boolean; extensions?: { uri: string; params?: { agentId?: string; program?: string | null } }[] }
  defaultInputModes?: string[]
  defaultOutputModes?: string[]
  skills?: { name: string; description?: string }[]
  // Set once the agent has left the room or was removed. Its card stays so its messages keep its name.
  left?: boolean
}

// The room as an agent holds it. Each part is a map of items by id, and an item has only the fields that mean
// something for it. `hostAgentId` is the agent hosting it now, which changes on hand-over.
export type Room = {
  id: string
  name: string
  hostAgentId: string
  at: string
  ended: boolean
  goals: Record<string, { id: string; text: string }>
  rules: Record<string, { id: string; text: string }>
  // Each agent's A2A card, under the agent's id.
  agents: Record<string, Card>
  // Skills an agent shares. Their files stay with that agent until another takes the skill in.
  skills: Record<string, { id: string; agentId: string; name: string; description: string }>
  // The outside channels connected to the room.
  channels: Record<string, { id: string; name: string; url: string }>
}

export const EXTENSION = "https://github.com/bytelabs-oss/agent-room"

export type Where = "board" | "dm" | { channel: string }
export type From = string | { name: string; outsideId?: string | null }
export type Meta = { where: Where; from: From; to: string[]; at: string; replyTo?: string; event?: string; requiresResponse?: boolean }

// A message as A2A carries it, with agent-room's fields in its metadata. `status` is this agent's own, on a message it
// must act on: new until replied to or acked.
export type Message = {
  messageId: string
  contextId: string
  role: "ROLE_USER"
  parts: { text?: string }[]
  metadata: Record<string, Meta>
  status?: "new" | "ack" | "replied"
}

export const metaOf = (message: Message) => message.metadata[EXTENSION]

// What the agent sends the web app: what it holds, and beside it what only this agent knows. `held` is null until the
// session has been in a room. `skills` are the ones installed in this agent's program, with whether each is on its
// card. `programs` is what each program named on a card is called. `here` is whether each agent answered this one the
// last time it was asked.
export type State = {
  agentId: string
  skills: { name: string; description: string; onCard: boolean }[]
  programs: Record<string, string>
  held: { room: Room; messages: Message[]; dms: Message[] } | null
  // Whether this agent is in the room it holds, and whether the host took it out.
  inRoom: boolean
  removed: boolean
  here: Record<string, boolean>
  // The line another session joins with. Only the host has it.
  invite: string | null
  // Whether an invite to the host's Tailscale network can be emailed from here: true when it can, false when the
  // room is shared and no Tailscale API token is saved, null for a room on this machine.
  emailInvites: boolean | null
}

// What the person can change from the page.
export type Actions = {
  saveCard: (card: { name: string; description: string; skills: string[] }) => Promise<void>
  saveRoom: (room: { name: string; goals: string[]; rules: string[] }) => Promise<void>
  endRoom: () => Promise<void>
  newInvite: () => Promise<void>
  emailInvite: (emails: string[]) => Promise<void>
  // The invites to the host's Tailscale network that nobody has accepted yet, newest first.
  sentInvites: () => Promise<{ email: string; sentAt: string | null }[]>
  removeAgent: (id: string) => Promise<void>
  removeSkill: (id: string) => Promise<void>
}

async function postAction(path: string, body: object) {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error((await response.json()).error)
}

export const actions: Actions = {
  saveCard: card => postAction("/card", card),
  saveRoom: room => postAction("/room", room),
  endRoom: () => postAction("/room/end", {}),
  newInvite: () => postAction("/invite", {}),
  emailInvite: emails => postAction("/invite/email", { emails }),
  sentInvites: async () => {
    const response = await fetch("/invite/emails")
    if (!response.ok) throw new Error((await response.json()).error)
    return response.json()
  },
  removeAgent: id => postAction("/room/remove", { part: "agents", id }),
  removeSkill: id => postAction("/room/remove", { part: "skills", id }),
}

export async function fetchState(): Promise<State | null> {
  try {
    const response = await fetch("/state")
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}
