# Handoff: shard timings and the demo fixes (2026-10-29)

Written at the end of the day on the old laptop, to carry on on another machine. Nothing was pushed to `main` today: `origin/main` is still `5820439`. Every change is on a pushed branch.

## Branches, in the order they build on each other

| Branch | Tip | What |
|---|---|---|
| `infra/e2e-shards` | `0c52827` | Shard timings (1 run 913 s, 2 shards 605 s, 3 shards 683 s, 4 shards 661 s with 2 proxy drops); 2 stays the default; FINDINGS note |
| `fix/e2e-reset-recovery` (from main) | `4f5cca8` | A failed database reset no longer breaks every later reset in that shard (dispose the engine always, retry once on a deadlock) |
| `ui/conversation-label` | `863f754` | D106: "Activity" renamed Conversation; "In this conversation" names each person once (S13.22) |
| `test/conversation-e2e` (other session) | `0a0c610` | D105's browser tests, item-conversations merged in |
| `fix/guide-deep-link` | `52de081` | The tour no longer sends someone who came by a link to the home page |
| `fix/chat-reference-link` | `9c32d7e` | A reference typed to Sig gets an "Open FB-…" link; Sig's follow-up wording current. **Instruction changed** |
| `fix/duplicate-send-as-new` | `8b2713e` | After a possible duplicate Sig goes on to the card, so a different problem can be sent as new. **Instruction changed** |
| `fix/merge-into-first` | `6ea81f3` | One Merge button; the older ticket always takes in the newer one; "Merge FB-0002 into FB-0001?" with no undo; duplicate callout above the tabs |
| `fix/due-date-future` | `757c45d` | Merges `test/conversation-e2e` into the stack; the due date calendar offers no past day (S14.04 sets yesterday through the API) |
| `ui/conversation-emphasis` | `9fd93c6` | Conversation tab shows "N new"; an item someone wrote on opens on Conversation |
| `ui/internal-notes-and-changes` | top of the stack | Internal notes in an amber box; Show changes switch; this handoff and `docs/demo/` |

`ui/internal-notes-and-changes` contains every branch above except `infra/e2e-shards` and `fix/e2e-reset-recovery`.

## To get it to main

1. In a detached worktree from `origin/main`: merge `origin/infra/e2e-shards`, then `origin/fix/e2e-reset-recovery`, then `origin/ui/internal-notes-and-changes`. Checked with `git merge-tree`: no conflicts. (This laptop had local-only merge commits `b2d8f79` and `5ae349c`; ignore them.)
2. Backend checks and `npm run build`. Backend: 183 passed on the stack.
3. Full browser run, `npm run test:e2e:full` (2 shards). The last full run (on `5ae349c`, before today's fixes) had 267 passed and 2 failed, both from the reset bug that `fix/e2e-reset-recovery` fixes. Specs run on their own today, all passing: 05, 10, 13, 14, 15, 16, 18.
4. **Gemini gate**: Sig's instruction changed twice, so run `uv run python -m evals.run_routing` and the conversation checks before merging. Checked by hand only: Tom's "When uploading big PDF file it timeouts." got FB-0001 as a duplicate (0.91 similar) and the card in the same reply.
5. `npm run test:e2e:coverage`, then the mutation checks for sections 13, 14 and 16.
6. The user pushes `main`.

## Still to write down

- **Spec decisions, D107 onward** (D107 is free everywhere; record them in one docs commit, and in the master copy in Documents):
  - The merge rule: on a click, the older ticket always takes in the newer one, from either item; it asks first and says there's no undo; never automatic (F8).
  - The duplicate callout sits above the panel's tabs, amber while open, Merge as the main button.
  - Due dates: days already gone can't be picked.
  - The Conversation tab shows "N new"; an item someone wrote on opens there.
  - Internal notes in an amber box (turns over D105's "an amber line, never a box"); Show changes switch.
  - Ask the user whether D38 (the "Reported by N people" tally, built, still OPEN) is now decided by them.
- **Browser test**: checklist S16.06 (merge from the first report) has no browser test yet; the backend test covers it.
- `docs/architecture.md`: say merges always go into the first report.

## The checklist in Documents (not in git)

Edited today on the old laptop; if the other machine has an older copy, make the same changes (keep the [x] ticks):
- Section 13: new last item **S13.22** (a reporter who also approved shows once, with both roles).
- "Activity" reads "Conversation" in the seven lines that used it (sections 8, 9, 10, 13 and the With Mario lines).
- **S14.04**: "Open Change the due date: days before today are greyed out and can't be picked. Give an item yesterday's due date (through the API). Expected: …"
- **S16.01/S16.02**: "click Merge", "the newer item closes", "Merge with another reference…"; new last item **S16.06** (merge from the first report).

## The demo

Run sheet, feature list and Chris walkthrough: `docs/demo/` (also in `Documents\Feedback demo\` on the old laptop). Run it on Gemini, from fresh data:

```bash
# API on 8041 with the Gemini key (only the key from the root .env), web on 3040
GOOGLE_API_KEY=... PORT=8041 APP_BASE_URL=http://localhost:3040 uv --directory backend run python -m scripts.dev_server
cd web && API_ORIGIN=http://127.0.0.1:8041 npx next dev --port 3040
```

Items saved on the stub have stub fingerprints, which Gemini's duplicate search ignores; `embeddings.backfill` re-fingerprints them.

## Next, from the other session's handoff

Undo and backward moves (top priority), a console Inbox of conversations, ticket cards in messages, AI-drafted replies, removing Channels and the Dashboard as "AI cost", fitting the board at 1920 px.
