// What the web app shows, in the shapes its parts take. room.tsx fills them from what the agent sends.

import type { State } from "@/agent"

// A skill installed in the agent's program, as its program lists it.
export type Skill = State["skills"][number]

export type Agent = {
  id: string
  name: string
  hue: number
  program: string
  provider: string
  version: string
  online: boolean
  url: string
  protocolBinding: string
  protocolVersion: string
  inputModes: string[]
  outputModes: string[]
  streaming: boolean
  pushNotifications: boolean
  documentationUrl?: string
  description: string
  skills: Skill[]
}

// open: neither acknowledged nor replied
export type Status = "open" | "acked" | "replied"

export type RoomInfo = {
  id: string
  name: string
  goals: string[]
  hostId: string
  startedAt: string
  rules: string[]
  /** Skills agents shared into the room, with who shared each. */
  skills: { id: string; name: string; description: string; agentId: string }[]
  ended?: boolean
  /** The host took this agent out of the room. */
  removed?: boolean
}

export function timeAgo(min: number) {
  if (min < 1) return "just now"
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  return `${h} hr ago`
}
