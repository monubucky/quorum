# Quorum

Group decisions by ranked-choice vote. Someone posts a decision with 2-12 options, everyone ranks them, and the instant-runoff count updates live for the whole group, round by round. When the creator closes voting, an AI-written decision record is saved with the result.

Built on DeepSpace. Live URL: _add after `npx deepspace deploy`_.

## How it works

| Piece | DeepSpace feature | Why |
|---|---|---|
| Decisions, live counts | `RecordRoom` + `useQuery` | Votes from teammates appear without refresh; no polling code. |
| Private ballots | per-collection RBAC (`read: 'own'`, no client writes) | Nobody can read anyone else's ranking from the client. |
| Unforgeable results | server actions (`cast-vote`, `close-decision`) | The server validates every ballot and writes the tally; clients can't set tally fields (`writableFields`) or change options (`immutable`). |
| Decision record | `integration('openai/chat-completion')` from an action | Summarizes the result and anonymous comments; falls back to a deterministic sentence if the call fails. |

Tally logic lives in `src/lib/irv.ts`, pure and shared by worker and browser. Rules are documented at the top of that file.

## Tradeoffs I made

- **Server-side tally instead of client-side.** Slower to build than letting clients write ballots, but it is the only way to keep ballots private *and* results trustworthy in an app where every other collection is live-synced to every client.
- **Options are immutable after creation.** Editing options would invalidate existing ballots. Cost: typos need a new decision.
- **No decision deletion.** Deleting would orphan ballots; I'd rather add archive than cascade deletes I haven't tested.
- **Up/down buttons, not drag-and-drop.** Keyboard and screen-reader friendly, mobile-safe, and far less code to get wrong.
- **Deterministic tie-breaks, declared ties.** Fewest first-round votes goes first, then later list position; a true all-way tie is reported as a tie, never random.
- **Left out:** anonymous-by-default voter names, comments threads, Yjs collaborative description editing, payments, messaging. None would improve the core job (reach a fair group decision) enough to justify the scope.

## Next steps

1. Scheduled auto-close with a deadline via a `CronRoom` task.
2. Open-ended invites (private decisions limited to invited members).
3. Switch AI billing to `user` mode so decision creators don't spend the owner's credits.
4. Playwright multi-user test (`deepspace/testing`) for the live-count flow.

## Run / test / deploy

```bash
npm install
npx deepspace auth login
npx deepspace app init --json        # mints the app id (replaces __APP_ID__ in wrangler.toml)
npx deepspace dev start
npm run type-check
npx vitest run src                    # 21 unit tests (tally + server actions)
git add -A && git commit -m "Quorum"  # deploy refuses a dirty tree
npx deepspace deploy
```
