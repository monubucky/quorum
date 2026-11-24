import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { castVote, closeDecision } from './decisions'

export const actions: Record<string, ActionHandler<Env>> = {
  'cast-vote': castVote,
  'close-decision': closeDecision,
}
