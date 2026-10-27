# Conversation evaluation: run of 2026-10-27

First run on Gemini of branch `fix/sig-conversation` (D60 to D68): Sig chats first (D64), the page follows `next_step` (D65), impact is read from what was said (D66), the model is `gemini-3.8-flash` (D67), and 50 cases written apart from the build try to break it (D68). Run before merging the branch into `main`.

## What ran

- Conversation checks: `uv run python -m evals.run_conversations`, 88 cases (38 in `backend/evals/conversation_set.yaml`, 50 in `conversation_cases_real.yaml`), each judged on every reply.
- Routing gate: `evals.run_routing` on the 40-item set, in a fresh local database of its own (`feedback_routing`), so no eval items reach the developer's local database.
- Everything else on the branch: ruff, mypy, 121 backend tests, the web build, 242 browser tests passed (1 skipped by design: S10.09 needs Docker's Mailpit).

## Results

| Run | Model | Result | Cost |
| --- | --- | --- | --- |
| Conversation checks | gemini-3.8-flash | 51 of 88 | about A$2.96 (216 calls) |
| Routing gate | gemini-3.8-flash | Pass: 92.5 % project, 90.0 % work type, 95.0 % assignee, every brief complete | not logged by the runner |
| Conversation checks (same 88 cases) | gemini-3.1-flash-lite | 34 of 88 | about A$1.01 (run on `main` for review item 17; same cases, old instruction) |
| Conversation checks, `fix/sig-27oct-review` run 1 | gemini-3.8-flash | 76 of 89 | not logged |
| Conversation checks, `fix/sig-27oct-review` run 3 (final) | gemini-3.8-flash | **81 of 89** (91 %) | about A$4.09 (261 calls) |
| Routing gate, `fix/sig-27oct-review` | gemini-3.8-flash | Pass: 95.0 % project, 95.0 % work type, 97.5 % assignee, every brief complete | not logged by the runner |

`MODEL_THINKING_BUDGET` 0 is accepted by 3.8 Flash (D67 open point 3): every call ran with it.

### Routing misses (3.8 Flash)

- "The intranet home page tile for Flipbook goes to a 404" went to `intranet` (labelled `flipbook`), as on 2026-10-26.
- "Please add a filter by site to the IT Asset list" was `improvement` (labelled `new_feature`); "It would help if the helpers platform remembered my last question" was `new_feature` (labelled `improvement`).
- Two items saved nothing: "The Financial Platform expense form could be faster to fill" and "Please give me access to the ADAIR EPM Portal". Two agent turns timed out in the run.
- On 3.1 Flash-Lite with the old instruction the set scored 97.5 / 97.5 / 100 (2026-10-26).

### Conversation failures (3.8 Flash), by what the judge saw

| Count | What went wrong |
| --- | --- |
| 29 | No confirm card by the end of the scripted chat |
| 27 | A turn where the card was expected showed none (Sig asked for more detail instead) |
| 5 | Asked the impact question again |
| 3 + 3 | Asked the tool or the impact when this chat had already said it |
| 4 | Expected the tool chips, got none |
| 3 + 1 + 1 | Impact or project chips under a question they don't fit |
| 2 | New chips after the card |
| 1 | An empty reply (`access-new-starter`) |

The 37 failing cases: no-tool-page-slow, access, real-15-chips-match-tool-question, real-16-already-said-slow, sig-real-person-then-real-issue, sig-rake-difference-then-rake-bug, sig-can-you-fix-it, pushback-i-just-told-you, pushback-card-got-it-wrong, switch-to-a-question-and-back, switch-to-small-talk-and-back, answers-impact-when-asked-tool, answers-steps-when-asked-tool, typo-rake-rgent, typo-heavy-training-portal, typo-go-forms-extention, typo-afs-portl-down, one-word-slow-afss-yes, one-word-bug-staff-admin, two-problems-two-tools, two-problems-same-tool, praise-and-problem-together, sarcasm-love-that-for-me, sarcasm-wonderful-update, sarcasm-at-sig, vent-with-no-target, vent-then-useful, lol-yes-confirms, after-card-raise-impact, after-card-wrong-tool, after-card-never-mind, after-card-add-detail, impact-stated-painfully-slow, impact-stated-cant-work, impact-stated-not-urgent, access-new-starter, praise-afss-export.

## Reading

Most failures are the card arriving later than the scripted chat allows: D63's minimum (which screen or action, what they saw, since when) makes Sig keep asking where the cases give one answer and expect the card. Part of that is the cases predating D63, part is Sig asking more than "at most 3 questions" and the product owner's balance (review item 20, 27 Oct: task focused, no question that doesn't add to the brief). The rest are real conversation faults that the product owner also met by hand on 27 Oct: repeated questions after pushback, questions already answered, chips that don't fit, one empty reply.

The model stays 3.8 Flash (product owner, 27 Oct): the failures point at the instruction and the cases, not the model. The same 88 cases on 3.1 Flash-Lite are recorded by the next Sig session for comparison (review item 17).

The branch is merged anyway: every test that does not depend on the model passes, the routing gate passes, and `main` has none of these checks. Getting the conversation checks to at least 80 of 88 on Gemini is the first job of the next Sig session (`fix/sig-27oct-review`).

## Second Sig session: `fix/sig-27oct-review` (27 October)

Review items 20 to 23, 26, 34 and 37 built as D69 to D74 (balance and one question before the card, impact in the chips' words with a Something else chip, a later different problem asked about, brief lists without the model's numbers, the duplicate check remembering fixes, the recommendation written last), plus: the API retries a silent model turn once and never sends an empty reply, a typo'd tool name counts as named, and `evals.run_routing` uses its own database. The GoFormz chat is a case (`asks_details`, `keeps`). 17 cases written before item 23 got one answer added (marked `revised:` in the YAML); no case was loosened.

### Conversation checks

The cases went from 88 to 89 (the GoFormz chat). Run 1 scored 76 of 89. Run 2 never finished: its throwaway Postgres died part way (process exception 0xC0000142), so it is not counted. Run 3, after the retry and typo fixes: **81 of 89**, above the 80 of 88 goal.

The 8 that still fail, by what the judge saw:

| Case | What went wrong |
| --- | --- |
| real-23-goformz-slow-then-submit-fails | Asked the tool, then screen, then "same issue or a second one?"; two silent turns ("lost my train of thought"); no card |
| answers-impact-when-asked-tool | No tool chips under the tool question (turn 2) |
| answers-steps-when-asked-tool | No tool chips; one silent turn; no card |
| pushback-i-just-told-you | Asked "since when" in a chat that must never ask it |
| typo-go-forms-extention | Kept asking what it does when it breaks; no card |
| one-word-bug-staff-admin | Card expected on turn 4, none; Sig told them to press Confirm that was not there |
| two-problems-same-tool | One silent turn; no card |
| after-card-wrong-tool | Asked for an error message instead of the card; two silent turns; no card |

Five agent turns timed out at the 20 s limit in this run. Of the 8 failures, 5 include a silent or timed-out turn (the model said nothing even after the retry), so they are mostly Gemini latency, not instruction faults; they moved between runs (run 1 had others). The rest are the model asking one question more than the case allows or not showing chips. These are left as they are, not loosened.

### Routing gate

Pass: 95.0 % project, 95.0 % work type, 97.5 % assignee, 0 incomplete briefs (gate 85 / 85 / 80). Two agent turns timed out. Misses: the Flipbook tile 404 went to `intranet`; "How do I reset my CPD points for the new year?" saved nothing; "It would help if the helpers platform remembered my last question" was `new_feature` (labelled `improvement`).

### Everything else on the branch

- Backend: Ruff clean, mypy strict clean (51 files), 128 tests pass.
- Web: production build passes.
- Browser tests on the stub model (ports 8032 / 8033 / 3132): 243 passed, 1 skipped by design (S10.09 needs Docker's Mailpit). No app code was changed to make a test pass.
- Mutation record for section 3 (`npm run test:e2e:mutation -- 03`): all 22 broken tests failed as they should (`web/e2e/evidence/mutation-s03.json`).
