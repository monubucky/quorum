/**
 * Decisions list + create form. Live: new decisions and vote counts from
 * teammates appear without a refresh because everything here is a useQuery.
 */

import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutations, useQuery, useUserLookup } from 'deepspace'
import { Plus } from 'lucide-react'
import { Badge, Button, EmptyState, Input, Label, Modal, Textarea, useToast } from '@/components/ui'
import { parseOptions } from '@/lib/irv'

interface Decision {
  title: string
  description?: string
  optionsJson: unknown
  resultsVisibility?: string
  status: 'open' | 'closed'
  ballotCount?: number
}

const MIN_OPTIONS = 2
const MAX_OPTIONS = 12

export default function HomePage() {
  const { records, status } = useQuery<Decision>('decisions', { orderBy: 'createdAt', orderDir: 'desc' })
  const { getName } = useUserLookup()
  const [open, setOpen] = useState(false)

  const [openOnes, closedOnes] = useMemo(
    () => [records.filter((r) => r.data.status !== 'closed'), records.filter((r) => r.data.status === 'closed')],
    [records],
  )

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Decisions</h1>
          <p className="text-sm text-muted-foreground">
            Rank your choices. The group's pick is the one most people can live with.
          </p>
        </div>
        <Button onClick={() => setOpen(true)} data-testid="new-decision">
          <Plus /> New decision
        </Button>
      </div>

      {status === 'loading' ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : records.length === 0 ? (
        <EmptyState
          title="Nothing to decide yet"
          description="Start one — a venue, a name, a roadmap call — and share the link."
        />
      ) : (
        <div className="space-y-8">
          <Section title="Open" items={openOnes} getName={getName} />
          {closedOnes.length > 0 && <Section title="Decided" items={closedOnes} getName={getName} />}
        </div>
      )}

      <CreateModal isOpen={open} onClose={() => setOpen(false)} />
    </div>
  )
}

function Section({
  title,
  items,
  getName,
}: {
  title: string
  items: { recordId: string; createdBy: string; data: Decision }[]
  getName: (id: string) => string | null
}) {
  if (items.length === 0) return null
  return (
    <section>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">{title}</h2>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {items.map((d) => (
          <li key={d.recordId}>
            <Link
              to={`/d/${d.recordId}`}
              className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-accent/50"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{d.data.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {parseOptions(d.data.optionsJson).length} options · by {getName(d.createdBy) ?? 'a teammate'}
                </p>
              </div>
              <Badge variant={d.data.status === 'closed' ? 'secondary' : 'default'}>
                {d.data.ballotCount ?? 0} voted
              </Badge>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function CreateModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const { create, ready } = useMutations<Record<string, unknown>>('decisions')
  const { error } = useToast()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [optionsText, setOptionsText] = useState('')
  const [afterClose, setAfterClose] = useState(false)
  const [busy, setBusy] = useState(false)

  const labels = useMemo(() => {
    const seen = new Set<string>()
    return optionsText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase()))
  }, [optionsText])

  const problem =
    !title.trim()
      ? 'Give it a title.'
      : labels.length < MIN_OPTIONS
        ? `Add at least ${MIN_OPTIONS} options, one per line.`
        : labels.length > MAX_OPTIONS
          ? `At most ${MAX_OPTIONS} options.`
          : null

  const submit = async () => {
    if (problem || busy) return
    setBusy(true)
    try {
      const options = labels.map((label, i) => ({ id: `o${i + 1}`, label: label.slice(0, 80) }))
      const id = await create({
        title: title.trim(),
        description: description.trim(),
        optionsJson: JSON.stringify(options),
        resultsVisibility: afterClose ? 'after-close' : 'live',
      })
      setTitle('')
      setDescription('')
      setOptionsText('')
      onClose()
      navigate(`/d/${id}`)
    } catch (e) {
      error('Could not create decision', e instanceof Error ? e.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={isOpen} onClose={onClose}>
      <Modal.Title>New decision</Modal.Title>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="d-title">What are you deciding?</Label>
          <Input id="d-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="d-desc">Context (optional)</Label>
          <Textarea id="d-desc" value={description} maxLength={600} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="d-opts">Options — one per line</Label>
          <Textarea
            id="d-opts"
            rows={5}
            value={optionsText}
            onChange={(e) => setOptionsText(e.target.value)}
            placeholder={'Lisbon\nMexico City\nTokyo'}
          />
          <p className="text-xs text-muted-foreground">Options are locked once created so ballots stay valid.</p>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={afterClose}
            onChange={(e) => setAfterClose(e.target.checked)}
          />
          <span>
            Hide results until I close voting
            <span className="block text-xs text-muted-foreground">
              Stops early results from nudging later voters. Vote count stays visible.
            </span>
          </span>
        </label>
        {problem && title.length + optionsText.length > 0 && (
          <p className="text-xs text-muted-foreground">{problem}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!!problem || busy || !ready} data-testid="create-decision">
            Create
          </Button>
        </div>
      </div>
    </Modal>
  )
}
