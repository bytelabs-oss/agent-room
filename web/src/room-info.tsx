import { useState, type ReactElement } from "react"
import { PencilIcon, PlusIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import { timeAgo } from "@/types"
import { Confirm, Details, NameField, NumberedList, PaneBody, PaneFooter, PaneHeader, Section } from "@/parts"
import { useRoom } from "@/room"

function RoomView({ onEdit }: { onEdit: () => void }) {
  const { info, byId, room, amHost, endRoom, removeSkill } = useRoom()
  const canManage = amHost && !info.ended
  return (
    <>
      <PaneHeader title={info.name} />
      <PaneBody>
        <Details rows={[
          ["Started", info.startedAt],
          ["Host", byId[info.hostId].name],
          ["Last activity", room.length ? timeAgo(room.at(-1)!.minutesAgo) : "None yet"],
          ["Messages", String(room.length)],
          ["Room ID", <span key="id" className="font-mono text-xs">{info.id}</span>],
        ]} />
        <NumberedList title="Goals" items={info.goals} />
        <NumberedList title="Rules for agents" items={info.rules} />
        {info.skills.length > 0 && (
          <Section title="Skills">
            <ul className="grid gap-3">
              {info.skills.map(s => (
                <li key={s.id} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm font-medium">{s.name}</p>
                    {s.description && <p className="text-sm text-muted-foreground">{s.description}</p>}
                    <p className="text-xs text-muted-foreground">Added by {byId[s.agentId]?.name ?? "an agent that left"}</p>
                  </div>
                  {canManage && (
                    <Confirm trigger={<Button size="icon-xs" variant="ghost" aria-label={`Take ${s.name} out of the room`}><XIcon /></Button>}
                      title={`Take ${s.name} out?`} description="Agents in the room can no longer open it. Copies they already took in stay until they leave the room."
                      confirm="Take it out" destructive onConfirm={() => { removeSkill(s.id); toast(`${s.name} taken out`) }} />
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </PaneBody>
      {canManage && (
        <>
          <footer className="flex shrink-0 items-center justify-between gap-2 border-t p-4">
            <Confirm trigger={<Button variant="destructive">End room</Button>} title="End this room?" destructive
              description="Every agent leaves and nobody can post here again. The messages stay readable."
              confirm="End room" onConfirm={() => { endRoom(); toast("Room ended") }} />
            <Button variant="outline" onClick={onEdit}><PencilIcon />Edit room</Button>
          </footer>
        </>
      )}
    </>
  )
}

function ListField({ label, add, items, onChange }: { label: string; add: string; items: string[]; onChange: (items: string[]) => void }) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      {items.map((x, i) => (
        <div key={i} className="flex gap-2">
          <Input value={x} aria-label={`${label} ${i + 1}`} onChange={e => onChange(items.map((y, j) => (j === i ? e.target.value : y)))} />
          <Button size="icon" variant="ghost" aria-label={`Remove ${label.toLowerCase()} ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <XIcon />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="justify-self-start" onClick={() => onChange([...items, ""])}>
        <PlusIcon />{add}
      </Button>
    </Field>
  )
}

function RoomEditor({ onDone }: { onDone: () => void }) {
  const { info, saveInfo } = useRoom()
  const [draft, setDraft] = useState(info)
  const [tried, setTried] = useState(false)
  const clean = (xs: string[]) => xs.map(x => x.trim()).filter(Boolean)
  const save = () => {
    setTried(true)
    if (!draft.name.trim()) return
    saveInfo({ name: draft.name.trim(), goals: clean(draft.goals), rules: clean(draft.rules) })
    toast.success("Room saved")
    onDone()
  }
  return (
    <>
      <PaneHeader title="Edit room" />
      <PaneBody>
        <NameField id="room-name" value={draft.name} onChange={name => setDraft(d => ({ ...d, name }))} maxLength={60} tried={tried} />
        <ListField label="Goals" add="Add goal" items={draft.goals} onChange={goals => setDraft(d => ({ ...d, goals }))} />
        <ListField label="Rules for agents" add="Add rule" items={draft.rules} onChange={rules => setDraft(d => ({ ...d, rules }))} />
      </PaneBody>
      <PaneFooter onCancel={onDone} onSave={save} />
    </>
  )
}

export function RoomDialog({ children }: { children: ReactElement }) {
  const [editing, setEditing] = useState(false)
  return (
    <Dialog onOpenChange={o => { if (o) setEditing(false) }}>
      <DialogTrigger render={children} />
      <DialogContent showCloseButton={false} className="flex max-h-[85dvh] flex-col gap-0 p-0 sm:max-w-lg">
        {editing ? <RoomEditor onDone={() => setEditing(false)} /> : <RoomView onEdit={() => setEditing(true)} />}
      </DialogContent>
    </Dialog>
  )
}
