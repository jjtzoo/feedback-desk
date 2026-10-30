# Handoff: the 30 Oct merge, two fixes after it, and the manager dashboard next (2026-10-30)

Written at the end of the day on the laptop, to carry on in another Claude account. Everything is pushed to the company org (`origin` pushes to both remotes). Nothing is only on the laptop except the test checklist in Documents (listed below).

## 1. First: push the QA'd merge to `main` (the user runs it)

`origin/main` is still `5820439`. The merge commit **`e6ca622`** holds the 29 Oct stack and all of 30 Oct's work, fully checked. It is on GitHub inside `origin/fix/sig-reasoning-leak` and `origin/fix/stepper-latest-dates`, so it can be pushed from anywhere:

```bash
git fetch origin
git push origin e6ca622:main
```

The auto-mode check blocks Claude from pushing to `main`: give the user the command, never work around it. If `main` moved since, rebuild the merge (section 6) instead.

What `e6ca622` contains, merged in this order with `--no-ff`:

| Branch | What |
|---|---|
| `infra/e2e-shards` | Shard timings; 2 shards stay the default |
| `fix/e2e-reset-recovery` | A failed database reset no longer breaks the shard's later resets |
| `ui/internal-notes-and-changes` | The 29 Oct demo fixes (Conversation name D106, merge into the first report, future-only due dates, "N new", internal notes box, Show changes, demo run sheet) |
| `fix/triage-count` | Triage counts and lists only what the person's board shows (non-leads have no Needs review or Awaiting approval column) |
| `feat/internal-note-images` | **D107** images on internal notes (`attachments.is_internal`, migration 0006, `?internal=true`, Digital team only, never on the tracker) |
| `ui/header-and-bell` | Header links on their own row below 1280 px; clearer bell rows |
| `feat/notification-history` | **D108** Clear in the bell (`notifications.cleared_at`, migration 0007); See all notifications: `/notifications` and `/console/notifications`, last 90 days |
| `ui/staff-nav` | **D109** Give feedback is a red button; icons on My feedback and Fixes and updates |
| `feat/release-reactions` | **D110** 👍 Thanks per person per published item (`release_item_thanks`, migration 0008) and Still happening? under Fixed items |
| `feat/release-wording` | **D111** Sig words each Friday draft item (headline and one line), the item's own words when the model is off |
| `test/e2e-follow-ups` | S28.01's new tab order (D109); S05.05 opens Brief before checking the impact |

Plus commits recording mutation checks (sections 14, 16), the full run and coverage, and `docs/testing/conversation-eval-2026-10-30.md`.

Checks on `e6ca622`: Ruff, mypy, 185 backend tests; web build; full browser suite in 2 shards **277 passed, 0 failed, 1 skipped** (S10.09, Docker only); coverage 272 of 285 checklist items have a test; mutation checks 13, 14, 16 all caught; Gemini routing gate **pass** (project 95 %, work type 97.5 %, assignee 97.5 %); conversation checks **92 of 98** (93 on 28 Oct; the six failures are in the eval record).

## 2. Then: two fixes on top of the merge, not yet checked as a batch

Stacked on `e6ca622`, each pushed:

1. **`fix/sig-reasoning-leak`**: `agent/callbacks.after_model` cuts reasoning the model writes as reply text (talk of "system prompt", "my instructions", "the user is asking", "jailbreak"…): everything up to the last such line goes; nothing left gives Sig's off-topic line (`REDIRECT`), or no words when a tool was called. Unit test `test_the_models_reasoning_never_reaches_the_reply`. Also repairs the D105 spec row, whose `C:\benchmark\research` path had become a backspace and a carriage return. **Agent change: run the Gemini conversation checks** (`uv run python -m evals.run_conversations --parallel 3`) and the injection cases several times.
2. **`fix/stepper-latest-dates`** (on top of 1): the tracker stepper shows the latest time each stage was reached, so after a reopen Resolved and Fixed show the second round. Test `test_after_a_reopen_the_stepper_shows_the_latest_round`.

Before they go to `main`: full backend tests, web build, the full browser run and coverage, and the conversation checks. Then merge both into `main` in a detached worktree (the user pushes).

## 3. Next to build: the manager dashboard (D112, decided)

The product owner chose the **manager dashboard** on 30 Oct (instead of the 29 Oct plan to rename the Dashboard "AI cost" and keep only the cost block; the uncommitted draft on `ui/console-trim` is that old plan, don't build on it). Record it as **D112** in the spec (changes brief F16) before building. Still open: **Admins only, or the whole Digital team?** Ask the user first.

What to build, all from `feedback`, `feedback_events` and `release_item_thanks` (no new tables):
- Four tiles with the change since last period and a small trend: open backlog, **median** time to first response, median time to resolve, on-time rate (resolved by the due date).
- Flow: weekly received vs resolved bars with the open backlog as a line; Show table stays.
- Where it's stuck: open items by stage (New, Needs review, Awaiting approval, Approved, In progress) split into age bands (under 2 days, 2 to 7 days, 1 to 4 weeks, over 4 weeks).
- Tools table (per project: new in 30 days, open, oldest, reopened, fixed, 👍 Thanks) and Team table (per person: open, overdue, oldest), sortable; a row opens Work filtered to it. They replace the four "Open by" bar cards.
- Quality line: reopen rate, duplicate or merge rate, routing correction rate, Thanks this month.
- AI cost block unchanged, at the bottom. Period switch: last 4 or 12 weeks. Below about 10 items a chart says "Not enough data yet" with the plain counts.
- Load the `dataviz` skill before any chart code. Current code: `backend/app/services/reports.py` (`dashboard`), `web/src/app/console/dashboard/page.tsx`. Update the dashboard browser tests (section 21) and the checklist.

## 4. Still open after that

- **"All open" for Digital Staff** counts items in columns they can't see (the same mismatch Triage had). Recommended: make it follow the board like Triage; keep "Assigned to me" counting your own items awaiting approval (`test_console_counts_follow_the_inboxes_and_approvals` expects that). Not yet confirmed by the user.
- **Browser tests missing** for checklist items added this week: the notifications page (last item of section 10), Thanks and Still happening? (last two of section 11), the reopen stepper line (last of section 9), S16.06 (merge from the first report). Coverage also warns S03.20 to S03.22 back no requirement in `e2e/requirements.json`.
- **Conversation cases to fix, not Sig**: `answers-impact-when-asked-tool` and `answers-steps-when-asked-tool` expect the tool asked twice (the user decided once, 27 Oct). Long-running: `real-23-goformz-slow-then-submit-fails` (card drops "slow"), `pushback-i-just-told-you` (asks "since when").
- From the 29 Oct handoff, not yet done: undo and backward moves, a console Inbox of conversations, ticket cards in messages, AI-drafted replies, board fit at 1920 px, removing Channels. D38 ("Reported by N people", built, still OPEN): ask the user whether it's now decided.

## 5. The test checklist (Documents, not in git)

`Documents\Feedback test checklist.txt` was edited on 30 Oct; if the other account's machine has an older copy, make these changes (keep the [x] ticks):
- Section 9: new last item, the reopen stepper (Resolved and Fixed show the second round). [D92]
- Section 10: new last item, Clear and See all notifications. [D108]; known gap 5 marked "Fixed 2026-10-30".
- Section 11: two new last items, Thanks (and its count in the console) and Still happening?. [D110]
- Section 13: S13.21 no longer says "the Internal note side has no Add an image"; new S13.23, an internal note's image. [D107]

The spec's master copy (`Documents\feedback-build-spec-v3.md`) matches `docs/feedback-build-spec-v3.md` on the top branch, D107 to D111 included.

## 6. Rebuilding the merge if `main` moved

In a fresh detached worktree from `origin/main`, merge the branches in section 1's order with `--no-ff` (message "Merge <branch>: <what>" plus the Co-Authored-By line), then the checks: `cd backend && uv run ruff check . && uv run mypy && uv run pytest`; `cd web && npm run build`; mutation checks before the full run (`npm run test:e2e:mutation -- NN`); then `npm run test:e2e:full` with no reporter flag, `npm run test:e2e:coverage` straight after, and commit the evidence. Gemini: `uv run python -m evals.run_routing` and `evals.run_conversations --parallel 3` with the key from the root `.env` (`GOOGLE_API_KEY`); keep the full output, not a tail.

## 7. Running the app

Latest code locally (until `main` is pushed and pulled): from the stack's worktree, API on 8001 with Gemini and web on 3000.

```bash
cd .claude/worktrees/conversation-label
GOOGLE_API_KEY=<from the root .env> PORT=8001 APP_BASE_URL=http://localhost:3000 uv --directory backend run python -m scripts.dev_server
cd web && API_ORIGIN=http://127.0.0.1:8001 npx next dev --port 3000
```

After `main` has everything, `.\dev.ps1` in the main checkout works again (stop the worktree's servers first; port 8000 belongs to another app). Its database migrates from 0005 to 0008 on start.

## 8. Demo material

`docs/demo/run-sheet-2.md` (also `Documents\Feedback demo\Feedback - demo run sheet 2 2026-10-30.md`): the 30 Oct demo for Chris on AFSS Portal (RAKE Agent already has this week's release, so the drafter makes none for it). Chris saw it on 30 Oct.

## 9. How the user works (also in Claude's memory on the laptop)

- Hand-testing: quick fixes, commit and push each, restart the preview; no test runs per fix, all checks once at the end of the batch.
- Gemini cost is no concern unless it's a fortune: run model checks in full.
- Every session in its own worktree under `.claude/worktrees`; never switch branches in the shared checkout. One focused branch per change; check decision numbers on all branches before taking one (next free: **D112**).
- The user pushes `main`. Save finished documents to Documents. Record product decisions as decided by the product owner; no "for Marc's review".
- Shell heredocs mangle backslashes on this machine (`\b` became a backspace, `\n` a newline): write files with the editor, or check for control bytes after a script edit.
