# Browser tests (Playwright): ground rules

These rules apply to everything under `web/e2e/`. The root `CLAUDE.md` still applies.

## What these tests are

Automated versions of the manual checklist, `Documents\Feedback test checklist.txt`. Each test proves one checklist item against the real app (API, database, Next.js), driven through the browser.

## Rules

1. **Never change app code to make a test pass.** If the app does not do what the checklist expects, the test stays honest: mark it `test.fail()` with a one-line reason, and log the bug in `e2e/FINDINGS.md` (checklist ID, what happened, what was expected, and steps). Fixing the app is a separate change on its own branch, done only when the user asks.
2. **Name every test after its checklist item.** The title starts with the ID, then the expectation in plain words: `S03.07 Enter sends and Shift+Enter adds a new line`. `S03.07` means section 3, item 7, counting every `[ ]` and `[x]` line in that section from 1. One test per item; a test that needs several items says so in its title (`S08.02+S08.03 …`).
3. **The scripted stub model only.** Tests run with `MODEL_PROVIDER=stub` and no `GOOGLE_API_KEY`. Never point a test at Gemini: it costs money and its wording changes run to run. Assert the stub's fixed wording, or the checklist's gist where the stub matches it.
4. **Ports.** Tests use their own API on 8002 and web on 3100, with their own database (`fd_e2e`). The API's supervisor listens on 127.0.0.1:8012 and restarts it with `MODEL_PROVIDER` stub or none (`restartApi` in `helpers.ts`; only S06.01 and S06.07 use it). Port 8000 belongs to another local app: never use, stop or kill it. Leave 8001 and 3000 alone; they are the hand-testing servers.
5. **One test file at a time** while writing or fixing: `npx playwright test e2e/<file>`. The whole suite runs only at the end of a batch and in the audit.
6. **Every test must be able to fail.** Before calling a test done, remove or invert its key assertion once and confirm it goes red; then restore it. Record that in `e2e/mutations/sNN.json` (the text to break and its replacement, per test ID) and run `npm run test:e2e:mutation -- NN`, which writes the dated result to `e2e/evidence/`.
7. **No sleeps to hide timing.** Wait for something the person would see (`expect(...).toBeVisible()`). A fixed wait is allowed only for a documented clock reason, with a comment.
8. **Set up through the API, check through the screen.** Creating items, approving and moving them may use the API helpers; the expectation being tested is checked on the page, the way a person would see it.
9. **Clean.** No `.only`, no `console.log`, no skipped tests without a reason in the title, no files outside `web/e2e/` except the e2e server and reset scripts in `backend/scripts/`.

## Running

```bash
cd web && npm run test:e2e
```

Playwright starts both servers and recreates the database. While iterating, start them once and add `E2E_REUSE=1` to reuse them.

## Evidence for a release claim

`npm run test:e2e:coverage` writes two generated files: `e2e/COVERAGE.md` (every checklist item, its test and last result) and `docs/testing/feature-evidence.md` (per requirement of Marc's brief, F1 to F18 as numbered in `docs/requirements.md`: how many items have passed, been shown able to fail, and repeated 10 times in a row, with the known bugs). `e2e/requirements.json` says which checklist items back which requirement; every checklist item must back at least one (the generator warns if one does not). Records are in `e2e/evidence/`: `mutation-sNN.json` from `npm run test:e2e:mutation -- NN`, and `stress.json` from the repeat runs (`{ "ran": ISO date, "runs": 10, "passes": { "S03.09": 10 } }`). A mutation record carries the commit it ran on and a fingerprint of its spec file (`e2e/fingerprint.mjs`); once the spec changes, the record is stale and the report stops counting it until the check is run again. Each coverage run also saves `last-run.json` (start time, commit, whether `web/` or `backend/` had uncommitted changes, and the counts), so git history keeps every recorded run; run the coverage straight after the full run so the commit matches. Never edit the generated files or the records by hand.
