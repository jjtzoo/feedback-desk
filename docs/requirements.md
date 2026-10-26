# 2026-40 Feedback Desk: requirements reference

An index of what the app must do. It does not restate the spec; each row points to where the requirement and its acceptance test live in [feedback-build-spec-v3.md](feedback-build-spec-v3.md) (the source of truth). Where the spec and Marc's brief disagree, the brief wins. If a requirement changes, change the spec first, then this index.

## Functional requirements

| ID | Requirement | Sprint | Spec |
| --- | --- | --- | --- |
| F1 | Google sign-in limited to redadair.com.au, with Staff, Digital Staff and Admin roles checked server-side | 1 | MVP scope, D1 |
| F2 | Admin page for projects, Digital Staff and routing rules | 1 | MVP scope |
| F3 | Staff chatbot: free text, at most 3 follow-up questions, confirm card, FB reference | 2 | MVP scope, D12 |
| F4 | Attachments: PDF, Word, Excel, PNG, JPG, WEBP; 10 MB each, 5 per item; macro files rejected | 2 | MVP scope, D10 |
| F5 | Automatic context captured with each submission | 2 | MVP scope |
| F6 | Triage and routing: the model classifies, code assigns the person | 2 | MVP scope, D2, Assignment rules |
| F7 | Developer brief on every item | 2 | MVP scope, Developer brief |
| F8 | Duplicate detection, never auto-merged | 2 | MVP scope, Duplicate detection |
| F9 | My feedback list | 2 | MVP scope |
| F10 | Backup form when the model fails | 2 | MVP scope |
| F11 | Management console: board, list, cards, detail panel | 3 | MVP scope |
| F12 | Approvals: approve, decline or ask for info before work starts | 3 | MVP scope, D3 |
| F13 | Parcel-style staff tracker, five stages | 3 | MVP scope, Feedback lifecycle |
| F14 | Notifications in the app and by email | 3 | MVP scope, D11 |
| F15 | Private project channels for Digital Staff | 3 | MVP scope |
| F16 | Dashboard and daily digest (first to slip) | 3 | MVP scope, D14 |
| F17 | Friday releases and Fixes and updates (second to slip) | 4 | MVP scope |
| F18 | Launch: production, 3-day pilot of about 15 staff, intranet tile, guides | 4 | MVP scope |

## Non-functional requirements

Authentication, authorisation, data residency (australia-southeast1), performance, availability, audit, privacy, secrets, cost (under AUD 0.05 per item, spend guards in D36), accessibility and observability: spec section "Non-functional requirements".

## Quality gates

| Gate | Target |
| --- | --- |
| Routing on the 40-item set | 85 % project, 85 % work type, 80 % assignee |
| Sprint gates | Signed by Marc and Chris: design review, routing, UAT, go-live |
| Definition of Done | Spec section "Definition of Done" |

## Out of scope

SLAs and escalation, anonymous feedback, native apps, external clients, Smartsheet integration, an embedded widget, a calendar view, answering "how do I" questions: spec section "Out of scope for the MVP".

## Constraints

Company standards and where they bind this project: D24 to D35 and [standards/](standards/). Open decisions: D31, D32, D35, D37.
