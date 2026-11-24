/**
 * Decisions + ballots.
 *
 * Integrity model (the main design decision in this app):
 *  - Clients may only create a decision (title, description, options, visibility)
 *    and edit its title/description. Options and visibility are `immutable`, so
 *    nobody can change the choices after ballots exist.
 *  - Tally fields (ballotCount, roundsJson, winnersJson, status, recordText…)
 *    are NOT in `writableFields`, so only server actions can set them.
 *  - Ballots are never written by clients at all and are readable only by their
 *    author. Every vote goes through the `cast-vote` action, which validates it
 *    and recomputes the tally. That is what keeps a ballot private and a result
 *    unforgeable even though the app is otherwise live-synced.
 */

import type { CollectionSchema } from 'deepspace/schema'

export const decisionsSchema: CollectionSchema = {
  name: 'decisions',
  columns: [
    { name: 'title', storage: 'text', interpretation: 'plain', required: true, maxLength: 120 },
    { name: 'description', storage: 'text', interpretation: 'plain', maxLength: 600 },
    {
      name: 'optionsJson',
      storage: 'text',
      interpretation: { kind: 'json' },
      required: true,
      immutable: true,
      maxLength: 4000,
    },
    {
      name: 'resultsVisibility',
      storage: 'text',
      interpretation: { kind: 'select', options: ['live', 'after-close'] },
      default: 'live',
      immutable: true,
    },
    {
      name: 'status',
      storage: 'text',
      interpretation: { kind: 'select', options: ['open', 'closed'] },
      default: 'open',
    },
    { name: 'ballotCount', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'roundsJson', storage: 'text', interpretation: { kind: 'json' }, maxLength: 20000 },
    { name: 'winnersJson', storage: 'text', interpretation: { kind: 'json' }, maxLength: 2000 },
    { name: 'tie', storage: 'number', interpretation: { kind: 'boolean' }, default: false },
    { name: 'recordText', storage: 'text', interpretation: 'plain', maxLength: 3000 },
    { name: 'closedAt', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: true, create: false, update: false, delete: false },
    member: {
      read: true,
      create: true,
      update: 'own',
      // No delete: removing a decision would orphan its ballots.
      delete: false,
      writableFields: ['title', 'description', 'optionsJson', 'resultsVisibility'],
    },
    admin: { read: true, create: true, update: true, delete: true },
  },
}

export const ballotsSchema: CollectionSchema = {
  name: 'ballots',
  columns: [
    { name: 'decisionId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'ranking', storage: 'text', interpretation: { kind: 'json' }, required: true, maxLength: 4000 },
    { name: 'comment', storage: 'text', interpretation: 'plain', maxLength: 500 },
  ],
  permissions: {
    // Authors can read their own ballot (to prefill the ranking UI). Nobody
    // can write from the client; the cast-vote action is the only writer.
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: 'own', create: false, update: false, delete: false },
    admin: { read: 'own', create: false, update: false, delete: false },
  },
}
