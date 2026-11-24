import { describe, expect, it } from 'vitest'
import type { ActionTools } from 'deepspace/worker'
import { castVote, closeDecision, plainRecord } from './decisions'
import { tally } from '../lib/irv'

type Row = { data: Record<string, unknown>; createdBy: string }

/** In-memory stand-in for the action tools: just enough of records.get/query/create/update. */
function fakeTools(creator: string) {
  const db: Record<string, Map<string, Row>> = { decisions: new Map(), ballots: new Map() }
  let asUser = creator
  const tools = {
    async get(c: string, id: string) {
      const r = db[c].get(id)
      return r ? { success: true, data: { record: { recordId: id, ...r } } } : { success: false, error: 'nf' }
    },
    async query(c: string, o?: { where?: Record<string, unknown> }) {
      const records = [...db[c]].filter(([, r]) =>
        Object.entries(o?.where ?? {}).every(([k, v]) => r.data[k] === v),
      ).map(([recordId, r]) => ({ recordId, ...r }))
      return { success: true, data: { records, count: records.length } }
    },
    async create(c: string, data: Record<string, unknown>, id?: string) {
      const rid = id ?? `r${db[c].size + 1}`
      db[c].set(rid, { data, createdBy: asUser })
      return { success: true, data: { recordId: rid } }
    },
    async update(c: string, id: string, data: Record<string, unknown>) {
      const r = db[c].get(id)
      if (!r) return { success: false, error: 'nf' }
      r.data = { ...r.data, ...data }
      return { success: true, data: { recordId: id } }
    },
    async integration() {
      return { success: false, error: 'AI unavailable in test' }
    },
  } as unknown as ActionTools
  db.decisions.set('d1', {
    createdBy: creator,
    data: {
      title: 'Where?',
      description: '',
      optionsJson: JSON.stringify([
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ]),
      resultsVisibility: 'live',
      status: 'open',
    },
  })
  return { tools, db, as: (u: string) => (asUser = u) }
}

const run = (h: typeof castVote, userId: string, params: Record<string, unknown>, tools: ActionTools) =>
  h({ userId, params, tools, env: {} as never, callerJwt: 'x' })

describe('cast-vote', () => {
  it('stores a ballot, recomputes the live tally, and upserts on re-vote', async () => {
    const { tools, db, as } = fakeTools('owner')
    as('u1')
    expect((await run(castVote, 'u1', { decisionId: 'd1', ranking: ['a', 'b'] }, tools)).success).toBe(true)
    as('u2')
    await run(castVote, 'u2', { decisionId: 'd1', ranking: ['b'] }, tools)
    as('u1')
    await run(castVote, 'u1', { decisionId: 'd1', ranking: ['b', 'a'] }, tools)

    expect(db.ballots.size).toBe(2) // u1's re-vote replaced, not duplicated
    const d = db.decisions.get('d1')!.data
    expect(d.ballotCount).toBe(2)
    expect(JSON.parse(String(d.winnersJson))).toEqual(['b'])
  })

  it('rejects empty/invalid rankings and unknown decisions', async () => {
    const { tools } = fakeTools('owner')
    expect((await run(castVote, 'u1', { decisionId: 'd1', ranking: ['zzz'] }, tools)).success).toBe(false)
    expect((await run(castVote, 'u1', { decisionId: 'nope', ranking: ['a'] }, tools)).success).toBe(false)
    expect((await run(castVote, 'u1', { ranking: ['a'] }, tools)).success).toBe(false)
  })

  it('refuses votes once the decision is closed', async () => {
    const { tools, db } = fakeTools('owner')
    db.decisions.get('d1')!.data.status = 'closed'
    const res = await run(castVote, 'u1', { decisionId: 'd1', ranking: ['a'] }, tools)
    expect(res.success).toBe(false)
    expect(db.ballots.size).toBe(0)
  })

  it('keeps results hidden in after-close mode but still counts ballots', async () => {
    const { tools, db } = fakeTools('owner')
    db.decisions.get('d1')!.data.resultsVisibility = 'after-close'
    await run(castVote, 'u1', { decisionId: 'd1', ranking: ['a'] }, tools)
    const d = db.decisions.get('d1')!.data
    expect(d.ballotCount).toBe(1)
    expect(d.roundsJson).toBeUndefined()
    expect(d.winnersJson).toBeUndefined()
  })
})

describe('close-decision', () => {
  it('only lets the creator close, and falls back to a plain record if AI fails', async () => {
    const { tools, db } = fakeTools('owner')
    await run(castVote, 'u1', { decisionId: 'd1', ranking: ['a'] }, tools)

    const denied = await run(closeDecision, 'intruder', { decisionId: 'd1' }, tools)
    expect(denied.success).toBe(false)
    expect(db.decisions.get('d1')!.data.status).toBe('open')

    const ok = await run(closeDecision, 'owner', { decisionId: 'd1' }, tools)
    expect(ok.success).toBe(true)
    const d = db.decisions.get('d1')!.data
    expect(d.status).toBe('closed')
    expect(JSON.parse(String(d.winnersJson))).toEqual(['a'])
    expect(String(d.recordText)).toContain('A won')
    expect(typeof d.closedAt).toBe('string')
  })

  it('reveals the full tally on close even in after-close mode', async () => {
    const { tools, db } = fakeTools('owner')
    db.decisions.get('d1')!.data.resultsVisibility = 'after-close'
    await run(castVote, 'u1', { decisionId: 'd1', ranking: ['b'] }, tools)
    await run(closeDecision, 'owner', { decisionId: 'd1' }, tools)
    expect(db.decisions.get('d1')!.data.roundsJson).toBeDefined()
  })

  it('closing with zero ballots is safe and says so', async () => {
    const { tools, db } = fakeTools('owner')
    expect((await run(closeDecision, 'owner', { decisionId: 'd1' }, tools)).success).toBe(true)
    expect(String(db.decisions.get('d1')!.data.recordText)).toContain('No ballots')
  })
})

describe('plainRecord', () => {
  it('describes ties', () => {
    const opts = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]
    expect(plainRecord(opts, tally(['a', 'b'], [['a'], ['b']]))).toContain('tie between A and B')
  })
})
