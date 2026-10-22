# Browser tests: Stage 3 run of 2026-10-23

Follows [browser-tests-2026-10-22.md](browser-tests-2026-10-22.md), which describes what the tests cover and the method (unchanged). This run adds the hard cases left over from that day and the repeat runs. Generated views: every item and its result in `web/e2e/COVERAGE.md`; per requirement of the brief in [feature-evidence.md](feature-evidence.md); the bugs in `web/e2e/FINDINGS.md`.

## Setup for this run

| Item | Value |
| --- | --- |
| Date | 2026-10-23 |
| Code under test | branch `feat/browser-tests-hard-cases` at `27088b4`, no uncommitted changes in `web/` or `backend/`; coverage recorded at `3db19c9`, which changes only the coverage script |
| Model | the scripted stub model, not Gemini |
| Database | local Postgres 16 + pgvector (pgserver, database `fd_e2e`), seeded by `app.seed` |
| Servers | API on 8002, run by a supervisor on 8012 that can restart it without a model; web (production build) on 3100; email off |
| Environment | local only; one worker; Chromium desktop |
| Run | whole suite, 223 tests in 11.3 minutes: 214 passed, 8 known bugs (failed as expected), 1 skipped, 0 failed |

## What changed since 2026-10-22

| Items | Now |
| --- | --- |
| S02.02 to S02.08, the Guide tour | pass |
| S06.01, S06.07, the API restarted with no model | pass (two real restarts of the API process) |
| S12.05 to S12.10, board drag-and-drop and keyboard move | pass |
| S16.01 to S16.03, merging through the item panel | pass |
| S22.02 to S22.04, spend limits | pass (usage rows added to the test database, since the stub records none) |
| S10.02, the bell count rising live | known bug: the web server gzips the event stream, so the count changes only on reload |
| S22.05, a limit reached mid-chat | known bug or open decision: the chat carries on; spec D36 says it should, the checklist says the backup form takes over (recorded as OPEN in D36) |
| S10.09, Mailpit under Docker | still skipped: this machine has no Docker |

219 of 227 checklist items have a test, as before; 214 pass, every one of them shown able to fail (each spec edited today had its mutation check re-run).

## Repeat runs

Each spec below was run 10 separate times in a row (a fresh database reset every run), and every test in it passed all 10: specs 01, 02, 06, 09, 11, 12, 13, 16, 21, 22 and 23. That is 91 checklist items with a current 10-in-a-row record (`web/e2e/evidence/stress.json`, checked against each spec's fingerprint).

The six results that went wrong once on 2026-10-22 are closed in `FINDINGS.md`, each with its cause:
- Three were test weaknesses, now fixed: S01.05 (a race between sign-out and the console's own redirect), S13.01 (a measurement during the panel's slide-in) and S21.03 (setup inside the test, no request timeout).
- Two were the web server's `/api` proxy dropping a request (S09.03, the unnamed first-run failure; S12.13). That is logged as an infrastructure finding; the tests now fail fast with the status instead of hanging.
- S11.01's reset timeout has no cause in the records; the reset now reports its time and output if it happens again.

## Known bugs

8, all in `FINDINGS.md`: S07.02, S10.02, S13.08, S14.05, S22.01, S22.05, S28.01, S28.03. Outside the checklist: the bell notification that leaks an unmasked password, card number and TFN (S26.02, related), and the occasional `/api` proxy drop.

## For a person to decide

- **S22.05 against D36.** Should a chat already in progress stop when a limit is reached (the checklist), or always finish (D36 today)? Marc's call; recorded as OPEN in D36.
- **S02.02 wording.** OK shows only on steps that ask for a click; "Your console" and "Smoke Signal home" show Next though they highlight something clickable. The test follows the app; the checklist line may need rewording.

## How far this can be trusted

- Everything ran on the stub model on a local database; nothing on staging or against Gemini.
- "Repeated" covers 91 items, not all 214 passing ones: the other specs have not had their 10 runs yet.
- Sections 27, 29 and 30 (mobile, dark mode, reduced motion) still have no browser test.
- Passing browser tests do not replace the pre-deployment checklist and post-deployment verification in `docs/deployment.md`, and they do not close a sprint gate.
