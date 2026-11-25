import { Fragment, type ReactElement, type ReactNode } from "react"
import { ReplyIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { timeAgo, type Agent } from "@/types"
import { AgentPeek } from "@/agents"
import { AgentAvatar, AgentName, InlineButton, StatusMark } from "@/parts"
import { hueStyle, useRoom, type Line, type Said } from "@/room"

/** Turns "@Name" for any agent in the room into a tag; tags of this agent stand out. */
function WithTags({ text }: { text: string }) {
  const { agents, me } = useRoom()
  const byTag = new Map(agents.map(a => ["@" + a.name, a]))
  // Longest names first, so "@Reviewer 12" wins over "@Reviewer".
  const names = [...byTag.keys()].sort((a, b) => b.length - a.length).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  return text.split(new RegExp(`(${names.join("|")})`)).map((part, i) => {
    const hit = byTag.get(part)
    if (!hit) return <Fragment key={i}>{part}</Fragment>
    return (
      <AgentPeek key={i} agent={hit}>
        <InlineButton className={cn("px-1 font-medium",
          hit.id === me.id ? "bg-attention-soft text-attention" : "bg-muted text-foreground hover:bg-muted/70")}>{part}</InlineButton>
      </AgentPeek>
    )
  })
}

/** A chat bubble. This agent's bubbles are filled with its colour; everyone else's are white. */
function Bubble({ who, mine, id, className, children }: { who: Agent; mine: boolean; id?: string; className?: string; children: ReactNode }) {
  return (
    <p id={id}
      className={cn("jump-ring relative max-w-prose rounded-[20px] px-3.5 py-2 text-[15px] leading-snug", mine ? "agent-bubble text-white" : "bg-background ring-1 ring-border", className)}
      style={mine ? hueStyle(who.hue) : undefined}>
      {children}
    </p>
  )
}


const quoteClass = "mx-3 mb-0.5 flex max-w-full min-w-0 items-center gap-1 text-xs text-muted-foreground"
const Quote = ({ text }: { text: string }) => <><ReplyIcon className="size-3 shrink-0" /><span className="truncate">{text}</span></>

/** A message and its reply, shown alone over the blurred chat, laid out like the chat itself. */
function ThreadDialog({ original, reply, trigger }: { original: Said; reply: Said; trigger: ReactElement }) {
  const { byId, me } = useRoom()
  return (
    <Dialog>
      <DialogTrigger render={trigger} />
      {/* Long messages scroll inside the dialog, which never grows past part of the window. */}
      <DialogContent showCloseButton={false} className="flex max-h-[min(560px,80dvh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogTitle className="sr-only">Reply</DialogTitle>
        <ol className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto bg-chat p-5">
          {[original, reply].map((m, i) => {
            const who = byId[m.from]
            const mine = who.id === me.id
            return (
              <li key={i} className={cn("flex items-start gap-2", mine ? "justify-end pl-10" : "pr-10")}>
                {!mine && <AgentAvatar agent={who} size="sm" className="mt-5" />}
                <div className={cn("flex min-w-0 flex-col", mine ? "items-end" : "items-start")}>
                  <p className="mx-3 mb-1 text-xs text-muted-foreground"><span className="font-medium text-foreground">{who.name}</span> · {timeAgo(m.minutesAgo)}</p>
                  {i === 1 && <p className={quoteClass}><Quote text={original.body} /></p>}
                  <Bubble who={who} mine={mine}>{m.body}</Bubble>
                </div>
              </li>
            )
          })}
        </ol>
      </DialogContent>
    </Dialog>
  )
}

/** The mark under a DM this agent received. "Replied" opens the message and its reply together. */
function Mark({ line, className }: { line: Line; className?: string }) {
  // The states describe this agent's inbox, so they only show on messages it received.
  if (!line.status || line.mine) return null
  const mark = <span className={className}><StatusMark status={line.status} /></span>
  if (line.status !== "replied" || !line.reply) return mark
  return (
    <ThreadDialog original={line} reply={line.reply}
      trigger={<InlineButton className="hover:underline">{mark}</InlineButton>} />
  )
}

/** Small quote above a reply showing what it answers. Opens the thread. */
function ReplyQuote({ line }: { line: Line }) {
  if (!line.replyTo) return null
  return (
    <ThreadDialog original={line.replyTo} reply={line}
      trigger={
        <InlineButton className={cn(quoteClass, "max-w-[60ch] hover:text-foreground")}>
          <Quote text={line.replyTo.body} />
        </InlineButton>
      } />
  )
}

/** Messages in a row from one agent, sharing one name and one time. */
function Group({ lines, author }: { lines: Line[]; author: Agent }) {
  const mine = lines[0].mine
  const last = lines[lines.length - 1]
  return (
    <li className={cn("flex items-start gap-2", mine ? "justify-end pl-16" : "pr-16")}>
      {!mine && (
        <AgentPeek agent={author}>
          <InlineButton className="mt-6 rounded-md" aria-label={`${author.name}'s card`}>
            <AgentAvatar agent={author} size="sm" />
          </InlineButton>
        </AgentPeek>
      )}
      <div className={cn("flex min-w-0 flex-col gap-1.5", mine ? "items-end" : "items-start")}>
        {!mine && (
          <AgentPeek agent={author}>
            <InlineButton className="mb-0.5 ml-3 max-w-full text-xs font-medium text-muted-foreground hover:text-foreground">
              <AgentName agent={author} />
            </InlineButton>
          </AgentPeek>
        )}
        {lines.map((l, i) => (
          <div key={l.id} className={cn("flex min-w-0 max-w-full flex-col", mine ? "items-end" : "items-start")}>
            <ReplyQuote line={l} />
            <Bubble id={`msg-${l.id}`} who={author} mine={mine}
              className={cn(
                mine ? i > 0 && "rounded-tr-md" : i > 0 && "rounded-tl-md",
                mine ? i < lines.length - 1 && "rounded-br-md" : i < lines.length - 1 && "rounded-bl-md",
                l.status === "open" && !mine && "bg-attention-soft ring-attention/40",
              )}>
              <WithTags text={l.body} />
            </Bubble>
            {i < lines.length - 1 && <Mark line={l} className="mx-3 mt-0.5 mb-1" />}
          </div>
        ))}
        <p className="mx-3 mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          {timeAgo(last.minutesAgo)}
          <Mark line={last} />
        </p>
      </div>
    </li>
  )
}

/** Lines grouped by author, starting a new group after a five-minute gap. */
function Transcript({ lines }: { lines: Line[] }) {
  const { byId } = useRoom()
  const groups: Line[][] = []
  for (const l of lines) {
    const g = groups.at(-1)
    // A note stands alone, and so does whatever follows it.
    if (g && !l.note && !g[0].note && g[0].from === l.from && g.at(-1)!.minutesAgo - l.minutesAgo <= 5) g.push(l)
    else groups.push([l])
  }
  return (
    <ol className="grid gap-7">
      <li className="text-center text-xs font-medium text-muted-foreground" aria-hidden>Today</li>
      {groups.map(g => g[0].note ? (
        // An agent came or went, or the host changed the room: one quiet line, as in a group chat.
        <li key={g[0].id} className="text-center text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{byId[g[0].from].name}</span> {g[0].body} · {timeAgo(g[0].minutesAgo)}
        </li>
      ) : <Group key={g[0].id} lines={g} author={byId[g[0].from]} />)}
    </ol>
  )
}

/** The room, or the DM with one agent when `agentId` is set. */
export function Thread({ agentId, channel }: { agentId?: string; channel?: string }) {
  const { room, dms, channels } = useRoom()
  return <Transcript lines={channel ? channels.find(c => c.name === channel)?.lines ?? [] : agentId ? dms[agentId] ?? [] : room} />
}

/** DMs this agent has, waiting ones first, then by latest activity. */
export function useConversations() {
  const { others, dms, newCount } = useRoom()
  return others
    .filter(a => dms[a.id]?.length)
    .map(a => ({ agent: a, last: dms[a.id].at(-1)!, waiting: newCount[a.id] ?? 0 }))
    .sort((x, y) => Number(y.waiting > 0) - Number(x.waiting > 0) || x.last.minutesAgo - y.last.minutesAgo)
}
