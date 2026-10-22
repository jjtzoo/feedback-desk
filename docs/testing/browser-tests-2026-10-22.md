# Browser tests: run of 2026-10-22

Record of the automated browser tests of the manual test checklist (`Feedback test checklist.txt`): what they cover, how they were run, what came out and how far the result can be trusted. The view by requirement of the brief (F1 to F18, as in [requirements.md](../requirements.md)) is in [feature-evidence.md](feature-evidence.md); every item and its test is in `web/e2e/COVERAGE.md`; the bugs found are in `web/e2e/FINDINGS.md`. Both of those, and the tables below, are generated from the test run or checked against it.

## What they test

The checklist's sections 3 to 21 and 23 to 26 and 28: the staff chat, confirm card, duplicates, backup form, My feedback, tracker, reply and reopen, notifications and What's new, then the Digital team console (board, item panel, status changes, notes, merge, project channels) and the Admin screens (approvals, admin page, Friday releases, dashboard), then the cross-cutting checks on roles enforced by the server, staff seeing only their own items, nothing saved without Confirm, masking and the keyboard. Sections 1, 2 and 22 (sign-in and roles, landing page, AI usage) and 27, 29 and 30 (mobile, dark mode, reduced motion) have no browser test yet.

Each test proves one checklist item against the real app (database, API, Next.js) through a real browser. A test is named after its item (`S08.06 …`: section 8, item 6), so every result traces to a line of the checklist.

## Method

1. A browser (Chromium, driven by Playwright 1.64.1) signs in as a seeded person, one of six staff, three Admins or two Digital Staff, and does what the checklist says. Other people are opened in their own windows for the two-person checks. Setting things up (raising and approving an item, for example) goes through the API; what is being checked is read from the screen.
2. The database is put back to its seed before every spec file, so no file depends on another.
3. Every test must be able to fail. For each passing test one key assertion was broken on purpose, for example by adding a letter to the text it expects, and the test had to go red. The break is made by a committed tool (`npm run test:e2e:mutation -- NN`), which puts the file back afterwards and keeps a dated record in `web/e2e/evidence/`.
4. Nothing in the app was changed to make a test pass. When the app does not do what the checklist says, the test is marked as a known bug and the bug is written down.

Code and rules: `web/e2e/` and `web/e2e/CLAUDE.md`.

## Setup for this run

| Item | Value |
| --- | --- |
| Date | 2026-10-22 |
| Code under test | branch `ui/smoke-signal-brand` at `81bc2df` plus the uncommitted working changes of that day (nothing committed for the tests yet) |
| Model | the scripted stub model, not Gemini |
| Database | throwaway local Postgres 16 + pgvector (pgserver, database `fd_e2e`), seeded by `app.seed`: 5 Digital Staff, 15 projects, routing rules |
| Servers | API on port 8002, web (production build) on 3100; email off |
| Environment | local only; one worker; Chromium desktop |
| Run | whole suite, 185 tests in 6.0 minutes |

## Results

The whole suite: **172 passed, 13 skipped, none failed.** Five of the 172 are known bugs that fail as expected (listed below), so 167 are plain passes: 163 checklist tests and 4 setup checks.

| Section | Items | With a test | Passing | Known bug | Skipped | Shown able to fail |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 3. Staff: chat | 17 | 17 | 17 | 0 | 0 | 17 |
| 4. Confirm card | 13 | 13 | 13 | 0 | 0 | 13 |
| 5. Duplicates | 6 | 6 | 6 | 0 | 0 | 6 |
| 6. Backup form | 7 | 7 | 5 | 0 | 2 | 5 |
| 7. My feedback | 5 | 5 | 4 | 1 | 0 | 4 |
| 8. Tracker | 12 | 12 | 12 | 0 | 0 | 12 |
| 9. Reply and reopen | 5 | 5 | 5 | 0 | 0 | 5 |
| 10. Notifications | 9 | 9 | 7 | 0 | 2 | 7 |
| 11. What's new | 5 | 5 | 5 | 0 | 0 | 5 |
| 12. Board | 15 | 15 | 9 | 0 | 6 | 9 |
| 13. Item panel | 11 | 11 | 10 | 1 | 0 | 10 |
| 14. Status changes | 7 | 7 | 6 | 1 | 0 | 6 |
| 15. Notes and updates | 4 | 4 | 4 | 0 | 0 | 4 |
| 16. Merge and duplicates | 4 | 4 | 1 | 0 | 3 | 1 |
| 17. Project channels | 6 | 6 | 6 | 0 | 0 | 6 |
| 18. Approvals | 13 | 13 | 13 | 0 | 0 | 13 |
| 19. Admin page | 10 | 10 | 10 | 0 | 0 | 10 |
| 20. Friday releases | 9 | 9 | 9 | 0 | 0 | 9 |
| 21. Dashboard | 5 | 5 | 5 | 0 | 0 | 5 |
| 23. Roles enforced on the server | 4 | 4 | 4 | 0 | 0 | 4 |
| 24. Staff see only their own items | 3 | 3 | 3 | 0 | 0 | 3 |
| 25. Nothing saved without Confirm | 3 | 3 | 3 | 0 | 0 | 3 |
| 26. Masking of passwords, card numbers and TFNs | 3 | 3 | 3 | 0 | 0 | 3 |
| 28. Keyboard | 5 | 5 | 3 | 2 | 0 | 3 |
| **Total** | **181** | **181** | **163** | **5** | **13** | **163** |

181 of the checklist's 227 items have a browser test.

### Known bugs the tests found

| ID | What the app does | Checklist expects |
| --- | --- | --- |
| S07.02 | My feedback rows have no stage badge | a stage badge on wider screens |
| S13.08 | an internal note has the dashed border and label but no lock icon | a lock icon |
| S14.05 | after Resolve the newest tracker entry is "Update: …" and "Resolved: …" is second | "Resolved: …" as the last entry (this reading of "last" still to be confirmed) |
| S28.01 | on the chat page, Tab stops on a hidden 1 px file input with no visible focus ring | a visible focus ring on every control |
| S28.03 | after Esc closes a dialog, focus does not return to the button that opened it | focus returns |

Details and steps: `web/e2e/FINDINGS.md`. Two findings there are not checklist items and matter more than the rest. First, a staff member's tracker reply with a password, card number and TFN is masked in the saved message but reaches the owner's bell notification unmasked (confirmed against the test app; no fix yet). Second, the live notification stream held a database transaction open for as long as a page was open; a fix is committed on its own branch (`fix/stream-idle-transaction`) and is not merged.

### Skipped, and why

| Items | Reason |
| --- | --- |
| S06.01, S06.07 | need the API restarted with no model (later stage) |
| S10.02 | the live notification count over the event stream (later stage) |
| S10.09 | needs Docker and Mailpit |
| S12.05 to S12.10 | board drag-and-drop and the keyboard move (later stage) |
| S16.01 to S16.03 | merging through the item panel (later stage) |

## Open points

- **Five one-off results.** Across about 200 tests, five results went wrong once and passed on every rerun: one failure in the first full run (the test name was not captured), one database reset that timed out, one project filter that listed only "All projects", one test that reported as not able to fail, and one that timed out instead of failing. None has been reproduced. Each is listed in `FINDINGS.md` and stays open until the planned repeat runs (10 in a row, per test) either reproduce it or show it is gone.
- **Two weaker tests.** S16.04's break covers only the "Merge into it" button, not the check that nothing merged by itself. S21's date test is tied to the current week's numbers and would fail if a run crossed Monday midnight UTC.
- **A rule bent.** S14.07 resets the database in the middle of its file.
- **The checklist's own wording.** S12.04 asks for a work type badge and the card shows plain text. S13.06 says "Assigned to Mario" where the tracker says "Reassigned to Mario". Both are logged to confirm.

## How far this can be trusted

- Every test uses the scripted stub model on a local database. None ran against Gemini, on staging or in production. The routing quality against Gemini is a separate record (`routing-eval-2026-10-21.md`).
- "Passing" means the screen did what the checklist says in that run. "Shown able to fail" means the test goes red when its key check is wrong. Neither shows the feature is free of bugs, and the repeat runs, which test whether a result is stable, have not been done yet.
- The tests check what the checklist describes, no more. Layout, colour, mobile width, keyboard and dark mode (sections 27 to 30) are not covered yet.
- Passing browser tests do not replace the pre-deployment checklist and post-deployment verification in `docs/deployment.md`.

## What can be claimed today

The staff chat, confirm card, duplicates, backup form, My feedback, tracker, reply, notification and What's new flows, the Digital team console, the Admin screens, and the checks on roles, own-items-only, confirm-before-save, masking and the keyboard each pass automated browser tests on the stub model against a local database, with 5 known bugs logged and one privacy leak found outside the checklist. 181 of the 227 manual checklist items are automated, and 163 pass and are shown able to fail.

Not yet: any feature as "pressure-tested" (that needs the 10-in-a-row runs), the sign-in, landing page and AI usage checks (sections 1, 2 and 22), the mobile, dark mode and reduced motion checks, the board drag-and-drop, merging and live-notification cases, or anything on staging or against Gemini. Beta or production readiness also depends on the sprint gates in the build spec (Marc and Chris sign them off there, not here), the deployment checklist, and the pilot.

## Where this leaves the build

Against the sprint plan in the task sheet (prepared 21 October), the application is built through all four sprints locally and is in verification. Not yet done, and not done by anything in this document: the four gate sign-offs by Marc and Chris (all four show Not Started), the deployment to staging with its post-deployment checks, the UAT walk-through on staging, the production deployment, the pilot with about 15 staff, and the intranet tile. The routing test scored 97.5 % project, 97.5 % work type and 100 % assignee on Gemini against the draft labels (gate 85 / 85 / 80); Marc still has to review the labels  and the three-run spread is still to be recorded . Notifications was still marked in progress. The browser tests above add evidence for the requirements built in Sprints 2 to 4; they do not close a gate.

## What comes next

1. Batch 3 of the writing: sections 23 to 30.
2. The hard cases (live notifications, board drag-and-drop, the Guide tour, the backup form, duplicate merging, file drag-and-drop), each repeated 10 times in a row, which also tests the one-off results above.
3. A look at mobile, dark mode and reduced motion, with screenshots for a person to review.
4. An audit: checklist items with no test, tests that would pass with the feature broken, rules bent.
5. A one-page version for the IT director and Marc.
