# Routing evaluation: run of 2026-10-21

Record of one run of the Sprint 2 routing gate (brief §9) against the live Gemini model. It states what was run, how it was scored, what came out and how far the result can be trusted.

## What it tests

Whether the chat agent sends a staff report to the right place. For each of 40 labelled reports it checks three things on the saved item:

| Measure | Question | Gate |
| --- | --- | --- |
| Project | Did the agent pick the expected tool (project slug, or `general`)? | 85 % |
| Work type | Did it pick the expected type (fix, improvement, new_feature, no_change)? | 85 % |
| Assignee | Did the item reach the expected first assignee, or `needs review`? | 80 % |

A run also fails if any saved item has no developer brief (neither a `problem` nor `open_gaps`).

The model never names an assignee (D1, D2). Code routes by project through routing rules, so the assignee score mostly follows the project score and the seeded rules. It is not a separate measure of the model.

## Method

1. For each item the harness signs in a test person (`eval.staffN@redadair.example`), opens a chat session through the real API, and sends the item's first message.
2. If the agent asks follow-up questions, the harness sends the item's scripted `answers` in order. If it runs out, it replies "That's all I know." twice.
3. When the confirm card appears, the harness confirms it. If no card appears, or nothing saves, the item counts as a miss.
4. The harness reads the saved item from the database and compares project, work type and assignee with the labels.

Code: `backend/evals/run_routing.py`. Labelled set: `backend/evals/routing_set.yaml`.

## Setup for this run

| Item | Value |
| --- | --- |
| Date | 2026-10-21 |
| Model | `gemini-3.1-flash-lite`, AI Studio key from `.env` (not Vertex AI) |
| Code under test | branch `ui/smoke-signal-brand`, including the new agent instruction (Sig) |
| Database | throwaway local Postgres (pgserver, database `feedback_eval`), migrated and seeded with `app.seed`: 5 Digital Staff, 15 projects, routing rules |
| Environment | local only; dev sign-in on; no email sent |
| Runs | one |

The harness needs dev sign-in and a database, so it was started through a small wrapper (kept outside the repo) that set the same environment as `scripts.dev_server`.

## Result

| Measure | Score | Count | Gate |
| --- | --- | --- | --- |
| Project | 97.5 % | 39 / 40 | 85 % |
| Work type | 95.0 % | 38 / 40 | 85 % |
| Assignee | 100 % | 40 / 40 | 80 % |
| Incomplete developer briefs | 0 | | 0 |

Result: PASS.

Misses:

- Project: wanted `flipbook`, got `intranet` for "The intranet home page tile for Flipbook goes to a 404."
- Work type: wanted `improvement`, got `new_feature` for "RAKE answers would be better if they linked to the policy page."
- Work type: wanted `improvement`, got `new_feature` for "It would help if the helpers platform remembered my last question."

### Later runs

| Date | Change under test | Project | Work type | Assignee | Incomplete briefs | Result | Misses |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-26 | Greeting now says Sig is Smoke Signal's AI assistant (`ui/smoke-signal-brand`); same model, setup and wrapper (database `fd_eval`) | 97.5 % (39 / 40) | 100 % (40 / 40) | 100 % (40 / 40) | 0 | PASS | Project: the Flipbook tile item, as above |
| 2026-10-26 | Conversation quality (`fix/agent-conversation-quality`, D60 to D63): what happened before impact, one thing per message, chips that fit; gemini-3.1-flash-lite, a throwaway local database (`feedback_routing`) with dev sign-in | 97.5 % (39 / 40) | 95.0 % (38 / 40) | 100 % (40 / 40) | 0 | PASS | The Flipbook tile item, and the two improvements read as new features, as in the first run |

## The labelled set

- 40 items across 16 projects: 20 fix, 8 no_change, 7 improvement, 5 new_feature.
- Written by the developer on 2026-10-20 as a first draft for Marc to correct and extend. The labels are what a person on the Digital team would expect, but nobody on the Digital team has reviewed them yet.

## How far to trust it

- **Small sample.** 39 of 40 is a point estimate. With 40 items the plausible true project rate is roughly 87 % to 99 %, so the 85 % gate is cleared but not by a wide margin.
- **One run.** The model is not deterministic. The spread between runs is unknown.
- **Not independent.** The set was written by the person who built the agent. Marc's review of the labels is still to happen.
- **Assignee is mostly rules.** See above.
- **Not real traffic.** Messages are short and clean, and every item names its tool. Real reports will be vaguer.
- **Gates are not final.** The 85 / 85 / 80 thresholds are subject to Marc's approval.

## Before this counts as a pass for the gate

1. Marc reviews and extends the labelled set, and approves the thresholds.
2. Repeat the run at least three times and record the spread.
3. Add items that name no tool, name the wrong tool, or mix two problems.
4. Re-run after any change to `backend/agent/instruction.md`, the tools or the model, and record each run here.

## How to repeat

```bash
cd backend
uv run python -m evals.run_routing            # all 40 items, against the model the settings choose
uv run python -m evals.run_routing --limit 5  # a quick check
```

It needs a reachable database and dev sign-in on (`DEV_LOGIN=true`, local environment only). With no `GOOGLE_API_KEY` it uses the scripted stub model, and the scores then show only the keyword baseline.
