import { useEffect, useState, type ComponentProps, type ReactElement, type ReactNode } from "react"
import { CheckIcon, CopyIcon, ListFilterIcon, MailIcon, RefreshCwIcon, ReplyIcon, SearchIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Avatar, AvatarBadge, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DialogClose, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import type { Agent, Status } from "@/types"
import { timeAgo } from "@/types"
import { hueStyle, statusText, useRoom } from "@/room"

type Size = "sm" | "default" | "lg"

export function AgentAvatar({ agent, size, className, presence }: { agent: Agent; size?: Size; className?: string; presence?: boolean }) {
  return (
    <Avatar size={size} className={cn("rounded-md after:rounded-md", className)}>
      {presence && <AvatarBadge className={cn("-right-0.5 -bottom-0.5", agent.online ? "bg-success" : "bg-muted-foreground/60")} aria-label={agent.online ? "Online" : "Offline"} />}
      <AvatarFallback className="agent-avatar rounded-md text-xs font-semibold" style={hueStyle(agent.hue)}>{agent.name[0].toUpperCase()}</AvatarFallback>
    </Avatar>
  )
}

/** Agent name that cuts off with "…", shows the full name on hover, and carries the Host label. */
export function AgentName({ agent, className }: { agent: Agent; className?: string }) {
  const host = useRoom().info.hostId === agent.id
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)} title={agent.name}>
      <span className="truncate">{agent.name}</span>
      {host && <Badge className="h-4 rounded bg-primary/10 px-1 text-[10px] font-semibold tracking-wide text-primary uppercase">Host</Badge>}
    </span>
  )
}

/** Avatar, name and one line under it. Used in lists, headers and cards. */
export function AgentRow({ agent, meta, size, nameClass, end }: { agent: Agent; meta?: ReactNode; size?: Size; nameClass?: string; end?: ReactNode }) {
  return (
    <span className="flex w-full min-w-0 items-center gap-2.5">
      <AgentAvatar agent={agent} size={size} presence />
      <span className="min-w-0 flex-1">
        <AgentName agent={agent} className={cn("text-sm font-medium", nameClass)} />
        {meta !== undefined && <span className="block truncate text-xs text-muted-foreground">{meta}</span>}
      </span>
      {end}
    </span>
  )
}

/** Orange count of things waiting on this agent. Hidden at zero. */
export function CountBadge({ n, label }: { n: number; label: string }) {
  return n > 0 && <Badge className="h-4.5 min-w-4.5 bg-attention px-1.5 text-[11px] text-attention-foreground" aria-label={`${n} ${label}`}>{n}</Badge>
}

export function StatusMark({ status }: { status: Status }) {
  const tone = { open: "font-medium text-attention", acked: "text-muted-foreground", replied: "text-success" }[status]
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs whitespace-nowrap", tone)}>
      {status === "open" ? <span className="mx-0.5 size-1.5 rounded-full bg-attention" /> : status === "acked" ? <CheckIcon className="size-3.5" /> : <ReplyIcon className="size-3.5" />}
      {statusText[status]}
    </span>
  )
}

/** Unstyled button for things that sit inside text: tags, names, avatars, quotes. Keeps the keyboard focus ring. */
export function InlineButton({ className, ...props }: ComponentProps<"button">) {
  return <button type="button" className={cn("rounded outline-none focus-visible:ring-2 focus-visible:ring-ring", className)} {...props} />
}

export function CopyButton({ value, label, iconOnly }: { value: string; label: string; iconOnly?: boolean }) {
  const [copied, setCopied] = useState(false)
  const copy = () => navigator.clipboard.writeText(value).then(
    () => { setCopied(true); setTimeout(() => setCopied(false), 1500) },
    () => toast.error(`Couldn't copy the ${label.toLowerCase()}`))
  const icon = copied ? <CheckIcon /> : <CopyIcon />
  return iconOnly
    ? <Button size="icon-xs" variant="ghost" aria-label={`Copy ${label.toLowerCase()}`} onClick={copy}>{icon}</Button>
    : <Button onClick={copy} className="w-22">{icon}{copied ? "Copied" : "Copy"}</Button>
}

/** Asks before an action that can't be taken back. Opens from `trigger`, or from `open` when controlled. */
export function Confirm({ trigger, open, onCancel, title, description, cancel = "Cancel", confirm, onConfirm, destructive }: {
  trigger?: ReactElement; open?: boolean; onCancel?: () => void; title: string; description: string
  cancel?: string; confirm: string; onConfirm: () => void; destructive?: boolean
}) {
  return (
    <AlertDialog open={open} onOpenChange={o => { if (!o) onCancel?.() }}>
      {trigger && <AlertDialogTrigger render={trigger} />}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancel}</AlertDialogCancel>
          <AlertDialogAction variant={destructive ? "destructive" : "default"} onClick={onConfirm}>{confirm}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Emails people an invite to the host's Tailscale network, which a machine has to be on to join a shared room. */
export function EmailInvite() {
  const { emailInvites, emailInvite, sentInvites } = useRoom()
  const [value, setValue] = useState("")
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<{ email: string; sentAt: string | null }[]>([])
  // Tailscale keeps the invites that are still open. It is asked once when this opens and once after each send,
  // and not again in between.
  const load = () => { sentInvites().then(setSent, () => {}) }
  useEffect(() => { if (emailInvites) load() }, [emailInvites])
  if (emailInvites === null) return null
  if (!emailInvites) return <p className="mt-4 text-sm text-muted-foreground">To email people an invite to your Tailscale network from here, save a Tailscale API token: <span className="font-mono">npx github:bytelabs-oss/agent-room tailscale-key</span></p>
  const emails = value.split(/[\s,]+/).filter(Boolean)
  const send = () => {
    setSending(true)
    emailInvite(emails).then(
      () => { toast.success(`Tailscale emailed ${emails.join(", ")}`); setValue(""); load() },
      (error: Error) => toast.error(error.message),
    ).finally(() => setSending(false))
  }
  return (
    <>
      <form className="mt-4 grid gap-2" onSubmit={e => { e.preventDefault(); send() }}>
        <p className="text-sm text-muted-foreground">Someone on another machine has to be on your Tailscale network first. Email them an invite to it.</p>
        <div className="flex gap-1.5">
          <Input type="text" value={value} onChange={e => setValue(e.target.value)} placeholder="name@example.com" className="h-8" aria-label="Emails to invite to your Tailscale network" />
          <Button type="submit" variant="outline" disabled={!emails.length || sending}><MailIcon />Send</Button>
        </div>
      </form>
      {sent.length > 0 && (
        <div className="mt-5"><Section title="Invited">
          <ul className="divide-y rounded-lg border">
            {sent.map((one, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 truncate" title={one.email}>{one.email}</span>
                {one.sentAt && <span className="shrink-0 text-xs text-muted-foreground">Sent {timeAgo(Math.max(0, Math.floor((Date.now() - Date.parse(one.sentAt)) / 60_000)))}</span>}
              </li>
            ))}
          </ul>
        </Section></div>
      )}
    </>
  )
}

export function JoinLink() {
  const { joinUrl, newJoinUrl } = useRoom()
  return (
    <div className="flex gap-1.5">
      <Input readOnly tabIndex={-1} value={joinUrl} className="h-8 font-mono text-xs md:text-xs" aria-label="Join link" />
      <Confirm trigger={<Button variant="ghost"><RefreshCwIcon />New link</Button>} title="Make a new link?"
        description="The current link stops working. Agents already in the room stay." confirm="Make new link" onConfirm={newJoinUrl} />
      <CopyButton value={joinUrl} label="Link" />
    </div>
  )
}

/** Dialog pane header: title (or any lead), action buttons, then a close button in line with them. */
export function PaneHeader({ title, lead, actions }: { title?: ReactNode; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex shrink-0 items-center gap-3 border-b p-4">
      {lead ?? <DialogTitle className="min-w-0 flex-1 truncate">{title}</DialogTitle>}
      {actions}
      <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label="Close" className="shrink-0" />}><XIcon /></DialogClose>
    </header>
  )
}

export function PaneBody({ children }: { children: ReactNode }) {
  return <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-6 overflow-y-auto p-4">{children}</div>
}

export function PaneFooter({ onCancel, onSave }: { onCancel: () => void; onSave: () => void }) {
  return (
    <footer className="flex shrink-0 justify-end gap-2 border-t p-4">
      <Button variant="outline" onClick={onCancel}>Cancel</Button>
      <Button onClick={onSave}>Save</Button>
    </footer>
  )
}

export function Details({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-6 gap-y-2 text-sm">
      {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="flex min-w-0">{v}</dd></div>)}
    </dl>
  )
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cn("text-xs font-medium text-muted-foreground", className)}>{children}</h3>
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section><SectionLabel className="mb-2">{title}</SectionLabel>{children}</section>
}

export function NumberedList({ title, items }: { title: string; items: string[] }) {
  return items.length > 0 && (
    <Section title={title}>
      <ol className="grid list-decimal gap-1 pl-5 text-sm marker:text-muted-foreground">{items.map((x, i) => <li key={i}>{x}</li>)}</ol>
    </Section>
  )
}

/** Required name input. Shows "Add a name." once the person has tried to save it empty. */
export function NameField({ id, value, onChange, maxLength, tried }: { id: string; value: string; onChange: (v: string) => void; maxLength: number; tried: boolean }) {
  const missing = tried && !value.trim()
  return (
    <Field data-invalid={missing || undefined}>
      <FieldLabel htmlFor={id}>Name</FieldLabel>
      <Input id={id} value={value} maxLength={maxLength} aria-invalid={missing} onChange={e => onChange(e.target.value)} />
      {missing && <FieldError>Add a name.</FieldError>}
    </Field>
  )
}

/**
 * Search box with a filter menu beside it, and a removable chip for the active filter.
 * The first filter option means "show everything".
 */
export function SearchAndFilter<K extends string>({ label, query, onQuery, options, filter, onFilter }: {
  label: string; query: string; onQuery: (v: string) => void; options: Record<K, string>; filter: K; onFilter: (v: K) => void
}) {
  const keys = Object.keys(options) as K[]
  return (
    <div className="grid gap-1.5">
      <div className="flex gap-1.5">
        <InputGroup className="h-8 bg-background">
          <InputGroupAddon><SearchIcon /></InputGroupAddon>
          <InputGroupInput value={query} onChange={e => onQuery(e.target.value)} placeholder="Search" aria-label={`Search ${label}`} />
          {query && <InputGroupAddon align="inline-end"><InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => onQuery("")}><XIcon /></InputGroupButton></InputGroupAddon>}
        </InputGroup>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label={`Filter ${label}`} className={cn("shrink-0 bg-background", filter !== keys[0] && "border-primary text-primary")} />}>
            <ListFilterIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuRadioGroup value={filter} onValueChange={v => onFilter(v as K)}>
              {keys.map(k => <DropdownMenuRadioItem key={k} closeOnClick value={k}>{options[k]}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {filter !== keys[0] && <Button variant="secondary" size="xs" className="justify-self-start rounded-full" onClick={() => onFilter(keys[0])}>{options[filter]}<XIcon /></Button>}
    </div>
  )
}

/** Shown when search or filter leaves nothing. */
export function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <p className="px-2 py-4 text-center text-sm text-muted-foreground">
      Nothing matches. <Button variant="link" size="xs" className="h-auto p-0" onClick={onClear}>Clear</Button>
    </p>
  )
}
