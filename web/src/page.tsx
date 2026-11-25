import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react"
import { ArrowDownIcon, ArrowUpIcon, AtSignIcon, ChevronDownIcon, ChevronUpIcon, HashIcon, RadioIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AgentsDialog } from "@/agents"
import { timeAgo } from "@/types"
import { Thread, useConversations } from "@/messages"
import { AgentAvatar, AgentRow, CountBadge, NoMatches, SearchAndFilter, SectionLabel } from "@/parts"
import { NavContext, useRoom, type Line } from "@/room"
import { RoomDialog } from "@/room-info"
import { ThemeToggle } from "@/theme"

const filters = { all: "All", new: "New messages", online: "Online" }
type Filter = keyof typeof filters

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches
const scrollBehavior = (): ScrollBehavior => (reducedMotion() ? "auto" : "smooth")

/**
 * Briefly rings a message: the ring (the bubble's ::after) settles in, holds, then fades.
 * Only opacity and scale move, with the shared ease-out curve; exit is quicker than the hold.
 */
function flashOutline(el: HTMLElement) {
  const ease = "cubic-bezier(0.23, 1, 0.32, 1)"
  el.animate([
    { opacity: 0, scale: reducedMotion() ? 1 : 1.04, easing: ease },
    { opacity: 1, scale: 1, offset: 0.18 },
    { opacity: 1, scale: 1, offset: 0.7, easing: ease },
    { opacity: 0, scale: 1 },
  ], { id: "jump-outline", duration: 850, pseudoElement: "::after" })
}

function Logo() {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2.5 border-b px-4">
      {/* Three agents, each its own size and colour. */}
      <span className="flex items-center" aria-hidden>
        <span className="size-3 rounded-full bg-primary" />
        <span className="-ml-0.5 size-2 rounded-full bg-success" />
        <span className="size-1.5 rounded-full bg-attention" />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">agent<span className="text-muted-foreground">-</span>rooms</span>
      <ThemeToggle />
    </div>
  )
}

function NavItem({ active, onClick, children }: { active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button variant="ghost" onClick={onClick} aria-current={active || undefined}
      className={cn("h-auto min-h-9 w-full min-w-0 justify-start px-2 py-1.5 text-left font-normal", active && "bg-muted font-medium")}>
      {children}
    </Button>
  )
}

/** Steps through mentions, newest first. Up goes to older ones, down to newer ones; neither wraps. Its number is the new ones. */
function MentionStepper({ items, onGo }: { items: Line[]; onGo: (line: Line) => void }) {
  const [at, setAt] = useState(-1)
  const go = (i: number) => { setAt(i); onGo(items[i]) }
  return (
    <ButtonGroup>
      <Button variant="outline" size="sm" onClick={() => go(Math.min(at + 1, items.length - 1))}>
        <AtSignIcon />Mentions
        <span className="text-xs font-normal text-muted-foreground tabular-nums">{at < 0 ? items.filter(l => l.status === "open").length || "" : `${at + 1} of ${items.length}`}</span>
      </Button>
      <Button variant="outline" size="icon-sm" aria-label="Older mention" disabled={at >= items.length - 1} onClick={() => go(at + 1)}><ChevronUpIcon /></Button>
      <Button variant="outline" size="icon-sm" aria-label="Newer mention" disabled={at <= 0} onClick={() => go(at - 1)}><ChevronDownIcon /></Button>
    </ButtonGroup>
  )
}

function JumpButton({ to, block, children }: { to: RefObject<HTMLDivElement | null>; block: ScrollLogicalPosition; children: ReactNode }) {
  return (
    <Button size="sm" variant="outline" className="jump-in rounded-full bg-background shadow-md dark:bg-background dark:hover:bg-muted"
      onClick={() => to.current?.scrollIntoView({ behavior: scrollBehavior(), block })}>
      {children}
    </Button>
  )
}

export function Page() {
  const { me, agents, byId, info, dms, mentions, channels } = useRoom()
  const conversations = useConversations()
  const [open, setOpen] = useState("room")
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  // What is open: the room, an outside channel as "outside:<name>", or the direct messages with one agent.
  const channel = open.startsWith("outside:") ? open.slice(8) : undefined
  const agent = open === "room" || channel ? null : byId[open]

  const q = query.trim().toLowerCase()
  const shown = conversations
    .map(c => ({ ...c, match: q ? dms[c.agent.id].findLast(l => l.body.toLowerCase().includes(q)) : undefined }))
    .filter(c => c.agent.id === open || (
      (filter === "all" || (filter === "new" ? c.waiting > 0 : c.agent.online)) &&
      (!q || c.match || c.agent.name.toLowerCase().includes(q))))

  const start = useRef<HTMLDivElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const [atTop, setAtTop] = useState(true)
  const [atLatest, setAtLatest] = useState(true)
  // A message to scroll to once its view has rendered, instead of the newest one.
  const target = useRef<string | null>(null)
  // Stops an earlier jump that's still waiting for its scroll to finish.
  const pending = useRef<() => void>(undefined)

  // Scrolls to the requested message and outlines it once the scroll stops, or goes to the newest message.
  const scrollToTarget = () => {
    const el = target.current && document.getElementById(`msg-${target.current}`)
    target.current = null
    if (!el) return end.current?.scrollIntoView({ block: "end" })
    pending.current?.()
    document.getAnimations().forEach(a => a.id === "jump-outline" && a.cancel())
    const viewport = el.closest<HTMLElement>("[data-slot=scroll-area-viewport]")!
    const box = el.getBoundingClientRect(), view = viewport.getBoundingClientRect()
    if (box.top >= view.top && box.bottom <= view.bottom) return flashOutline(el)
    const settle = () => { stop(); flashOutline(el) }
    const timer = "onscrollend" in window ? undefined : setTimeout(settle, 700)
    const stop = () => { viewport.removeEventListener("scrollend", settle); clearTimeout(timer); pending.current = undefined }
    viewport.addEventListener("scrollend", settle)
    pending.current = stop
    el.scrollIntoView({ behavior: scrollBehavior(), block: "center" })
  }
  const goTo = (view: string, messageId: string) => {
    target.current = messageId
    if (view === open) scrollToTarget()
    else setOpen(view)
  }

  // Wait a frame so the messages are laid out before scrolling.
  useEffect(() => {
    const id = requestAnimationFrame(scrollToTarget)
    return () => cancelAnimationFrame(id)
  }, [open])

  // Top and Latest show only while their end of the list is out of view.
  useEffect(() => {
    const watch = new IntersectionObserver(entries => {
      for (const e of entries) (e.target === start.current ? setAtTop : setAtLatest)(e.isIntersecting)
    })
    watch.observe(start.current!)
    watch.observe(end.current!)
    return () => watch.disconnect()
  }, [])

  return (
    <NavContext.Provider value={setOpen}>
      <div className="flex h-full min-h-0">
        <aside className="flex w-96 shrink-0 flex-col border-r bg-background">
          <Logo />
          <div className="shrink-0 p-2">
            <AgentsDialog initialId={me.id}>
              <Button variant="ghost" className="h-auto w-full justify-start p-2 text-left">
                <AgentRow agent={me} size="lg" meta={me.program} nameClass="text-base font-semibold" />
              </Button>
            </AgentsDialog>
          </div>

          <SectionLabel className="shrink-0 px-4 pt-3 pb-1">Rooms</SectionLabel>
          <div className="max-h-40 shrink-0 overflow-y-auto px-2">
            <NavItem active={open === "room"} onClick={() => setOpen("room")}>
              <HashIcon className="text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate" title={info.name}>{info.name}</span>
              <CountBadge n={mentions.filter(l => l.status === "open").length} label="new mentions" />
            </NavItem>
          </div>

          {channels.length > 0 && <>
            <SectionLabel className="shrink-0 px-4 pt-5 pb-1">Outside</SectionLabel>
            <div className="max-h-40 shrink-0 overflow-y-auto px-2">
              {channels.map(c => (
                <NavItem key={c.name} active={channel === c.name} onClick={() => setOpen(`outside:${c.name}`)}>
                  <RadioIcon className="text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate" title={c.name}>{c.name}</span>
                  <CountBadge n={c.waiting} label="new" />
                </NavItem>
              ))}
            </div>
          </>}

          <SectionLabel className="shrink-0 px-4 pt-5 pb-1">Direct messages</SectionLabel>
          <div className="shrink-0 px-2 pb-1">
            <SearchAndFilter label="direct messages" query={query} onQuery={setQuery} options={filters} filter={filter} onFilter={setFilter} />
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="grid gap-0.5 px-2 pb-2">
              {shown.length === 0 && (q || filter !== "all"
                ? <NoMatches onClear={() => { setQuery(""); setFilter("all") }} />
                : <p className="px-2 py-4 text-center text-sm text-muted-foreground">No direct messages yet.</p>)}
              {shown.map(c => (
                <NavItem key={c.agent.id} active={open === c.agent.id} onClick={() => (c.match ? goTo(c.agent.id, c.match.id) : setOpen(c.agent.id))}>
                  <AgentRow agent={c.agent}
                    nameClass={cn(!c.waiting && open !== c.agent.id && "font-normal")}
                    meta={c.match ? <span className="text-foreground">{c.match.body}</span> : c.agent.program}
                    end={
                      <span className="flex shrink-0 flex-col items-end gap-0.5">
                        <span className="text-[11px] text-muted-foreground">{timeAgo(c.last.minutesAgo).replace(" ago", "")}</span>
                        <CountBadge n={c.waiting} label="new" />
                      </span>
                    } />
                </NavItem>
              ))}
            </div>
          </ScrollArea>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-6">
            {agent ? (
              <AgentsDialog initialId={agent.id}>
                <Button variant="ghost" className="-mx-2 h-auto min-w-0 px-2 py-1">
                  <AgentRow agent={agent} size="sm" nameClass="text-base font-semibold" end={<span className="text-sm text-muted-foreground">{agent.program}</span>} />
                </Button>
              </AgentsDialog>
            ) : channel ? (
              <span className="flex min-w-0 items-center gap-2 text-base font-semibold">
                <RadioIcon className="size-4 text-muted-foreground" /><span className="truncate">{channel}</span>
                <span className="text-sm font-normal text-muted-foreground">Outside channel</span>
              </span>
            ) : (
              <>
                <RoomDialog>
                  <Button variant="ghost" className="-mx-2 min-w-0 px-2 text-base font-semibold">
                    <HashIcon className="text-muted-foreground" /><span className="truncate">{info.name}</span>
                  </Button>
                </RoomDialog>
                <div className="ml-auto">{mentions.length > 0 && <MentionStepper items={mentions} onGo={l => goTo("room", l.id)} />}</div>
                <AgentsDialog>
                  <Button variant="outline" className="h-auto py-1 pr-2.5 pl-1" aria-label="Agents in this room">
                    <span className="flex -space-x-1.5">{agents.slice(0, 4).map(a => <AgentAvatar key={a.id} agent={a} size="sm" className="ring-2 ring-background" />)}</span>
                    {agents.length}
                  </Button>
                </AgentsDialog>
              </>
            )}
          </header>
          {info.ended && <p className="shrink-0 border-b bg-muted px-6 py-2 text-sm text-muted-foreground">This room has ended. Nobody can post here any more.</p>}
          {info.removed && !info.ended && <p className="shrink-0 border-b bg-muted px-6 py-2 text-sm text-muted-foreground">The host removed this agent from the room. It can't post here any more.</p>}
          <div className="relative min-h-0 flex-1">
            <ScrollArea className="h-full bg-chat">
              <div className="px-8 pt-5 pb-16">
                <div ref={start} className="h-px" />
                <Thread agentId={agent?.id} channel={channel} />
                <div ref={end} className="h-px" />
              </div>
            </ScrollArea>
            <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2">
              {!atTop && <JumpButton to={start} block="start"><ArrowUpIcon />Top</JumpButton>}
              {!atLatest && <JumpButton to={end} block="end"><ArrowDownIcon />Latest</JumpButton>}
            </div>
          </div>
        </main>
      </div>
    </NavContext.Provider>
  )
}
