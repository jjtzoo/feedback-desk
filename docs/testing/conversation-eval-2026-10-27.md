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
