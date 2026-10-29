# Feedback: walkthrough for Chris

Goal: show Chris that every item from his review of 28 Oct is built or scheduled, then leave with the access the pilot needs. About 15 minutes of demo, 10 for the asks.

## Before the meeting

- [ ] `main` has D105 and D106 merged, and the full browser run is green on it.
- [ ] Sig's move updates (D105) checked once on Gemini, so the wording Chris reads is the real model's, not the stub's template.
- [ ] The demo runs on Gemini, not the stub, with a fresh seed. Sign in with the local picker (Google sign-in needs ask 2).
- [ ] One dry run of the route below, at desktop and on a phone width (375 px).
- [ ] A small screenshot ready on the clipboard (for paste) and a "fixed" image for Darlene's reply.

## The route (people from the seed)

| # | Who | What to do | What Chris sees | His note |
|---|---|---|---|---|
| 1 | Liam (staff) | Open the chat | Sig's greeting and the app cards, his usual tools first | D99 |
| 2 | Liam | Pick RAKE Agent, describe the problem, paste the screenshot | Sig goes straight to what happened, never asks which tool; a thumbnail with "Check it doesn't show passwords or card numbers" | D99, D95 |
| 3 | Liam | Confirm the card | A reference (FB-…) and who it went to | |
| 4 | Chris (Admin) | Console, Approvals, Approve | The dialog with Instructions for the developer, priority and Due | D93, D94 |
| 5 | Darlene (owner) | Open the item | The instructions pinned at the top ("From Chris, at approval") | D93 |
| 6 | Darlene | Status, then Start work | One Status button listing only the allowed moves; the board and row menu use the same list | D91 |
| 7 | Darlene | Write in the Conversation tab | It starts as Internal note; Message Liam is a deliberate switch, with its own colour; attach the "fixed" image | D96, D95 |
| 8 | Darlene | Status, then Resolve, with a note | Liam is notified | D91 |
| 9 | Liam | Open his tracker | One Conversation, oldest first, Sig's plain words on each move; Is it fixed? | D105, D106, D92 |
| 10 | Liam | I still have an issue, with a screenshot | It reopens to In progress with Darlene, who is told. (Say: if nobody answers, a reminder after 3 days and it closes as Fixed after 7.) | D92 |
| 11 | Aisha (other staff) | Open Liam's item link | General information only: no names, no files, no messages; This affects me too | D97 |

Scheduled, not built: **splitting an item into parts** (D98). It needs a new data model, so it gets its own sprint (Sprint 6), with a design first.

## Since his review

- The tracker is one conversation with the reporter, the owner and the approver, instead of separate update and history boxes (D100 to D105, D106).
- Two things from the 28 Oct console notes are not built and need his view: trimming the dashboard to what the Work section can't show, and removing Channels (D40, open since 23 Oct).

## The asks (in the order they unblock the pilot)

| Ask | What we need | What it unblocks |
|---|---|---|
| 1, 9 | Google Cloud projects for staging and production in australia-southeast1, with developer access; Artifact Registry, Cloud SQL (or databases on the shared instance), private buckets, service accounts with the roles in `docs/architecture.md`, the APIs enabled | Deploying anything at all. The deployment scripts, CI and Cloud Run files are written and waiting |
| 5 | The repo confirmed in the company GitHub org, with branch protection and Marc as reviewer | CI, protected `main`, staging |
| 2 | A Google OAuth client for the redadair.com.au Workspace | Real sign-in (built, untested against Google) |
| 11 | Answers on D31 (PostgreSQL 16 or 17) and D32 (Gmail API or ZeptoMail) | The Cloud SQL instance and the email setup |
| 4 or 10 | Gmail API service account and mailbox, or ZeptoMail with a verified sending domain; the production subdomain in Cloudflare (D35) | Email notifications and the pilot's address |
| 6 | The Digital Staff list with work emails, the triage lead, the IT Admin for access requests | Real routing and owners instead of placeholders |
| 7 | Time with Marc to label the 40-item routing test set | The routing gate on real labels (it passes on the draft labels) |
| 8 | About 15 pilot staff across REDMEN, ADAIR and offshore ops, and the intranet tile slot | The pilot itself |
| 3 | The Gemini key moved into Secret Manager (one exists locally today) | Once ask 1 is done |

If he can only do one thing this week: **asks 1 and 9**. Everything else in the pilot waits on them.
