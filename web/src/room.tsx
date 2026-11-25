import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react"
import { toast } from "sonner"
import { actions, fetchState, metaOf, type Actions, type Card, type Message, type State } from "@/agent"
import type { Agent, RoomInfo, Status } from "@/types"

/** One chat line. A DM reply is its own line; the message it answers also keeps it for the "Replied" popup. */
export type Line = {
  id: string
  from: string
  body: string
  minutesAgo: number
  mine: boolean
  status?: Status
  reply?: Said
  /** On a reply: the message it answers. */
  replyTo?: Said
  /** A note that an agent came or went, or that the host changed or ended the room. */
  note?: boolean
}

export type Said = { from: string; body: string; minutesAgo: number }

type Room = {
  info: RoomInfo
  saveInfo: (next: Pick<RoomInfo, "name" | "goals" | "rules">) => void
  endRoom: () => void
  removeAgent: (id: string) => void
  removeSkill: (id: string) => void
  amHost: boolean
  me: Agent
  others: Agent[]
  agents: Agent[]
  byId: Record<string, Agent>
  saveMe: (a: Pick<Agent, "name" | "description" | "skills">) => void
  joinUrl: string
  newJoinUrl: () => void
  /** Whether an invite to the host's Tailscale network can be emailed: true, false when no token is saved, null for a room on this machine. */
  emailInvites: boolean | null
  emailInvite: (emails: string[]) => Promise<void>
  /** The invites to the host's Tailscale network that nobody has accepted yet, newest first. */
  sentInvites: () => Promise<{ email: string; sentAt: string | null }[]>
  /** Room messages, oldest first. */
  room: Line[]
  /** DM lines per other agent, oldest first. */
  dms: Record<string, Line[]>
  /** DMs to this agent it hasn't acknowledged or replied to, per sender. */
  newCount: Record<string, number>
  /** Room messages that tag this agent, newest first. */
  mentions: Line[]
  /** The outside channels connected to the room: what was said on each, oldest first, and how many are new for this agent. */
  channels: { name: string; lines: Line[]; waiting: number }[]
}

const RoomContext = createContext<Room | null>(null)

/** A hue for an agent that stays the same for as long as its id does. */
function hueOf(id: string) {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

const bindingNames: Record<string, string> = { JSONRPC: "JSON-RPC", GRPC: "gRPC", "HTTP+JSON": "HTTP and JSON" }

type Held = State & { held: NonNullable<State["held"]> }

/** An agent as the page's parts take it, from its card. Only this page's own agent has its installed skills. */
function toAgent(id: string, card: Card, state: Held): Agent {
  const [first] = card.supportedInterfaces
  // agent-room's part of the card says which program the agent runs in.
  const program = card.capabilities?.extensions?.find(e => e.params?.program)?.params?.program
  return {
    id,
    name: card.name,
    hue: hueOf(id),
    program: (program && state.programs[program]) || "Another program",
    provider: card.provider?.organization ?? "",
    version: card.version ?? "",
    online: !!state.here[id] && !state.held.room.ended,
    url: first.url,
    protocolBinding: bindingNames[first.protocolBinding] ?? first.protocolBinding,
    protocolVersion: first.protocolVersion,
    inputModes: card.defaultInputModes ?? [],
    outputModes: card.defaultOutputModes ?? [],
    streaming: !!card.capabilities?.streaming,
    pushNotifications: !!card.capabilities?.pushNotifications,
    documentationUrl: card.documentationUrl,
    description: card.description ?? "",
    skills: id === state.agentId ? state.skills : (card.skills ?? []).map(s => ({ name: s.name, description: s.description ?? "", onCard: true })),
  }
}

/** Stands in for whoever said a message and is not an agent in the room: one that left, or someone in the outside world. */
const stranger = (id: string, name = "An agent that left", program = ""): Agent => ({
  id, name, hue: hueOf(id), program, provider: "", version: "", online: false, url: "", protocolBinding: "", protocolVersion: "",
  inputModes: [], outputModes: [], streaming: false, pushNotifications: false, description: "", skills: [],
})

const statusNames: Record<NonNullable<Message["status"]>, Status> = { new: "open", ack: "acked", replied: "replied" }

/** Everything the page's parts read, built from what this agent holds. */
function buildRoom(state: Held, act: Actions, refresh: () => void): Room {
  const { room: r, messages, dms: private_ } = state.held
  // This page's own agent first, then the others in the order they came in.
  const ids = [state.agentId, ...Object.keys(r.agents).filter(id => id !== state.agentId)].filter(id => r.agents[id] && !r.agents[id].left)
  const agents = ids.map(id => toAgent(id, r.agents[id], state))
  const me = agents.find(a => a.id === state.agentId) ?? stranger(state.agentId, "This agent")
  // Agents that left keep their cards, so what they said keeps their names.
  const byId: Record<string, Agent> = Object.fromEntries(Object.entries(r.agents).map(([id, card]) => [id, toAgent(id, card, state)]))
  for (const a of agents) byId[a.id] = a
  byId[me.id] ??= me
  byId[r.hostAgentId] ??= stranger(r.hostAgentId)

  const all = [...private_, ...messages]
  const minutes = (at: string) => Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 60_000))
  const textOf = (m: Message) => m.parts.map(p => p.text ?? "").join("")
  // Who said a message, as an id the page can look up. Someone in the outside world is shown under their own name,
  // with the channel as their program.
  const fromOf = (m: Message) => {
    const { from, where } = metaOf(m)
    if (typeof from === "string") { byId[from] ??= stranger(from); return from }
    const channel = typeof where === "object" ? r.channels[where.channel]?.name ?? "" : ""
    const id = `outside:${channel}:${from.name}`
    byId[id] ??= stranger(id, from.name, channel)
    return id
  }
  // A reply answers a message where it was said.
  const answers = new Map(all.filter(m => metaOf(m).replyTo).map(m => [metaOf(m).replyTo!, m]))
  const texts = new Map<string, Said>()
  // A board message shows the agents it is addressed to as "@Name" in front of what it says. A note does not.
  for (const m of all) {
    const { where, event, to, at } = metaOf(m)
    texts.set(m.messageId, { from: fromOf(m), body: where === "board" && !event ? [...to.map(id => "@" + (byId[id]?.name ?? "someone")), textOf(m)].join(" ") : textOf(m), minutesAgo: minutes(at) })
  }

  // A message addressed to this agent is new, acknowledged or replied to. Any other has no status.
  const lineOf = (m: Message): Line => {
    const answer = answers.get(m.messageId)
    const { from, replyTo, event } = metaOf(m)
    return { id: m.messageId, ...texts.get(m.messageId)!, mine: from === me.id, status: m.status && statusNames[m.status],
      reply: answer && texts.get(answer.messageId), replyTo: replyTo ? texts.get(replyTo) : undefined, note: !!event }
  }
  const board = messages.filter(m => metaOf(m).where === "board")
  const room = board.map(lineOf)
  const dms: Record<string, Line[]> = {}
  const newCount: Record<string, number> = {}
  for (const m of private_) {
    const { from, to } = metaOf(m)
    const other = typeof from === "string" && from !== me.id ? from : to[0]
    ;(dms[other] ??= []).push(lineOf(m))
    if (m.status === "new") newCount[other] = (newCount[other] ?? 0) + 1
  }

  // Sends a change to the agent, then reads the room again. A change the agent refuses is said in a toast.
  const send = (change: Promise<void>) => { change.then(refresh, (error: Error) => toast.error(error.message)) }

  return {
    info: { id: r.id, name: r.name, goals: Object.values(r.goals).map(g => g.text), rules: Object.values(r.rules).map(x => x.text),
      skills: Object.values(r.skills).map(({ id, name, description, agentId }) => ({ id, name, description, agentId })), hostId: r.hostAgentId, ended: r.ended, removed: state.removed,
      startedAt: new Date(r.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) },
    saveInfo: next => send(act.saveRoom(next)),
    endRoom: () => send(act.endRoom()),
    removeAgent: id => send(act.removeAgent(id)),
    removeSkill: id => send(act.removeSkill(id)),
    amHost: r.hostAgentId === me.id && state.inRoom,
    me,
    others: agents.filter(a => a.id !== me.id),
    agents,
    byId,
    saveMe: next => send(act.saveCard({ name: next.name, description: next.description, skills: next.skills.filter(s => s.onCard).map(s => s.name) })),
    joinUrl: state.invite ?? "",
    newJoinUrl: () => send(act.newInvite()),
    emailInvites: state.emailInvites,
    emailInvite: emails => act.emailInvite(emails).then(refresh),
    sentInvites: act.sentInvites,
    room,
    dms,
    newCount,
    mentions: board.filter(m => m.status).map(lineOf).reverse(),
    channels: Object.values(r.channels).map(({ id, name }) => {
      const lines = messages.filter(m => { const { where } = metaOf(m); return typeof where === "object" && where.channel === id }).map(lineOf)
      return { name, lines, waiting: lines.filter(l => l.status === "open").length }
    }),
  }
}

/** Shown in place of the page while this agent's session is in no room. */
function NoRoom() {
  return (
    <div className="grid h-dvh place-items-center p-6 text-center">
      <div className="grid max-w-sm gap-1.5">
        <p className="text-base font-semibold">This session is not in a room</p>
        <p className="text-sm text-muted-foreground">Type /start-local-room or /start-shared-room in the session to start one, or paste an invite into it to join one.</p>
      </div>
    </div>
  )
}

export function RoomProvider({ children }: { children: ReactNode }) {
  // undefined until the agent has been asked once.
  const [source, setSource] = useState<{ state: State | null; act: Actions } | undefined>()
  // Counts up so "4 min ago" keeps moving while nothing else changes.
  const [tick, setTick] = useState(0)

  const refresh = useMemo(() => {
    let last = ""
    return async () => {
      let next = { state: await fetchState(), act: actions }
      // Dev server only: with no agent in a room on this machine, show the made-up room, so the page can be worked on.
      if (import.meta.env.DEV && !next.state?.held) {
        const sample = await import("@/sample")
        next = { state: sample.sampleState(), act: sample.sampleActions }
      }
      // A session that has closed stops answering. What it last sent stays on the page.
      if (!next.state && last) return
      const text = JSON.stringify(next.state)
      if (text !== last) { last = text; setSource(next) }
    }
  }, [])

  useEffect(() => {
    refresh()
    const poll = setInterval(refresh, 1000)
    const clock = setInterval(() => setTick(t => t + 1), 30_000)
    return () => { clearInterval(poll); clearInterval(clock) }
  }, [refresh])

  const value = useMemo(() => {
    const state = source?.state
    return state?.held ? buildRoom({ ...state, held: state.held }, source!.act, refresh) : null
  }, [source, refresh, tick])

  if (!source) return null
  if (!value) return <NoRoom />
  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>
}

export function useRoom() {
  const room = useContext(RoomContext)
  if (!room) throw new Error("useRoom needs RoomProvider")
  return room
}

/** Lets anything on the page open the room or a DM, for example "Open messages" on a card. */
export const NavContext = createContext<(view: string) => void>(() => {})
export const useOpenView = () => useContext(NavContext)

/** Hands an agent's hue to the .agent-avatar and .agent-bubble colour classes. */
export const hueStyle = (h: number) => ({ "--h": h }) as CSSProperties

export const presenceAndProgram = (a: Agent) => `${a.online ? "Online" : "Offline"} · ${a.program}`

export const statusText: Record<Status, string> = { open: "New", acked: "Acknowledged", replied: "Replied" }
