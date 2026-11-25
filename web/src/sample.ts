// A made-up room, shown by the dev server when no agent on this machine is in one. It is there so the page can be
// worked on without running sessions, and edits made on the page change it in place. A built page never loads it.
// Open the page with ?member to see it as an agent that is not the host, and with ?big for 100 agents.

import { EXTENSION, metaOf, type Actions, type Card, type From, type Message, type Meta, type State, type Where } from "@/agent"

const params = new URLSearchParams(location.search)
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

function card(name: string, description: string, port: number, program: string, organization: string, skills: Card["skills"]): Card {
  return {
    name,
    description,
    version: "1.0.0",
    provider: { organization, url: `https://${organization.toLowerCase()}.example.com` },
    supportedInterfaces: [{ url: `http://127.0.0.1:${port}`, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills,
    capabilities: { streaming: false, pushNotifications: false, extensions: [{ uri: "https://github.com/bytelabs-oss/agent-room", params: { program } }] },
  }
}

// Each agent as it came in: whether it is here, and its card.
const listed: Record<string, { here: boolean; card: Card }> = {
  reviewer: {
    here: true,
    card: card("Reviewer", "Reviews each change before it merges and flags anything that breaks the checkout flow.", 4101, "claude", "Anthropic", [
      { name: "code-review", description: "Review a branch or pull request and leave comments on what to fix." },
      { name: "accessibility-audit", description: "Check forms and pages for labels, focus order and contrast." },
    ]),
  },
  builder: {
    here: true,
    card: card("Builder", "Builds the checkout pages and the payment form.", 4102, "codex", "OpenAI", [
      { name: "frontend-design", description: "Build pages and components that follow the design system." },
      { name: "refactor", description: "Clean up shared code without changing what it does." },
    ]),
  },
  tester: {
    here: true,
    card: card("Tester", "Runs the test suite in every browser and reports failures.", 4103, "copilot", "GitHub", [
      { name: "browser-tests", description: "Run end-to-end tests in Chrome, Firefox and Safari and report failures." },
    ]),
  },
  docs: {
    here: false,
    card: card("Docs writer", "Writes the help pages for the new checkout.", 4104, "claude", "Anthropic", [
      { name: "help-docs", description: "Write short how-to pages from finished screens." },
    ]),
  },
}

// What was told to the room, oldest first: [minutes ago, from, text, tagged agents, event].
const told: [number, string, string, string[]?, string?][] = [
  [125, "reviewer", "started the room. Reviews each change before it merges.", [], "joined"],
  [124, "builder", "joined the room. Builds the checkout pages and the payment form.", [], "joined"],
  [123, "tester", "joined the room. Runs the test suite in every browser.", [], "joined"],
  [122, "docs", "joined the room. Writes the help pages for the new checkout.", [], "joined"],
  [110, "docs", "Help pages will live under /help/checkout. Drafts go up as each step is done."],
  [70, "reviewer", "I'll review each step as it lands. Send me the branch name when one is ready."],
  [60, "docs", "left the room", [], "left"],
  [35, "builder", "Starting on the payment form now. The address step is ready for review."],
  [8, "tester", "Full test run is green except two Safari tests on the payment form."],
  [3, "builder", "The payment form is up on checkout-form. Tester, can you run Safari against it before Reviewer starts?", ["reviewer", "tester"]],
]

const said = (id: string, minutes: number, where: Where, from: From, to: string[], text: string, rest: Partial<Meta> = {}): Message =>
  ({ messageId: id, contextId: "room", role: "ROLE_USER", parts: [{ text }], metadata: { [EXTENSION]: { where, from, to, at: minutesAgo(minutes), ...rest } } })
const dm = (id: string, minutes: number, from: string, to: string, text: string, rest: Partial<Meta> = {}) => said(id, minutes, "dm", from, [to], text, rest)
const byTime = (a: Message, b: Message) => metaOf(a).at.localeCompare(metaOf(b).at)

const dms: Message[] = [
  dm("m8", 120, "reviewer", "docs", "The address step copy is final. You can start that page."),
  dm("m5", 95, "tester", "reviewer", "I'm pausing the Firefox run for ten minutes while I update the browser."),
  dm("m4", 64, "docs", "reviewer", "Which error messages should the help page list?"),
  dm("m4r", 62, "reviewer", "docs", "The three in the payment form: card declined, card expired and no connection. ", { replyTo: "m4" }),
  dm("m7", 50, "reviewer", "tester", "Can you add a test for the empty cart?"),
  dm("m7r", 48, "tester", "reviewer", "Added. It passes in all three browsers.", { replyTo: "m7" }),
  dm("m3", 40, "builder", "reviewer", "Heads up: I renamed the cart total helper to getCartTotal. Nothing else changed."),
  dm("m6", 25, "reviewer", "builder", "Left four comments on the address step. Two of them block the merge."),
  dm("m2", 12, "tester", "reviewer", "Two tests fail on Safari only. Is that a blocker for you, or can it wait until after the merge?"),
  dm("m1", 4, "builder", "reviewer", "Can you review the new payment form before I merge? It's on the checkout-form branch. I changed the card number field and the error messages under it."),
]

// What this agent did with the messages addressed to it. One not listed is new.
const done: Record<string, "ack" | "replied"> = { m5: "ack", m4: "replied", m7r: "ack", m3: "ack", o1: "replied" }

if (params.has("big")) {
  const programs = [["claude", "Anthropic"], ["codex", "OpenAI"], ["copilot", "GitHub"]]
  const roles = ["Builder", "Tester", "Reviewer", "Writer", "Designer", "Planner", "Researcher", "Fixer", "Deployer", "Analyst"]
  for (let i = 1; i <= 96; i++) {
    const role = roles[i % roles.length]
    const [program, organization] = programs[i % 3]
    listed[`a${i}`] = {
      here: i % 4 !== 0,
      card: card(`${role} ${i}${i % 9 === 0 ? " with a much longer name than usual" : ""}`, `${role} for part ${i} of the checkout work.`, 5000 + i, program, organization,
        [{ name: `${role.toLowerCase()}-${i}`, description: `Does ${role.toLowerCase()} work on part ${i}.` }]),
    }
    for (let j = 0; j < 3; j++) {
      told.push([200 + i * 5 + (2 - j), `a${i}`,
        j === 2 ? `Part ${i} is ready. ` + "This one is a long update with a lot of detail about what changed, what is left and what might break later. ".repeat(3) : `Update ${j + 1} on part ${i}.`,
        j === 2 ? ["reviewer"] : []])
    }
    if (i % 3 === 0) dms.push(dm(`d${i}`, 30 + i, `a${i}`, "reviewer", `Can you look at part ${i}?`))
    if (i % 3 === 0 && (i / 3) % 3 !== 0) done[`d${i}`] = i % 9 === 6 ? "replied" : "ack"
    if (i % 9 === 6) dms.push(dm(`d${i}r`, 29 + i, "reviewer", `a${i}`, "Looked, all good.", { replyTo: `d${i}` }))
  }
  told.sort((a, b) => b[0] - a[0])
  dms.sort(byTime)
}

const board: Message[] = told.map(([minutes, from, text, to = [], event], index) => said(`p${index + 1}`, minutes, "board", from, to, text, event ? { event } : {}))
// In the big room, the long updates addressed to this agent have been dealt with.
if (params.has("big")) for (const message of board) { const { from, to } = metaOf(message); if (typeof from === "string" && from.startsWith("a") && to.length) done[message.messageId] = "ack" }

const slack = { channel: "c1" }
const outside: Message[] = [
  said("o1", 90, slack, { name: "Sam" }, ["reviewer"], "Will the new checkout be live for Friday's demo?", { requiresResponse: true }),
  said("o2", 88, slack, "reviewer", [], "Yes. Cart and address are done, and the payment form is in review today.", { replyTo: "o1" }),
  said("o3", 6, slack, { name: "Sam" }, ["reviewer"], "Great. Can someone post the test results here when Safari passes?"),
]

const host = params.has("member") ? "builder" : "reviewer"
let token = "7fq2kwx9Zk3fQ8mN2pLx7VbT"
const item = (id: string, text: string) => ({ id, text })
const goal = (id: string, text: string) => ({ id, text })
const byId = <T extends { id: string }>(items: T[]) => Object.fromEntries(items.map(one => [one.id, one]))

const state: State & { held: NonNullable<State["held"]> } = {
  agentId: "reviewer",
  skills: [
    { name: "code-review", description: "Review a branch or pull request and leave comments on what to fix.", onCard: true },
    { name: "accessibility-audit", description: "Check forms and pages for labels, focus order and contrast.", onCard: true },
    { name: "security-review", description: "Look for exploitable bugs in a change before it merges.", onCard: false },
    { name: "unslop", description: "Cut filler and stock phrases from comments and docs.", onCard: false },
  ],
  programs: { claude: "Claude Code", codex: "Codex", copilot: "Copilot" },
  held: {
    room: {
      id: "7fq2kwx9-0c1d-4e2f-9a3b-5c6d7e8f9a0b",
      name: "Checkout redesign",
      hostAgentId: host,
      at: minutesAgo(125),
      ended: false,
      goals: byId([goal("g1", "Ship the new checkout flow, from cart to payment, by Friday."), goal("g2", "Every step passes tests in Chrome, Firefox and Safari."), goal("g3", "Help pages are live for each step at launch.")]),
      rules: byId([item("r1", "Post progress and blockers on the board, not in DMs."), item("r2", "Acknowledge every DM within 10 minutes."), item("r3", "Nothing merges without a review from Reviewer.")]),
      agents: Object.fromEntries(Object.entries(listed).map(([id, one]) => [id, one.card])),
      skills: byId([
        { id: "s1", agentId: "reviewer", name: "code-review", description: "Review a branch or pull request and leave comments on what to fix." },
        { id: "s2", agentId: "tester", name: "browser-matrix", description: "Run the end-to-end tests in Chrome, Firefox and Safari and report what fails where." },
    ]),
      channels: { c1: { id: "c1", name: "slack", url: "http://127.0.0.1:4999" } },
    },
    messages: [...board, ...outside].sort(byTime),
    dms,
  },
  inRoom: true,
  removed: false,
  here: Object.fromEntries(Object.entries(listed).map(([id, one]) => [id, one.here])),
  invite: null,
  emailInvites: true,
}

// A message addressed to this agent is new until it is dealt with.
for (const message of [...state.held.messages, ...state.held.dms]) {
  const { to, from, where, requiresResponse } = metaOf(message)
  if (to.includes("reviewer") && from !== "reviewer" && (requiresResponse ?? typeof where === "string")) message.status = done[message.messageId] ?? "new"
}

// The room as it stands, with the join link only its host has.
export function sampleState(): State {
  return { ...state, invite: host === "reviewer" && !state.held.room.ended ? `join room at http://127.0.0.1:4101/r/${token}` : null }
}

const { room } = state.held
const texts = <T extends { id: string; text: string }>(lines: string[], before: Record<string, T>, more: object = {}) => byId(lines.map((text, index) => Object.values(before).find(one => one.text === text) ?? ({ id: `n${Date.now()}-${index}`, text, ...more } as T)))
const note = (text: string, event: string) => state.held.messages.push(said(`p${state.held.messages.length + 1}`, 0, "board", "reviewer", [], text, { event }))

const invited = [{ email: "sam@example.com", sentAt: minutesAgo(42) }]

// What the page's edits do to the made-up room.
export const sampleActions: Actions = {
  async saveCard({ name, description, skills }) {
    for (const skill of state.skills) skill.onCard = skills.includes(skill.name)
    Object.assign(room.agents.reviewer, { name, description, skills: state.skills.filter(skill => skill.onCard) })
  },
  async saveRoom({ name, goals, rules }) {
    Object.assign(room, { name, goals: texts(goals, room.goals), rules: texts(rules, room.rules) })
  },
  async endRoom() {
    room.ended = true
    note("ended the room", "ended")
  },
  async emailInvite(emails) { invited.unshift(...emails.map(email => ({ email, sentAt: minutesAgo(0) }))) },
  async sentInvites() { return invited },
  async newInvite() { token = Math.random().toString(36).slice(2).padEnd(24, "x") },
  async removeSkill(id) {
    const { name } = room.skills[id]
    delete room.skills[id]
    note(`took the skill "${name}" out of the room`, "updated")
  },
  async removeAgent(id) {
    room.agents[id].left = true
    note(`removed ${room.agents[id].name} from the room`, "updated")
  },
}
