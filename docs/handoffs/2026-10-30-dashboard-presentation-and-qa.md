# Handoff: dashboard built and on the presentation server; QA and Sig behaviour next (2026-10-30, evening)

Written because the plan usage was nearly used up. Everything below is pushed to the company org (`origin` pushes to both remotes). Not in git: the test checklist and the spec master copy in Documents (section 6), and `Feedback undo and backward moves design 30 Oct.json` in Documents.

## 0. Read this first: what the user actually asked for

The user's scope for this stretch is **four things only**:

1. The **manager dashboard** (D112, Admins only). **Built and done.**
2. **"All open" following the board.** **Built and done.**
3. The **missing browser tests**, then all the checks (section 3).
4. **Sig's behaviour** (the Gemini conversation failures, section 4).

Plus the standing item: the user pushes `main` (section 2).

I went past that list and built backlog items nobody asked for (Channels removal, backward moves, an Inbox, board width, a phone header fix). The user objected ("wtf the test earlier only had dashboard as missing") and chose **"Stop extras, do tests"**. Those extras are parked on their own branches (section 5). **Do not merge or build any of them unless the user says so, and do not start anything else from the old handoff backlog. When the list is done, report and ask.**

## 1. What is running now (the user's presentation)

Everything runs from the worktree `.claude/worktrees/conversation-label`, now on the local-and-pushed branch **`demo/presentation-30oct`** (`963fb9c`): the stack (`fix/stepper-latest-dates`) plus exactly three merges, `feat/manager-dashboard`, `fix/all-open-follows-board` and `fix/vent-asks-what-happened`, and this handoff. Nothing else.

- API on **8001** with Gemini (`GOOGLE_API_KEY` from the root `.env`), web on **3000**. Restart:

```bash
cd .claude/worktrees/conversation-label/backend
GOOGLE_API_KEY=<from the root .env> PORT=8001 APP_BASE_URL=http://localhost:3000 uv run python -m scripts.dev_server
cd ../web && API_ORIGIN=http://127.0.0.1:8001 npx next dev --port 3000
```

- The local database is `backend/.localdb` in that worktree (migration 0008). **129 made-up items of demo history were added** (`uv run python -m scripts.demo_history`, local only, run once; they carry `context.demo_history`) so the dashboard charts have 14 weeks to show. The presentation data from before is still there.
- Also still running, for comparison: a **preview** on 8011 and 3010 from the detached worktree `.claude/worktrees/preview-30oct`, which merges **every** finished branch including the extras. Stop it (nothing depends on it) when you no longer need it. `.claude/worktrees/manager-dashboard` has no servers.
- Browser tests use their own servers: 8102/3200/8112 with database `fd_e2e_md` (manager-dashboard worktree) and 8202/3300/8212 with `fd_e2e_ao` (all-open-board worktree). Never use port 8000 (another app).

## 2. Push to `main` (the user runs it; Claude can't)

`origin/main` is still `5820439`. The 30 Oct QA'd merge is `origin/test/main-merge-30oct` (all checks passed on it; see the 30 Oct handoff section 0):

```bash
git fetch origin
git push origin origin/test/main-merge-30oct:main
```

If the user wants today's dashboard work in `main` too, it goes in **after the QA in section 3**, in a fresh detached worktree from `origin/main`, merged `--no-ff` in this order: `test/main-merge-30oct` (if not already pushed), `feat/manager-dashboard`, `fix/all-open-follows-board`, `fix/vent-asks-what-happened`, plus whatever test branches you add. The user pushes.

## 3. The work left (about 1.5 to 2 hours plus Gemini runs)

**Missing browser tests** (one new test each, named after the checklist ID; rules in `web/e2e/CLAUDE.md`):
- The notifications page: last item of section 10 (D108, Clear and See all notifications).
- Thanks and Still happening?: last two items of section 11 (D110).
- The reopen stepper line: last item of section 9 (D92).
- **S16.06**: merging from the first report (backend test exists).
- `S03.20` to `S03.22` back no requirement in `web/e2e/requirements.json`; add them.
Each new test needs its mutation record in `web/e2e/mutations/sNN.json` and a `npm run test:e2e:mutation -- NN` run. Work one spec at a time, then:

**End-of-batch checks**, once, on the merged build: `cd backend && uv run ruff check . && uv run mypy && uv run pytest`; `cd web && npm run build`; mutation checks for the sections changed (done and caught today on 18, 21, 22; S12.19 was shown to fail without its fix); then `npm run test:e2e:full` (no `--reporter` flag), `npm run test:e2e:coverage` straight after, and commit the evidence. The agent instruction changed, so also `cd backend && uv run python -m evals.run_routing` (gate 85/85/80) and `uv run python -m evals.run_conversations --parallel 3`, keeping the full output.

**State of the dashboard and All open checks** (already done): backend 189 passed, Ruff and mypy clean; browser section 21 (8 tests) passed and the six other changed files (01, 02, 14, 18, 22, 28; 66 tests) passed; mutation checks 21, 18, 22 all caught; S12.19 passed (board spec 20 passed) and went red with the fix reverted. Not yet run: the full browser suite and coverage on the combined build, `npm run build`.

## 4. Sig's behaviour (Gemini)

From `docs/testing/conversation-eval-2026-10-30.md`: 91 of 98 on the final merge. Status:
- **vent-then-useful**: fixed on `fix/vent-asks-what-happened` (in the presentation build). To someone only venting Sig now asks what happened before the tool; after any named problem it asks which tool once. Both vent cases passed 3 runs out of 3 on Gemini. The full conversation set has not been re-run with it.
- **answers-impact-when-asked-tool, answers-steps-when-asked-tool**: the *cases* are wrong, not Sig. They expect the tool to be asked twice; the user decided once on 27 Oct. Fix the case files in `backend/evals/` (`conversation_cases*.yaml`).
- **real-23-goformz-slow-then-submit-fails**: the card drops "slow". Instruction tweak, then re-run on Gemini several times.
- **pushback-i-just-told-you**: after "I just told you" Sig still asks "since when". Same.
- Typo and sarcasm cases (typo-go-forms-extention, sarcasm-wonderful-update) flake and passed twice each when re-run; watch them.
Run `uv run python -m evals.run_conversations --only <name> --parallel 3` per fix, then the whole set once at the end. Gemini cost is no concern.

## 5. Parked branches (all pushed; none is in `main` or the presentation build)

| Branch | State |
|---|---|
| `feat/remove-channels` (`787dac3`) | **Finished and checked in part.** Removes Channels (D40, user chose "remove completely" on 30 Oct), records D38 as decided as built; migration **0009** (tested up, down, up); web and e2e lists updated; checklist section 17 marked removed. Backend `test_workspace` and `test_platform_auth` pass, web `tsc` and ESLint clean; the full suites were not run. Merging it with `feat/manager-dashboard` conflicts in `docs/feedback-build-spec-v3.md` (take the Documents master copy), and in `web/e2e/01-sign-in-roles.spec.ts` and `02-landing.spec.ts` (S01.11 menu: Work, Releases, Admin, no Channels, no Dashboard; S02.08 guide: Mario sees Work, Releases; Chris adds Approvals, Dashboard, Admin). The preview worktree has that resolution. |
| `ui/board-fit` (`9d72574`) | Finished. Board columns share the row width (min 16rem, max 26rem) so five columns fit at 1920 px. |
| `ui/console-header-phone` (`81ff5cf`) | Finished. The "Smoke Signal" name is screen-reader-only below 640 px, so the console (was 457 px at 390) and staff (411 px for the Digital team) headers stop scrolling sideways. |
| `feat/backward-moves` (`a75d704`) | **WIP, unreviewed.** Un-approve, Stop work, Reopen (console), the Ask for info button, reply refused on ended items; 9 backend tests passed, web tsc/ESLint clean; two review agents' findings are in the workflow journal `C:\Users\Jacob Toledo\.claude\projects\c--Apps-Feedback\3f526701-815e-49d5-b82c-8a841021f1a2\subagents\workflows\wf_7b06a4ec-c49\journal.jsonl` and **were not acted on**. Decisions the user made: reasons for Un-approve and Stop work stay internal; Reopen is Admins only with a public reason. Not recorded in the spec yet (it would be the next free D number). S13.17 will fail when this merges (the badge became a button). Stacked on `feat/remove-channels`. |
| `feat/console-inbox` (`5c597a0`) | **Half-built.** Backend only (`services/inbox.py`, `GET /console/inbox`, `inbox` in `/console/counts`); no web page, no tests, no spec row. |
| Not started | Undo toast (the design is in Documents, `Feedback undo and backward moves design 30 Oct.json`), ticket cards in messages, AI-drafted replies. |

## 6. Documents (not in git)

- `Feedback test checklist.txt`, edited today, **all 39 of the user's [x] ticks kept**: section 21 rewritten as 8 items for the dashboard (D112); S01.11, S02.08, S14.07, S18.13, S22.07 follow it; **S12.19** added as the last item of section 12 ("All open" follows the board); section 17 marked removed and Channels dropped from the menu lists (these two belong to the parked Channels branch, so if it is not merged, put those lines back: section 17 and the Channels mentions in the intro, S01.11, S02.08, section 20's "channel items", S23.04, gaps 13 and 18).
- `feedback-build-spec-v3.md` (master) holds D112 (dashboard), D38 decided as built and D40 removed, plus F15 removed. Each repo branch only has its own part (D112 on `feat/manager-dashboard`, D38 and D40 on `feat/remove-channels`). If Channels is not merged, undo the D38 and D40 edits and F15 in the master.
- The dashboard's spec row is **D112**; the next free number is D113 (check every branch first).

## 7. How the user works

- **Do only what was listed.** A handoff's "still open" list is a backlog, not a to-do list. Report and ask before going past it.
- "Functionality first before tests" and "quick fixes without running suites; all checks once at the end of the batch" still stand, inside the agreed scope.
- Every session in its own worktree under `.claude/worktrees`; never switch branches in the shared checkout. The user pushes `main`.
- Record product decisions as decided by the product owner. Save finished documents to Documents. Gemini cost is no concern.
- Shell heredocs mangle backslashes here; write files with the editor.
- Commit messages end with the attribution line given in the session.
