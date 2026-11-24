/**
 * Instant-runoff (ranked-choice) tally.
 *
 * Pure and dependency-free so the exact same code runs in the worker (the
 * authoritative tally written by server actions) and in the browser (rendering
 * the rounds), and so it can be unit-tested without any DeepSpace runtime.
 *
 * Rules, stated once so the UI and README can quote them:
 *  1. Every ballot counts for its highest-ranked option still in the race.
 *  2. If an option holds more than half of the *active* ballots, it wins.
 *  3. Otherwise the option with the fewest votes is eliminated and its ballots
 *     move to their next choice. A ballot with no remaining choices is
 *     "exhausted" and drops out of the denominator.
 *  4. Elimination ties are broken by first-round votes (fewest goes), then by
 *     the option's position in the list (later goes). Deterministic, so every
 *     client and the server always agree.
 *  5. If every remaining option is tied, the result is a declared tie and all
 *     of them are returned as winners — we never pick one at random.
 */

export interface Round {
  /** Votes per option still in the race this round. */
  counts: Record<string, number>
  /** Ballots with no remaining choice this round. */
  exhausted: number
  /** Ballots still counting this round (ballots minus exhausted). */
  active: number
  /** Option eliminated at the end of this round, if any. */
  eliminated: string | null
}

export interface Tally {
  rounds: Round[]
  /** One id for a clear winner, several for a tie, none when there are no usable ballots. */
  winners: string[]
  tie: boolean
  /** Ballots supplied (after dropping ones with no valid choice at all). */
  ballots: number
}

export interface DecisionOption {
  id: string
  label: string
}

/** Drops unknown ids and duplicates, preserving order. */
export function sanitizeRanking(ranking: unknown, validIds: ReadonlySet<string>): string[] {
  if (!Array.isArray(ranking)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ranking) {
    if (typeof id === 'string' && validIds.has(id) && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

export function tally(optionIds: readonly string[], rawBallots: readonly string[][]): Tally {
  const valid = new Set(optionIds)
  const ballots = rawBallots
    .map((b) => sanitizeRanking(b, valid))
    .filter((b) => b.length > 0)

  if (ballots.length === 0 || optionIds.length === 0) {
    return { rounds: [], winners: [], tie: false, ballots: 0 }
  }

  const position = new Map(optionIds.map((id, i) => [id, i] as const))
  let remaining = [...optionIds]
  const rounds: Round[] = []
  let firstRound: Record<string, number> | null = null

  // Each pass either ends the count or removes one option, so this terminates.
  for (;;) {
    const inRace = new Set(remaining)
    const counts: Record<string, number> = Object.fromEntries(remaining.map((id) => [id, 0]))
    let exhausted = 0
    for (const ballot of ballots) {
      const top = ballot.find((id) => inRace.has(id))
      if (top === undefined) exhausted++
      else counts[top]++
    }
    const active = ballots.length - exhausted
    firstRound ??= { ...counts }

    const round: Round = { counts, exhausted, active, eliminated: null }
    rounds.push(round)

    // All ballots exhausted can only happen after eliminations; whoever is
    // left is tied at zero.
    const leader = remaining.reduce((a, b) => (counts[b] > counts[a] ? b : a), remaining[0])
    if (active > 0 && counts[leader] * 2 > active) {
      return { rounds, winners: [leader], tie: false, ballots: ballots.length }
    }
    if (remaining.length === 1) {
      return { rounds, winners: [remaining[0]], tie: false, ballots: ballots.length }
    }

    const min = Math.min(...remaining.map((id) => counts[id]))
    const max = Math.max(...remaining.map((id) => counts[id]))
    if (min === max) {
      return { rounds, winners: [...remaining], tie: true, ballots: ballots.length }
    }

    const lowest = remaining.filter((id) => counts[id] === min)
    lowest.sort((a, b) => {
      const byFirst = firstRound![a] - firstRound![b]
      if (byFirst !== 0) return byFirst
      return (position.get(b) ?? 0) - (position.get(a) ?? 0)
    })
    const out = lowest[0]
    round.eliminated = out
    remaining = remaining.filter((id) => id !== out)
  }
}

/** Safe JSON parse for the options column; returns [] on anything malformed. */
export function parseOptions(json: unknown): DecisionOption[] {
  if (typeof json !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((o) =>
      o && typeof o === 'object' && typeof (o as DecisionOption).id === 'string' &&
      typeof (o as DecisionOption).label === 'string'
        ? [{ id: (o as DecisionOption).id, label: (o as DecisionOption).label }]
        : [],
    )
  } catch {
    return []
  }
}
