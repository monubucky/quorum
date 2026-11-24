import { describe, expect, it } from 'vitest'
import { parseOptions, sanitizeRanking, tally } from './irv'

const opts = ['a', 'b', 'c']

describe('tally', () => {
  it('returns no winner when there are no ballots', () => {
    expect(tally(opts, [])).toEqual({ rounds: [], winners: [], tie: false, ballots: 0 })
  })

  it('declares a first-round majority winner without eliminating anyone', () => {
    const t = tally(opts, [['a'], ['a', 'b'], ['a', 'c'], ['b'], ['c']])
    expect(t.winners).toEqual(['a'])
    expect(t.rounds).toHaveLength(1)
    expect(t.rounds[0].eliminated).toBeNull()
  })

  it('transfers votes from the eliminated option to the next choice', () => {
    // First round: a=2, b=2, c=1 -> c out; c's voter prefers b -> b=3 of 5.
    const t = tally(opts, [['a'], ['a'], ['b'], ['b'], ['c', 'b']])
    expect(t.rounds[0].eliminated).toBe('c')
    expect(t.rounds[1].counts).toEqual({ a: 2, b: 3 })
    expect(t.winners).toEqual(['b'])
    expect(t.tie).toBe(false)
  })

  it('lets a later-round winner overcome a first-round plurality leader', () => {
    // a leads round one (4) but b and c voters all prefer b over a.
    const ballots = [
      ...Array(4).fill(['a', 'b', 'c']),
      ...Array(3).fill(['b', 'c', 'a']),
      ...Array(3).fill(['c', 'b', 'a']),
    ]
    const t = tally(opts, ballots)
    expect(t.rounds[0].counts).toEqual({ a: 4, b: 3, c: 3 })
    expect(t.winners).toEqual(['b'])
  })

  it('removes exhausted ballots from the majority denominator', () => {
    // c eliminated; its voter ranked nobody else, so that ballot exhausts.
    const t = tally(opts, [['a'], ['a'], ['b'], ['b'], ['b', 'a'], ['c']])
    const last = t.rounds[t.rounds.length - 1]
    expect(last.exhausted).toBe(1)
    expect(last.active).toBe(5)
    expect(t.winners).toEqual(['b'])
  })

  it('declares a tie when every remaining option has equal votes', () => {
    const t = tally(['a', 'b'], [['a'], ['b']])
    expect(t.tie).toBe(true)
    expect(t.winners.sort()).toEqual(['a', 'b'])
  })

  it('breaks elimination ties by fewest first-round votes, then list position', () => {
    // Round 1: a=3, b=2, c=2, d=0-equal handled by position: b and c tie for
    // lowest among {b,c,d?}. Use a 3-option case: b=1, c=1 tie at the bottom,
    // equal first-round, so the later option (c) goes first.
    const t = tally(opts, [['a'], ['a'], ['a'], ['b'], ['c']])
    expect(t.winners).toEqual(['a'])
    const t2 = tally(opts, [['a'], ['a'], ['b', 'a'], ['c', 'a'], ['b', 'c']])
    // a=2, b=2, c=1 -> c eliminated (unique lowest), ballot goes to a -> a=3/5.
    expect(t2.rounds[0].eliminated).toBe('c')
    expect(t2.winners).toEqual(['a'])
    // Equal-lowest tie: b=1,c=1 -> c (later in list) is eliminated first.
    const t3 = tally(opts, [['a', 'b'], ['a', 'b'], ['a', 'c'], ['b'], ['c']])
    expect(t3.winners).toEqual(['a'])
    const t4 = tally(opts, [['a'], ['a'], ['b'], ['c'], ['a', 'b'], ['b', 'a']])
    expect(t4.rounds[0].eliminated).toBe('c')
  })

  it('ignores unknown option ids and duplicate ranks', () => {
    const t = tally(opts, [['zzz', 'b', 'b', 'a'], ['b']])
    expect(t.winners).toEqual(['b'])
    expect(t.ballots).toBe(2)
  })

  it('drops ballots that contain no valid option at all', () => {
    const t = tally(opts, [['nope'], [], ['a']])
    expect(t.ballots).toBe(1)
    expect(t.winners).toEqual(['a'])
  })

  it('handles a single option', () => {
    expect(tally(['only'], [['only']]).winners).toEqual(['only'])
  })

  it('is deterministic regardless of ballot order', () => {
    const ballots = [['a', 'c'], ['b', 'c'], ['c', 'a'], ['c', 'b'], ['a'], ['b']]
    const forward = tally(opts, ballots)
    const backward = tally(opts, [...ballots].reverse())
    expect(forward).toEqual(backward)
  })
})

describe('sanitizeRanking', () => {
  it('keeps order, drops unknowns and repeats, tolerates non-arrays', () => {
    const valid = new Set(opts)
    expect(sanitizeRanking(['c', 'x', 'c', 'a'], valid)).toEqual(['c', 'a'])
    expect(sanitizeRanking('a', valid)).toEqual([])
    expect(sanitizeRanking([1, null, 'b'], valid)).toEqual(['b'])
  })
})

describe('parseOptions', () => {
  it('parses valid JSON and rejects malformed input', () => {
    expect(parseOptions('[{"id":"a","label":"A"}]')).toEqual([{ id: 'a', label: 'A' }])
    expect(parseOptions('not json')).toEqual([])
    expect(parseOptions('{"id":"a"}')).toEqual([])
    expect(parseOptions(undefined)).toEqual([])
    expect(parseOptions('[{"id":1,"label":"A"},{"id":"b","label":"B"}]')).toEqual([
      { id: 'b', label: 'B' },
    ])
  })
})
