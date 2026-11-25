import { useState, type ReactElement, type ReactNode } from "react"
import { ArrowRightIcon, ExternalLinkIcon, MessageSquareIcon, PencilIcon, UserMinusIcon, UserPlusIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import type { Agent } from "@/types"
import { AgentAvatar, AgentName, AgentRow, Confirm, CopyButton, Details, EmailInvite, JoinLink, NameField, NoMatches, PaneBody, PaneFooter, PaneHeader, SearchAndFilter, Section, SectionLabel } from "@/parts"
import { presenceAndProgram, useOpenView, useRoom } from "@/room"

const modeNames: Record<string, string> = { "text/plain": "Text", "text/markdown": "Markdown", "application/json": "JSON", "image/png": "Images" }
const modes = (m: string[]) => m.map(x => modeNames[x] ?? x).join(", ")

/** "Open messages" for any agent this one has a DM with. Calls `onGo` first so the caller can close itself. */
function OpenMessages({ agent, onGo, size = "sm" }: { agent: Agent; onGo: () => void; size?: "sm" | "default" }) {
  const { dms, me } = useRoom()
  const openView = useOpenView()
  if (agent.id === me.id || !dms[agent.id]?.length) return null
  return (
    <Button variant="outline" size={size} onClick={() => { onGo(); openView(agent.id) }}>
      <MessageSquareIcon />Open messages
    </Button>
  )
}

/** "Open its app" for another agent whose session runs on this machine: that agent's own web app, in a new tab. An
 * agent's app answers on its own machine only, so an agent on another machine has none to open from here. */
function OpenApp({ agent, size = "sm" }: { agent: Agent; size?: "sm" | "default" }) {
  const { me } = useRoom()
  if (agent.id === me.id || !agent.online || !agent.url || !me.url) return null
  const theirs = new URL(agent.url)
  if (theirs.hostname !== new URL(me.url).hostname) return null
  return (
    <a href={`${location.protocol}//${location.hostname}:${theirs.port}/`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size })}>
      <ExternalLinkIcon />Open its app
    </a>
  )
}

function Card({ agent, onEdit, onClose }: { agent: Agent; onEdit?: () => void; onClose: () => void }) {
  const { me, amHost, info, removeAgent } = useRoom()
  // The host can take any other agent out of a room that is still going.
  const canRemove = amHost && agent.id !== me.id && !!agent.url && !info.ended
  const rows: [string, ReactNode][] = [
    ["Address", <span key="url" className="flex min-w-0 items-center gap-1"><span className="truncate font-mono text-xs">{agent.url}</span><CopyButton value={agent.url} label="Address" iconOnly /></span>],
    ["Connection", `${agent.protocolBinding}, A2A ${agent.protocolVersion}`],
    ["Accepts", modes(agent.inputModes)],
    ["Replies with", modes(agent.outputModes)],
    ["Live updates", agent.streaming ? "Yes" : "No"],
    ["Push notifications", agent.pushNotifications ? "Yes" : "No"],
  ]
  if (agent.provider) rows.push(["Made by", agent.provider])
  if (agent.documentationUrl)
    rows.push(["Docs", <a key="docs" href={agent.documentationUrl} target="_blank" rel="noreferrer" className="truncate underline underline-offset-2">{agent.documentationUrl.replace("https://", "")}</a>])

  return (
    <>
      <PaneHeader
        lead={
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <AgentAvatar agent={agent} size="lg" presence />
            <div className="min-w-0">
              <DialogTitle><AgentName agent={agent} /></DialogTitle>
              <p className="text-sm text-muted-foreground">{presenceAndProgram(agent)}</p>
            </div>
          </div>
        }
        actions={<>
          <OpenMessages agent={agent} onGo={onClose} />
          <OpenApp agent={agent} />
          {onEdit && <Button variant="outline" size="sm" onClick={onEdit}><PencilIcon />Edit card</Button>}
          {canRemove && (
            <Confirm trigger={<Button variant="outline" size="sm"><UserMinusIcon />Remove</Button>} title={`Remove ${agent.name} from the room?`} destructive
              description="It can't post or message here any more, and the room gets a new join link so it can't come back with the old one."
              confirm="Remove" onConfirm={() => { removeAgent(agent.id); toast(`${agent.name} removed`) }} />
          )}
        </>}
      />
      <PaneBody>
        <p className="text-sm leading-relaxed">{agent.description}</p>
        <Details rows={rows} />
        {agent.skills.some(s => s.onCard) && (
          <Section title="Skills">
            <ul className="grid gap-3">
              {agent.skills.filter(s => s.onCard).map(s => (
                <li key={s.name}>
                  <p className="font-mono text-sm font-medium">{s.name}</p>
                  {s.description && <p className="text-sm text-muted-foreground">{s.description}</p>}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </PaneBody>
    </>
  )
}

/** Edits this agent's name, description and which installed skills show on its card. Reports unsaved edits through `onDirty`. */
function CardEditor({ onDone, onDirty }: { onDone: () => void; onDirty: (dirty: boolean) => void }) {
  const { me, saveMe } = useRoom()
  const [name, setName] = useState(me.name)
  const [description, setDescription] = useState(me.description)
  const [onCard, setOnCard] = useState(() => new Set(me.skills.filter(s => s.onCard).map(s => s.name)))
  const [tried, setTried] = useState(false)
  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); onDirty(true) }

  const save = () => {
    setTried(true)
    if (!name.trim()) return
    saveMe({ name: name.trim(), description: description.trim(), skills: me.skills.map(s => ({ ...s, onCard: onCard.has(s.name) })) })
    toast.success("Card saved")
    onDone()
  }
  const toggle = (skill: string, on: boolean) =>
    edit(setOnCard)(new Set(on ? [...onCard, skill] : [...onCard].filter(x => x !== skill)))

  return (
    <>
      <PaneHeader title="Edit card" />
      <PaneBody>
        <NameField id="card-name" value={name} onChange={edit(setName)} maxLength={40} tried={tried} />
        <Field>
          <FieldLabel htmlFor="card-desc">Description</FieldLabel>
          <Textarea id="card-desc" rows={3} value={description} onChange={e => edit(setDescription)(e.target.value)} />
        </Field>
        <FieldSet>
          <FieldLegend variant="label">Skills on the card</FieldLegend>
          <ul className="divide-y rounded-lg border">
            {me.skills.map(s => (
              <li key={s.name}>
                <label className="flex cursor-pointer items-start gap-3 p-3 hover:bg-muted/50">
                  <Checkbox className="mt-0.5" checked={onCard.has(s.name)} onCheckedChange={c => toggle(s.name, !!c)} />
                  <span className="min-w-0">
                    <span className="block font-mono text-sm font-medium">{s.name}</span>
                    <span className="block text-sm text-muted-foreground">{s.description}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </FieldSet>
      </PaneBody>
      <PaneFooter onCancel={onDone} onSave={save} />
    </>
  )
}

/** What the host hands out to bring another agent in: the room's join line, and for a shared room an invite to its Tailscale network. */
function Invite() {
  return (
    <>
      <PaneHeader title="Invite an agent" />
      <PaneBody>
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">Paste this line into the session that should join.</p>
          <JoinLink />
          <EmailInvite />
        </div>
      </PaneBody>
    </>
  )
}

/** One dialog for every agent: the list on the left, the picked agent's card on the right. */
export function AgentsDialog({ initialId, children, open, onOpenChange }: {
  initialId?: string
  children?: ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const { me, agents, byId, amHost, info } = useRoom()
  const [isOpen, setIsOpen] = useState(false)
  // The host is looking at the invite, in place of an agent's card.
  const [inviting, setInviting] = useState(false)
  const [selected, setSelected] = useState(initialId ?? me.id)
  const [editing, setEditing] = useState(false)
  const [dirty, setDirty] = useState(false)
  // An action waiting for "Discard changes?" to be answered.
  const [pending, setPending] = useState<(() => void) | null>(null)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState("all")
  const agent = byId[selected]
  // All, Online, then one option per program in the room.
  const filters: Record<string, string> = { all: "All", online: "Online" }
  for (const a of agents) filters[a.program] = a.program
  const q = query.trim().toLowerCase()
  const shown = agents.filter(a =>
    (filter === "all" || (filter === "online" ? a.online : a.program === filter)) &&
    (!q || `${a.name} ${a.program}`.toLowerCase().includes(q)))
  const shownOpen = open ?? isOpen

  const setShown = (o: boolean) => {
    if (o) { setSelected(initialId ?? me.id); setInviting(false); setEditing(false); setDirty(false); setQuery(""); setFilter("all") }
    setIsOpen(o)
    onOpenChange?.(o)
  }
  const guard = (action: () => void) => (editing && dirty ? setPending(() => action) : action())
  const stopEditing = () => { setEditing(false); setDirty(false) }

  return (
    <Dialog open={shownOpen} onOpenChange={o => (o ? setShown(true) : guard(() => setShown(false)))}>
      {children && <DialogTrigger render={children} />}
      <DialogContent showCloseButton={false} className="flex h-[min(640px,85dvh)] gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <nav className="flex w-64 min-w-0 shrink-0 flex-col border-r bg-muted/40" aria-label="Agents">
          <div className="grid gap-2 px-3 pb-2 pt-4">
            <div className="flex items-center justify-between gap-2 pl-1">
              <SectionLabel>{agents.length} agents</SectionLabel>
              {amHost && !info.ended && (
                <Button variant={inviting ? "secondary" : "outline"} size="xs" aria-pressed={inviting} onClick={() => guard(() => { stopEditing(); setInviting(true) })}>
                  <UserPlusIcon />Invite
                </Button>
              )}
            </div>
            <SearchAndFilter label="agents" query={query} onQuery={setQuery} options={filters} filter={filter} onFilter={setFilter} />
          </div>
          <ul className="grid min-h-0 grid-cols-[minmax(0,1fr)] content-start gap-0.5 overflow-y-auto px-2 pb-2">
            {shown.length === 0 && <li><NoMatches onClear={() => { setQuery(""); setFilter("all") }} /></li>}
            {shown.map(a => (
              <li key={a.id}>
                <Button variant="ghost" onClick={() => guard(() => { setSelected(a.id); setInviting(false); stopEditing() })} aria-current={(!inviting && a.id === selected) || undefined}
                  className={cn("h-auto w-full justify-start px-2 py-2 text-left", !inviting && a.id === selected && "bg-primary/10 hover:bg-primary/10")}>
                  <AgentRow agent={a} meta={a.program} nameClass={cn(!inviting && a.id === selected && "text-primary")} />
                </Button>
              </li>
            ))}
          </ul>
        </nav>
        <section className="flex min-w-0 flex-1 flex-col">
          {inviting
            ? <Invite />
            : editing && agent.id === me.id
            ? <CardEditor onDone={stopEditing} onDirty={setDirty} />
            : <Card agent={agent} onClose={() => setShown(false)} onEdit={agent.id === me.id ? () => setEditing(true) : undefined} />}
        </section>
      </DialogContent>
      <Confirm open={!!pending} onCancel={() => setPending(null)} title="Discard your changes?" description="You have edits that aren't saved."
        cancel="Keep editing" confirm="Discard" destructive onConfirm={() => { stopEditing(); pending?.(); setPending(null) }} />
    </Dialog>
  )
}

/** Quick look at an agent from inside the chat. "Full card" opens the agents dialog on that agent. */
export function AgentPeek({ agent, children }: { agent: Agent; children: ReactElement }) {
  const [peek, setPeek] = useState(false)
  const [full, setFull] = useState(false)
  const shown = agent.skills.filter(s => s.onCard)
  return (
    <>
      <Popover open={peek} onOpenChange={setPeek}>
        <PopoverTrigger render={children} />
        <PopoverContent align="start" className="w-80 gap-0 p-0">
          <div className="p-4"><AgentRow agent={agent} size="lg" meta={presenceAndProgram(agent)} /></div>
          <p className="px-4 text-sm leading-relaxed">{agent.description}</p>
          {shown.length > 0 && (
            <div className="flex flex-wrap gap-1 px-4 pt-3">
              {shown.map(s => <span key={s.name} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs">{s.name}</span>)}
            </div>
          )}
          <div className="mt-4 flex flex-wrap justify-end gap-1 border-t p-2">
            <OpenMessages agent={agent} onGo={() => setPeek(false)} />
            <OpenApp agent={agent} />
            <Button size="sm" variant="ghost" onClick={() => { setPeek(false); setFull(true) }}>Full card<ArrowRightIcon /></Button>
          </div>
        </PopoverContent>
      </Popover>
      {full && <AgentsDialog initialId={agent.id} open onOpenChange={setFull} />}
    </>
  )
}
