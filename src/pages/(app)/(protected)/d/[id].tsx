/**
 * One decision: rank options, watch the instant-runoff play out live, and
 * (for the creator) close voting and publish the decision record.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth, useQuery, useUserLookup } from 'deepspace'
import { ArrowDown, ArrowLeft, ArrowUp, Check, Copy, Plus, X } from 'lucide-react'
import { Badge, Button, Textarea, useToast } from '@/components/ui'
import { callAction } from '@/lib/actions'
import { fromJsonColumn, parseOptions, type DecisionOption, type Round } from '@/lib/irv'

interface Decision {
  title: string
  description?: string
  optionsJson: unknown
  resultsVisibility?: string
  status: 'open' | 'closed'
  ballotCount?: number
  roundsJson?: unknown
  winnersJson?: unknown
  tie?: boolean
  recordText?: string
}
interface Ballot {
  decisionId: string
  ranking: unknown
  comment?: string
}

/** json columns come back already parsed; tolerate a raw string too. */
function safeJson<T>(value: unknown, fallback: T): T {
  const parsed = fromJsonColumn(value)
  return parsed === undefined || parsed === null || parsed === '' ? fallback : (parsed as T)
}

export default function DecisionPage() {
  const { id = '' } = useParams()
  const { userId } = useAuth()
  const { records, status } = useQuery<Decision>('decisions')
  const { getName } = useUserLookup()
  const decision = records.find((r) => r.recordId === id)

  if (status === 'loading' && !decision) return <p className="p-8 text-sm text-muted-foreground">Loading…</p>
  if (!decision) {
    return (
      <div className="mx-auto max-w-xl p-8 text-center">
        <p className="mb-4">That decision doesn't exist.</p>
        <Link to="/home" className="text-sm underline">
          Back to decisions
        </Link>
      </div>
    )
  }

  const d = decision.data
  const options = parseOptions(d.optionsJson)
  const closed = d.status === 'closed'
  const isOwner = decision.createdBy === userId
  const rounds = safeJson<Round[]>(d.roundsJson, [])
  const winners = safeJson<string[]>(d.winnersJson, [])
  const resultsHidden = d.resultsVisibility === 'after-close' && !closed

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link to="/home" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All decisions
      </Link>

      <header className="mb-6">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{d.title}</h1>
          <Badge variant={closed ? 'secondary' : 'default'}>{closed ? 'Decided' : 'Open'}</Badge>
        </div>
        {d.description && <p className="mt-2 text-sm text-muted-foreground">{d.description}</p>}
        <p className="mt-2 text-xs text-muted-foreground">
          by {getName(decision.createdBy) ?? 'a teammate'} · {d.ballotCount ?? 0} voted
          <CopyLink />
        </p>
      </header>

      {closed && (
        <ResultBanner options={options} winners={winners} tie={!!d.tie} record={d.recordText} />
      )}

      {!closed && <BallotForm decisionId={id} options={options} />}

      <section className="mt-10">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {closed ? 'How it played out' : 'Live count'}
        </h2>
        {resultsHidden ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            The creator hid results until voting closes. {d.ballotCount ?? 0} ballot(s) so far.
          </p>
        ) : rounds.length === 0 ? (
          <p className="text-sm text-muted-foreground">No ballots yet — be the first.</p>
        ) : (
          <Rounds rounds={rounds} options={options} />
        )}
      </section>

      {isOwner && !closed && <CloseControl decisionId={id} ballots={d.ballotCount ?? 0} />}
    </div>
  )
}

function CopyLink() {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="ml-3 inline-flex items-center gap-1 underline-offset-2 hover:underline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(window.location.href)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          /* clipboard blocked: the URL bar still works */
        }
      }}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />} {copied ? 'Copied' : 'Copy link'}
    </button>
  )
}

function BallotForm({ decisionId, options }: { decisionId: string; options: DecisionOption[] }) {
  const { records } = useQuery<Ballot>('ballots', { where: { decisionId } })
  const mine = records[0]
  const savedRanking = useMemo(() => safeJson<string[]>(mine?.data.ranking, []), [mine?.data.ranking])
  const [ranking, setRanking] = useState<string[]>([])
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const { success, error } = useToast()

  // Prefill from the voter's existing ballot once, so a re-vote starts where they left off.
  useEffect(() => {
    if (!hydrated && mine) {
      setRanking(savedRanking.filter((id) => options.some((o) => o.id === id)))
      setComment(mine.data.comment ?? '')
      setHydrated(true)
    }
  }, [mine, savedRanking, options, hydrated])

  const label = (id: string) => options.find((o) => o.id === id)?.label ?? id
  const unranked = options.filter((o) => !ranking.includes(o.id))
  const move = (i: number, dir: -1 | 1) =>
    setRanking((r) => {
      const j = i + dir
      if (j < 0 || j >= r.length) return r
      const next = [...r]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  const unchanged = !!mine && JSON.stringify(ranking) === JSON.stringify(savedRanking) && comment === (mine.data.comment ?? '')

  const submit = async () => {
    setBusy(true)
    try {
      await callAction('cast-vote', { decisionId, ranking, comment })
      success(mine ? 'Vote updated' : 'Vote cast')
    } catch (e) {
      error('Could not save your vote', e instanceof Error ? e.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {mine ? 'Your ballot (you can change it until voting closes)' : 'Rank your choices, best first'}
      </h2>

      <ol className="mb-3 space-y-2" data-testid="ranked-list">
        {ranking.map((id, i) => (
          <li key={id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <span className="w-5 text-sm tabular-nums text-muted-foreground">{i + 1}</span>
            <span className="flex-1 truncate">{label(id)}</span>
            <Button size="sm" variant="ghost" aria-label={`Move ${label(id)} up`} disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp />
            </Button>
            <Button size="sm" variant="ghost" aria-label={`Move ${label(id)} down`} disabled={i === ranking.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown />
            </Button>
            <Button size="sm" variant="ghost" aria-label={`Unrank ${label(id)}`} onClick={() => setRanking((r) => r.filter((x) => x !== id))}>
              <X />
            </Button>
          </li>
        ))}
        {ranking.length === 0 && <li className="text-sm text-muted-foreground">Nothing ranked yet. Add options below.</li>}
      </ol>

      {unranked.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2" data-testid="unranked-list">
          {unranked.map((o) => (
            <Button key={o.id} size="sm" variant="outline" onClick={() => setRanking((r) => [...r, o.id])}>
              <Plus /> {o.label}
            </Button>
          ))}
        </div>
      )}
      <p className="mb-4 text-xs text-muted-foreground">
        Unranked options get no vote from you. If your top choices are knocked out, your ballot simply stops counting.
      </p>

      <Textarea
        placeholder="Anything the group should know? (optional, anonymous)"
        value={comment}
        maxLength={500}
        onChange={(e) => setComment(e.target.value)}
        className="mb-3"
      />
      <Button onClick={submit} disabled={busy || ranking.length === 0 || unchanged} data-testid="submit-vote">
        {mine ? 'Update vote' : 'Cast vote'}
      </Button>
    </section>
  )
}

function Rounds({ rounds, options }: { rounds: Round[]; options: DecisionOption[] }) {
  const label = (id: string) => options.find((o) => o.id === id)?.label ?? id
  return (
    <div className="space-y-5">
      {rounds.map((r, i) => {
        const entries = Object.entries(r.counts).sort((a, b) => b[1] - a[1])
        return (
          <div key={i}>
            <p className="mb-1.5 text-xs text-muted-foreground">
              Round {i + 1} · {r.active} counting{r.exhausted ? ` · ${r.exhausted} no longer count` : ''}
            </p>
            <ul className="space-y-1">
              {entries.map(([id, n]) => (
                <li key={id} className="flex items-center gap-2 text-sm">
                  <span className={`w-32 truncate ${r.eliminated === id ? 'text-muted-foreground line-through' : ''}`}>
                    {label(id)}
                  </span>
                  <div className="h-2 flex-1 rounded bg-muted">
                    <div
                      className={`h-2 rounded ${r.eliminated === id ? 'bg-destructive/60' : 'bg-primary'}`}
                      style={{ width: `${r.active ? (n / r.active) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="w-6 text-right tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
            {r.eliminated && (
              <p className="mt-1 text-xs text-muted-foreground">{label(r.eliminated)} is out; its votes move to next choices.</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ResultBanner({
  options,
  winners,
  tie,
  record,
}: {
  options: DecisionOption[]
  winners: string[]
  tie: boolean
  record?: string
}) {
  const names = winners.map((w) => options.find((o) => o.id === w)?.label ?? w)
  return (
    <div className="mb-8 rounded-lg border border-border bg-card p-5" data-testid="result-banner">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">{tie ? 'Tie' : 'Decision'}</p>
      <p className="mt-1 text-xl font-semibold">{names.length ? names.join(' & ') : 'No votes were cast'}</p>
      {record && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{record}</p>}
    </div>
  )
}

function CloseControl({ decisionId, ballots }: { decisionId: string; ballots: number }) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const { error } = useToast()
  return (
    <section className="mt-12 border-t border-border pt-6">
      <p className="mb-2 text-sm text-muted-foreground">
        Only you can close voting. This locks all ballots and writes the decision record.
      </p>
      {armed ? (
        <div className="flex gap-2">
          <Button
            variant="destructive"
            disabled={busy}
            data-testid="confirm-close"
            onClick={async () => {
              setBusy(true)
              try {
                await callAction('close-decision', { decisionId })
              } catch (e) {
                error('Could not close', e instanceof Error ? e.message : undefined)
                setBusy(false)
                setArmed(false)
              }
            }}
          >
            {busy ? 'Closing…' : `Close with ${ballots} ballot(s)`}
          </Button>
          <Button variant="ghost" onClick={() => setArmed(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="outline" onClick={() => setArmed(true)} data-testid="close-voting">
          Close voting
        </Button>
      )}
    </section>
  )
}
