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

### Third part: D85 to D87 and the faster runner (27 October)

`evals.run_conversations --parallel 4` runs four chats at once (default 1); the full set took about 10 minutes instead of 25 to 30. Cost about A$4.08 (260 calls).

- The 4 cases that were not run or still failing, one at a time on Gemini: typo-go-forms-extention, one-word-bug-staff-admin, two-problems-same-tool and after-card-wrong-tool all passed.
- Full set after D85 to D87: **87 of 89** (81 of 89 before). Backend: Ruff and mypy clean, 133 tests. Browser tests (ports 8032 / 8033 / 3132): 243 passed, 1 skipped by design (S10.09); D87 changed none.
- Still failing: **answers-steps-when-asked-tool** (silent turn on the second message, so no tool chips and no card; Gemini latency, 4 timeouts in the run) and **two-problems-same-tool** (one silent turn; it passed on its own run, so it moves between runs).

### Tool question asked twice (decided: once)

answers-steps-when-asked-tool expects the tool chips twice (answers-impact-when-asked-tool did too, and passes with "once" in the final run), but the instruction says to ask the tool once only. The product owner's steer: don't ignore a non-tool answer, point the person back to the tool, and fall back to their division's usual tool. Tried: take the answer in, then ask the tool once more. answers-impact then passed, but no-tool-page-slow and no-tool-system failed (the judge's rule 1, no question asked twice, applies to them), so 81 of 89 again. Reverted. The product owner decided on 2026-10-27 to keep "ask once"; answers-steps-when-asked-tool stays as the recorded conflict with rule 1, not loosened and not a model fault. The `never_repeat: [which tool]` on answers-steps contradicted its own expected chips; it now says `what happens when you upload` (steps still may not be asked again).

### Silent turns: cause and fix (D88)

The two misses of the 87 run were "Sorry, I lost my train of thought": Gemini returned no words twice in a turn. A diagnostic run (12 chats, 88 model calls, every model call logged without the message text) found the cause. Every silent attempt (17 of 39) was a model call that ended `MAX_TOKENS` with no parts at all: 3.8 Flash thought for 809 to 984 tokens of the 1,024 output cap and had nothing left for the reply or the tool call. `thinking_budget` 0 does not stop 3.8 Flash thinking; Google's docs say Gemini 3 Flash can't turn thinking off and that `thinking_budget` is deprecated for Gemini 3. The retry recovered about half. The timeouts had the same cause: a call that thinks hard takes 8 to 10 s, and two or three of them passed the 20 s limit. Rate limits, lost thought signatures, malformed tool calls and safety blocks were ruled out; running 4 chats at once did not slow the calls. In some chats the model did not think at all, which is why the misses moved between runs. `thinking_level` low alone did not reduce the thinking.

D88: `MODEL_THINKING_LEVEL` low in place of the budget, `MODEL_MAX_OUTPUT_TOKENS` 8,192, `AGENT_TURN_TIMEOUT_SECONDS` 60, thinking counted as output in the cost log (it was left out, so the costs above are under-counted), an empty model reply logged with its reason code, and a silent turn with a report under way and no tool yet asks the tool question. 3 new tests (136 pass).

| Run (after D88) | Result | Empty model replies | Timeouts | Cost |
| --- | --- | --- | --- | --- |
| 1 | 83 of 89 | 0 | 1 | about A$4.46 (242 calls, thinking counted) |
| 2 | 82 of 89 | 0 | 0 | about A$4.42 (240 calls, thinking counted) |

Routing gate after D88: pass, 95.0 % project, 95.0 % work type, 97.5 % assignee, 0 incomplete briefs, the same three misses as before (the Flipbook tile 404 went to `intranet`; "How do I reset my CPD points for the new year?" saved nothing, after one timeout; the helpers platform idea was `new_feature`). Browser tests after D88: 243 passed, 1 skipped by design.

No silent turns are left. The score sits where the earlier runs did (81, 81 and 87 of 89): the misses that remain are the model's choice of question, and most of them failed in earlier runs too.

- answers-impact-when-asked-tool, answers-steps-when-asked-tool (both runs): they expect the tool asked twice; Sig asks it once (product owner, 27 Oct), so these are the recorded conflict.
- real-23-goformz-slow-then-submit-fails (both runs): the card leaves out the opening "so slow".
- pushback-i-just-told-you (both runs): asked which page and since when on turn 1; the case never allows a details question there.
- typo-go-forms-extention (both runs): a timeout in run 1; in run 2 the impact question instead of the card.
- vent-then-useful, impact-stated-cant-work (run 2), answers-question-with-question (run 1): tool chips under a vent, "stopping you" said in sympathy (a forbidden phrase in that case), impact chips under a reworded question.
