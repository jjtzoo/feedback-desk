# Conversation evaluation: run of 2026-10-28 (Sprint 5C, D99 and D95)

Gemini run of branch `claude/app-cards-and-screenshots-a0b4a9`: the chat opens with the app cards and a picked card sets the tool in code (D99), and screenshots are easier to add (D95). Sig's instruction changed in two places: after a card, go straight to what happened and never ask which tool; a screenshot counts as what it shows. The branch is cut from `feat/chris-review-plan`, which does not hold D69 to D88 (other Sig and console branches), so the baseline is the run of 2026-10-27 (51 of 88), not the later Sig work.

## What ran

- Conversation checks: `uv run python -m evals.run_conversations`, 95 cases: the 88 of 2026-10-27 plus 7 new ones for D99 in `backend/evals/conversation_set.yaml`. A message written `{pick: <slug>}` picks that card (`POST /chat/sessions/{id}/tool`); a case's `project` opens the chat as `/chat?project=` does.
- Routing gate: `evals.run_routing` on the 40-item set, in a fresh local database of its own (`feedback_routing`).
- Both ran at the same time against the same AI Studio key, which made some turns time out (8 in the conversation run, 7 in the routing run); the cases those turns hit were run again on their own (below).

## Results

| Run | Model | Result | Cost |
| --- | --- | --- | --- |
| Conversation checks | gemini-3.8-flash | 54 of 95 in the full run, 57 of 95 with the timed-out cases run again; all 7 new D99 cases pass | about A$3.24 (237 calls) in the full run |
| Routing gate | gemini-3.8-flash | Pass: 90.0 % project, 90.0 % work type, 92.5 % assignee, every brief complete | not logged by the runner |

### The new D99 cases

| Case | What it checks | Result |
| --- | --- | --- |
| card-pick-asks-what-happened | A card alone: Sig asks what's going on, names the tool, no chips, no tool question | ok |
| card-pick-then-describe | Card, then a slow search: card with IT Asset, never which tool | ok |
| card-pick-idea | Card, then an idea: card with CPD Tracker | ok |
| card-pick-then-chat | Card, then a question about Sig: chat, no card | ok |
| typed-first-then-card | A question first (D64), then a card, then the problem | ok |
| project-link | `?project=training-portal`: never asks which tool | ok |
| project-link-other-tool | `?project=it-asset`, then "Actually this is about RAKE": the card says RAKE Agent | ok |

### Against the run of 2026-10-27

Now passing: one-word-slow-afss-yes, real-15-chips-match-tool-question, real-16-already-said-slow, vent-with-no-target.

Newly failing: five got no reply at all, the turns that timed out (no-tool-system, pushback-stop-asking-just-send-it, question, swearing-lost-work, vague-doesnt-work); three are the card arriving later than the case allows, the main failure of 27 Oct (answers-question-with-question, assign-to-person, lol-in-a-serious-report). None of the eight picks a card or opens with `?project=`.

### Routing misses

- "The intranet home page tile for Flipbook goes to a 404" went to `intranet` (labelled `flipbook`), as on 26 and 27 Oct.
- "Please add a filter by site to the IT Asset list" was `improvement` (labelled `new_feature`), as on 27 Oct.
- Three items saved nothing ("Need a login for the Training Portal for our new starter", "How do I reset my CPD points for the new year?", "Where can I find the brochure templates in Flipbook?"): the timed-out turns.

### The eight run again on their own

- Pass: no-tool-system, pushback-stop-asking-just-send-it, vague-doesnt-work (their failures were the timeouts).
- Still failing, the two faults of 27 Oct: an empty reply, a silent turn (lol-in-a-serious-report, question), which D85 and D88 address on a branch not in this base; and the card arriving later than the case allows (answers-question-with-question, assign-to-person, swearing-lost-work), which D63 and D87 address.

So the conversation checks don't pass yet, as on 27 Oct, and the gaps are the ones already known; the app cards add none. They should be run again once this branch and the D69 to D88 work are merged together.
