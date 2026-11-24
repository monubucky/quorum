/**
 * Server actions for Quorum. These run RBAC-off (see server/action-routes.ts),
 * so every check that matters — decision is open, caller owns it, ranking only
 * contains real options — is done explicitly here.
 */

import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { parseOptions, sanitizeRanking, tally, type DecisionOption, type Tally } from '../lib/irv'

type Row = Record<string, unknown>

const MAX_BALLOTS = 500

async function loadDecision(
  tools: Parameters<ActionHandler<Env>>[0]['tools'],
  decisionId: string,
) {
  const res = await tools.get<Row>('decisions', decisionId)
  if (!res.success) return null
  return res.data.record
}

async function loadRankings(
  tools: Parameters<ActionHandler<Env>>[0]['tools'],
  decisionId: string,
): Promise<{ rankings: string[][]; comments: string[] }> {
  const res = await tools.query<Row>('ballots', { where: { decisionId }, limit: MAX_BALLOTS })
  if (!res.success) return { rankings: [], comments: [] }
  const rankings: string[][] = []
  const comments: string[] = []
  for (const r of res.data.records) {
    try {
      const parsed: unknown = JSON.parse(String(r.data.ranking ?? '[]'))
      if (Array.isArray(parsed)) rankings.push(parsed.filter((x): x is string => typeof x === 'string'))
    } catch {
      /* skip a corrupt ballot rather than fail the whole tally */
    }
    const c = String(r.data.comment ?? '').trim()
    if (c) comments.push(c)
  }
  return { rankings, comments }
}

function tallyFields(t: Tally) {
  return {
    roundsJson: JSON.stringify(t.rounds),
    winnersJson: JSON.stringify(t.winners),
    tie: t.tie,
  }
}

export const castVote: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const decisionId = typeof params.decisionId === 'string' ? params.decisionId : ''
  if (!decisionId) return { success: false, error: 'Missing decision.' }

  const decision = await loadDecision(tools, decisionId)
  if (!decision) return { success: false, error: 'Decision not found.' }
  if (decision.data.status !== 'open') return { success: false, error: 'Voting is closed.' }

  const options = parseOptions(decision.data.optionsJson)
  const ranking = sanitizeRanking(params.ranking, new Set(options.map((o) => o.id)))
  if (ranking.length === 0) return { success: false, error: 'Rank at least one option.' }

  const comment = typeof params.comment === 'string' ? params.comment.trim().slice(0, 500) : ''

  // One ballot per voter per decision: a deterministic id makes a re-vote an
  // upsert instead of a second ballot.
  const ballotId = `ballot_${decisionId}_${userId}`
  const saved = await tools.create(
    'ballots',
    { decisionId, ranking: JSON.stringify(ranking), comment },
    ballotId,
  )
  if (!saved.success) return saved

  const { rankings } = await loadRankings(tools, decisionId)
  const t = tally(
    options.map((o) => o.id),
    rankings,
  )
  const live = decision.data.resultsVisibility !== 'after-close'
  const update = await tools.update('decisions', decisionId, {
    ballotCount: t.ballots,
    // For after-close decisions only the participation count is public.
    ...(live ? tallyFields(t) : {}),
  })
  if (!update.success) return update

  return { success: true, data: { ballots: t.ballots } }
}

export const closeDecision: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const decisionId = typeof params.decisionId === 'string' ? params.decisionId : ''
  const decision = decisionId ? await loadDecision(tools, decisionId) : null
  if (!decision) return { success: false, error: 'Decision not found.' }
  // The ownership check the action layer does NOT do for us.
  if (decision.createdBy !== userId) {
    return { success: false, error: 'Only the person who created this decision can close it.' }
  }
  if (decision.data.status === 'closed') return { success: true, data: { alreadyClosed: true } }

  const options = parseOptions(decision.data.optionsJson)
  const { rankings, comments } = await loadRankings(tools, decisionId)
  const t = tally(
    options.map((o) => o.id),
    rankings,
  )

  const recordText = await writeRecord(
    tools,
    String(decision.data.title ?? ''),
    String(decision.data.description ?? ''),
    options,
    t,
    comments,
  )

  const res = await tools.update('decisions', decisionId, {
    status: 'closed',
    ballotCount: t.ballots,
    ...tallyFields(t),
    recordText,
    closedAt: new Date().toISOString(),
  })
  if (!res.success) return res
  return { success: true, data: { winners: t.winners } }
}

// ---------------------------------------------------------------------------
// Decision record: AI-written when the integration is available, otherwise a
// deterministic summary. Closing must never fail just because the AI call did.
// ---------------------------------------------------------------------------

function labelOf(options: DecisionOption[], id: string): string {
  return options.find((o) => o.id === id)?.label ?? id
}

export function plainRecord(options: DecisionOption[], t: Tally): string {
  if (t.winners.length === 0) return 'No ballots were cast, so no option was chosen.'
  const names = t.winners.map((w) => labelOf(options, w))
  if (t.tie) {
    return `The vote ended in a tie between ${names.join(' and ')} after ${t.rounds.length} round(s) with ${t.ballots} ballot(s).`
  }
  return `${names[0]} won after ${t.rounds.length} round(s) with ${t.ballots} ballot(s).`
}

async function writeRecord(
  tools: Parameters<ActionHandler<Env>>[0]['tools'],
  title: string,
  description: string,
  options: DecisionOption[],
  t: Tally,
  comments: string[],
): Promise<string> {
  const fallback = plainRecord(options, t)
  if (t.winners.length === 0) return fallback

  const rounds = t.rounds
    .map((r, i) => {
      const line = Object.entries(r.counts)
        .map(([id, n]) => `${labelOf(options, id)}: ${n}`)
        .join(', ')
      const out = r.eliminated ? ` -> eliminated ${labelOf(options, r.eliminated)}` : ''
      return `Round ${i + 1}: ${line}${r.exhausted ? ` (exhausted: ${r.exhausted})` : ''}${out}`
    })
    .join('\n')

  const prompt = [
    'Write a short decision record (3-5 sentences, plain prose, no headings) for a group that used ranked-choice voting.',
    'State what was decided, how decisive it was, and any notable dissent from the voter comments.',
    'Use only the facts below. Do not invent reasons.',
    '',
    `Decision: ${title}`,
    description ? `Context: ${description}` : '',
    `Result: ${t.tie ? 'TIE between ' : 'Winner: '}${t.winners.map((w) => labelOf(options, w)).join(', ')}`,
    `Ballots: ${t.ballots}`,
    rounds,
    comments.length ? `Voter comments (anonymous):\n- ${comments.slice(0, 20).join('\n- ')}` : 'No voter comments.',
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const res = await tools.integration<{ choices?: Array<{ message?: { content?: string } }> }>(
      'openai/chat-completion',
      { messages: [{ role: 'user', content: prompt }] },
    )
    const text = res.success ? res.data?.choices?.[0]?.message?.content?.trim() : ''
    return text ? text.slice(0, 2900) : fallback
  } catch {
    return fallback
  }
}
