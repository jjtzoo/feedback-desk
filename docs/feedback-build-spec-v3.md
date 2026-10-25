# Feedback v3: staff feedback agent and management system for REDADAIR

A chat-style agent where any REDADAIR staff member gives feedback on any platform or agent on the intranet, plus a lightweight console where Digital Staff triage it, post progress and close it. Staff track every item the way they'd track a parcel. The agent does the admin work: it works out which project the feedback is about, classifies it, sets a priority, writes a developer brief and hands it to code that assigns the right owner. An Admin approves or declines each item before anyone works on it.

Revised 2026-10-20 from v2 (`feedback-desk-build-spec-v2.md`, 2026-10-19) to follow the team lead's project brief (`Feedback-Project-Brief`, Marc, 2026-10-19) and the company's engineering standards (`Developer Handover and Technical User Manual` and `Application Deployment and Infrastructure Manual`, Darlene; digests in `docs/standards/`). Where this file and the brief disagree, the brief wins; where the brief is silent, the manual applies. Tell Marc about any conflict. **One developer, four one-week sprints to company-wide launch, a working demo every Friday, and a sign-off gate at the end of each week.**

Items marked **PROPOSED** are the developer's suggestions that Marc has not confirmed. Items marked **OPEN** need an answer from Marc or Chris before the sprint that uses them. Move answers into the Decisions table.

## How to build from this file

1. Read the file to the end before writing code. Build only what is here. Architecture or scope changes go to Marc as a short written proposal (a comment on the brief) before building, and are recorded in the Decisions table.
2. Run the local stack first: `docker compose up` must give a healthy API and database before any story starts.
3. Build the backend before the screens for each story. Every screen calls the API; no screen talks to the database or the model directly. Roles are checked in the API on every call, never only hidden in the UI.
4. Work sprint by sprint, story by story, in the order listed in "Sprint plan". A story is done only when every "Done when" line passes and the Definition of Done holds.
5. A sprint ends with its gate. Marc and Chris sign off before the next sprint starts. A story not done goes to the top of the next sprint, or to phase 2 in the agreed slip order (see "Sprint plan").
6. Any change to the agent's instruction, tools or schema must pass the labelled test set before merge.
7. Every PR is reviewed by Marc before it merges to `main` in the company GitHub org.
8. Raise blockers the same day. Post a weekly update (template at the end) before the Friday demo.

## Product

**Problem.** Feedback on our tools arrives through Teams messages, emails and hallway conversations. Nothing is tracked, the same issue is reported several times, staff never hear back, and there is no data on which tools work and which don't.

**MVP goal.** Staff use Feedback instead of messaging IT directly, and the agent routes most feedback correctly without a human touching it.

**Deliberately not a ticketing system.** Feedback only: no SLAs, no escalation chains, no customer-facing tickets. Keep it simple; grow it later.

**People.** Marc (Team Lead AI Engineer) guides the build day to day and reviews every PR. Chris (IT Director) is the sponsor and co-signs every gate. Mike (Managing Director), Chris or Marc approves or declines each piece of feedback.

### Success measures (first 60 days after launch)

| Measure | Target | How it is measured |
| --- | --- | --- |
| Feedback through the agent vs side channels | 80 % or more | Weekly count vs feedback seen in Teams and email (manual tally) |
| Correct project identified by the agent | 90 % or more | 1 minus the project reassignment rate, from `feedback_events` |
| Correct assignee on first try | 80 % or more | Items never reassigned after routing |
| Time from submission to first Digital Staff response | Under 2 business days | `first_response_at` minus `created_at` |
| Staff completing a feedback conversation | Under 2 minutes median | First message to submit, per session |
| Duplicate feedback auto-linked | 70 % or more of true duplicates | Merges suggested by the agent vs all merges |

### Users and roles

Everyone signs in with Google OAuth using their redadair.com.au Google Workspace account. No one outside the domain gets in, and there is no anonymous feedback.

| Role | Who | Can do |
| --- | --- | --- |
| Staff | Every REDADAIR employee (REDMEN, ADAIR, offshore ops) | Give feedback, see their own submissions and replies, add follow-ups |
| Digital Staff | IT / Digital team members | See all feedback, work assigned items, reassign, change status, add notes, reply |
| Admin | Marc, Chris and Mike | Everything above, plus approve or decline feedback, and manage projects, owners, routing rules and users |

The role comes from the `digital_staff` table; anyone not in it is Staff. The triage lead receives Needs review items and the daily digest; the IT Admin receives access requests (interim names in D20).

### Project catalogue at launch

Seeded from the brief, then edited on the admin page. The project list lives in the database, never hard-coded in the prompt; a new intranet tool is one form entry away from being recognised.

| Group | Project | Primary owner |
| --- | --- | --- |
| Platforms | IT Asset | Darlene |
| Platforms | Staff Admin Portal | Marc |
| Platforms | Training Portal | Marc |
| Platforms | CPD Tracker | Mario |
| Platforms | Financial Platform | Mario |
| Platforms | REDADAIR Workflow Atlas | Darlene |
| Platforms | ADAIR EPM Portal | Mario |
| Platforms | Flipbook | Marc |
| Platforms | FPOWS Portal | Marc |
| Platforms | AFSS Portal | Darlene |
| Platforms | GoFormz Extension Portal | Marc |
| Agents | Agents Platform (REDADAIR Helpers) | Marc |
| Agents | RAKE Agent | Darlene |
| Agents | Fire Safety Blog Agent | Darlene |
| Other | Intranet site itself | Marc |

The agent can also answer `general` when nothing fits; general items go to Needs review.

## MVP scope

| ID | Feature | Sprint | What it does | Accepted when |
| --- | --- | --- | --- | --- |
| F1 | Google sign-in and roles | 1 | Google OAuth limited to redadair.com.au; Staff, Digital Staff and Admin areas. | A Digital Staff user and a Staff user see different areas; a non-redadair account is refused; the domain (`hd` claim) and role are checked server-side on every request. |
| F2 | Admin page | 1 | Manage projects (name, description, keywords, aliases, owner, group, active), Digital Staff (skills, away, active) and routing rules. | Only Admins see it; a new project is recognised by the agent without a deploy. |
| F3 | Staff chatbot | 2 | Free-text chat with a friendly Aussie tone like RAKE; at most 3 follow-up questions; quick-pick chips; a confirm card; a reference (FB-0142) and who it went to. Deep link `?project=rake-agent` preselects a project. | No forms first; at most 3 questions; nothing saved without confirm; the reply names the assignee. |
| F4 | Attachments | 2 | PDF, Word (.docx), Excel (.xlsx), PNG, JPG and WEBP; max 10 MB each, up to 5 per item. The agent reads them to classify. | Every file type uploads and informs classification; type checked by content; macro-enabled files (.docm, .xlsm) rejected. |
| F5 | Automatic context | 2 | Browser, device, screen size, the app or page they came from, and time, captured with each submission. | Staff never type it; it appears in the developer brief. |
| F6 | Triage and routing | 2 | The agent returns a validated classification; code picks the assignee (rules in "Assignment rules"). | The model never names an assignee; 85 % correct project, 85 % correct work type, 80 % correct assignee on the 40-item test set. |
| F7 | Developer brief | 2 | Every item gets a brief a developer can start from (sections in "Developer brief"). | Every test item has a complete brief or lists its open gaps. |
| F8 | Duplicate detection | 2 | Embedding similarity against open items in the same project; the agent offers "+1 and comment". | Linking needs the user's yes; Digital Staff make the final merge call; the agent never auto-merges. |
| F9 | My feedback | 2 | A list of the user's submissions with the current stage of each; each opens its tracker. | Lists only the signed-in user's items. |
| F10 | Backup form | 2 | If the model fails or times out, the chat falls back to a simple form so feedback is never lost. | A model outage still lets a user submit; the item lands in Needs review. |
| F11 | Management console | 3 | Board (default), List and Cards views; inbox filters; filters and search; a detail panel with the brief, classification, duplicates, attachments, transcript and history; all actions. | Moving a card changes its stage; every manual change is in `feedback_events`; the view choice is remembered per user. |
| F12 | Approvals | 3 | Admins approve, decline (reason required) or ask for info, from an Approvals view and an Admin-only board column. | One decision from any Admin moves the item on; nobody can start an item that isn't approved. |
| F13 | Staff tracker | 3 | Parcel-style page: status header with Expected by, a five-stage stepper, who has it, the latest update, full history, and Reply or add details. | Staff see every public stage and update; internal notes never show; a reply on a Resolved item reopens it. |
| F14 | Notifications | 3 | In-app bell (live over SSE, 30-second polling fallback) plus email for the same event. Per-item mute. | Every stage change, update and reply notifies the submitter in the app and by email; notifications are kept 90 days. |
| F15 | Project channels | 3 | A private channel per project for Digital Staff, with @mentions, #FB links, pinned notes and files. | Staff never see channel content. |
| F16 | Dashboard and daily digest | 3 (first to slip) | Open items per project, assignee and category; weekly trend; time to first response; a daily digest of stale Needs review items. | Numbers match `feedback` and `feedback_events`. |
| F17 | Friday releases | 4 (second to slip) | The agent drafts a release per active project every Friday 9:00 AEST; the owner ticks, edits and publishes; staff see a What's new page. | Nothing publishes automatically; channel items start unticked; contributors are notified. |
| F18 | Launch | 4 | Production on Google Cloud, a 3-day pilot with about 15 staff, the intranet tile, a staff guide and a console runbook. | Pilot complete, no P1 bugs open, Marc and Chris sign off UAT, tile live. |

### Out of scope for the MVP

| Item | Why not now |
| --- | --- |
| SLAs, escalation tiers, time tracking | Feedback, not a helpdesk |
| Anonymous feedback | Every submission is tied to a Google sign-in |
| Native iOS or Android apps | The web app works in phone browsers |
| Feedback from external clients or field contractors | Staff only |
| Smartsheet integration | Later phase |
| Embedding a feedback widget inside each app | Phase 2 candidate; the `?project=` deep link prepares for it |
| Calendar view in the console | Phase 2 candidate |
| Agent answering "how do I" questions from documents | Logged as feedback; policy questions are pointed to RAKE |

## Decisions

| ID | Decision | Why | Replaces (v2) |
| --- | --- | --- | --- |
| D1 | Everyone signs in with Google OAuth, redadair.com.au only; the `hd` claim and the role are checked server-side on every request. No local passwords, no anonymous use. | Brief §3, §8. | v2 D3 (staff magic links), D4 (anonymous users, tracking tokens), D22 (My concerns email link) |
| D2 | The model proposes project and category; deterministic code assigns the person. The model never invents an assignee. | Brief §5. | v2 D14 (no auto-assignment, shared pick-up queue) |
| D3 | Nothing is worked on until an Admin (Mike, Chris or Marc) approves it. One decision is enough. Praise and duplicates merged into an approved item need no approval. | Brief §4.5. | New |
| D4 | Nine internal statuses mapped to five tracker stages (see "Feedback lifecycle"). | Brief §4.2, §6. | v2 statuses new / in_progress / resolved |
| D5 | Classification fields and values as in "Classification schema": work type (fix, improvement, new feature, no change), category (8 values), priority P1 to P4, impact, effort, recommendation, confidence per field. | Brief §5.1. | v2 D5 (six topics, high/medium/low urgency) |
| D6 | References are `FB-` plus a zero-padded sequence (FB-0001). | Brief §4.1. | v2 `FD-` |
| D7 | Agent: Google ADK, one agent with tools, in its own package separate from the FastAPI routes. Local: `adk web` and in-process. Production: Vertex AI Agent Engine. | Brief §7. | v2 D9 (API and agent in one process) |
| D8 | Model: Gemini Flash through a Google AI Studio API key for now; try Pro only if routing misses the week 2 targets. Moving to Vertex AI must be a config change, not a code change. Until the key arrives the stub model keeps development moving (development and test only). | Brief §7; v2 D23, D24 already built this switch. | v2 D13 |
| D9 | Production on Google Cloud in australia-southeast1: web app and API on Cloud Run, agent on Agent Engine, Cloud SQL for PostgreSQL 16 + pgvector, a private Cloud Storage bucket, Secret Manager. Local: Docker Desktop with the pgvector image. The connection string comes from config. | Brief §7, §8. | v2 D10, D15 |
| D10 | Attachments in a private bucket, served by 15-minute signed URLs. PDFs and images go to Gemini directly; Word and Excel are converted to text on upload (python-docx, openpyxl) and saved in `extracted_text`. | Brief §4.1, §7. | v2 out of scope |
| D11 | Notifications in the app (SSE, 30-second polling fallback) and by email for the same event. Email goes through the Gmail API with a service account; Cloud Scheduler triggers the daily digest and the Friday drafter. | Brief §4.6, §7. | v2 D16, D17 (SMTP, outgoing only) |
| D12 | The confirm card guard stays: the user confirms the summary before anything is saved, and the save tool reads the confirmed draft from session state, not from model arguments. | Kept from v2 D12; brief §4.1 step 6. | |
| D13 | Secrets only in Secret Manager, including the AI Studio key. No keys in code, env files or the repo. | Brief §8. | v2 `.env` for secrets |
| D14 | Four one-week sprints, one per brief phase, each ending in a gate signed by Marc and Chris. If time slips: the dashboard and daily digest move to phase 2 first, then AI drafting of releases. Routing quality and attachments never slip. | Brief §9. | v2 D18 (one 5-day MVP sprint) |
| D15 | The product is called Feedback, opened from a Feedback tile on the intranet home page, at its own address. (D37, open, proposes the name Smoke Signal for the product; the tile keeps the word Feedback.) | Brief §1, §4.1. | v2 D8 (name "Feedback Desk") |
| D16 | Frontend: Next.js (App Router) + React + TypeScript + Tailwind + shadcn/ui, one app with two areas: `/` for staff and `/console` for Digital Staff. It runs on Cloud Run and forwards `/api` to the FastAPI service. Both the brief and the handover manual name Next.js; the manual also names shadcn/ui for components and icons. Decided 2026-10-20, replacing the v2 Vite app. | Brief §7; manual §2, §4, §28. | v2 stack (React + Vite) |
| D17 | Visual direction: modern and red-led. The staff landing page uses mockup D (red hero band); the tracker, My feedback and the console use E (charcoal header with red highlights). Plus Jakarta Sans, sentence case, soft-shadow cards, red #D0101B as the one brand colour. Decided on 2026-10-20; show leadership before the pilot. Motion raised to an Apple-style level (spring entrances, press and lift, one calm avatar idle loop; reduced-motion honoured) on 2026-10-20: tell Marc. | Owner's feedback on 2026-10-20: red matters to leadership, the UI must feel current. | v2 D6 (Signal Red, condensed uppercase) |
| D18 | Local development email: Mailpit behind the same email interface as the Gmail API sender, so nothing reaches real inboxes before go-live. Decided 2026-10-20. | Keeps every email readable in tests. | |
| D19 | Local development secrets: the AI Studio key is read from Secret Manager (`gcloud auth application-default login`) once ask 1 lands; until then development runs on the stub model and needs no key. A git-ignored `.env` holds only non-secret settings. Decided 2026-10-20. | Brief §8. | |
| D20 | Interim roles until Chris names them: Marc is the triage lead; access requests route to Chris. Decided 2026-10-20; replace in the admin page when named. | Router needs both. | |
| D21 | Won't fix is a close reason on Declined, not a tenth status. Decided 2026-10-20. | Matches the brief's nine-state lifecycle. | |
| D22 | The agent keeps a fourth tool, `update_draft`, beside the brief's three; it is what stops the model saving anything the user didn't confirm (D12). Decided 2026-10-20; tell Marc. | Safety guard. | |
| D23 | Until asks 1, 2 and 4 land, local stand-ins sit behind the same interfaces: a development-only sign-in picker beside the Google OAuth flow, a local folder for files instead of Cloud Storage, Mailpit instead of the Gmail API, and the stub model and stub embeddings instead of Gemini. Each switches by config. Decided 2026-10-20. | Build everything now; plug the real services in later. | v2 D23 |
| D24 | Follow the company engineering standard (Darlene's handover manual) for everything outside the brief: Git branches for every change, a README, CLAUDE.md and `docs/architecture.md` kept current, `.gitignore` and `.gcloudignore`, Cloud Run service YAML per environment, `deploy.sh` and `deploy.ps1`, `.env.example`, a generated `requirements.txt`, environment separation, a deployment review checklist, protected secrets in builds and logs, and periodic cloud cost reviews. | Manual §6 to §38. | New |
| D25 | Three environments: local, staging and production, each with its own database, Cloud Run services, storage and secrets. Local development uses staging configuration, never production. The brief's "dev" environment is the staging environment. | Manual §18, §19; brief §7. | v2 local + prod |
| D26 | Backend stays Python (FastAPI, Google ADK, SQLAlchemy and Alembic) as the brief sets it; the manual's Prisma and Node.js backend do not apply. Redis is not used: in-app notifications poll Postgres and the worker queues in Postgres. Production database access for inspection is through the Cloud SQL Auth Proxy, after confirming the environment. **Tell Marc and Darlene** so the manual's stack list can note this project's differences. | Brief §7 vs manual §2. | |
| D27 | Company code, documents, configuration and credentials live only in the company GitHub organisation and company-approved storage, never in personal or private repositories. No access yet means ask for it, not a workaround. | Deployment manual §2. | |
| D28 | Branches: work happens on short-lived branches cut from `main`; once they exist, `staging` deploys to staging and `main` deploys to production by manual approval after staging is verified. Until then (deviation 6) `main` is the working branch and nothing deploys from it. | Deployment manual §2, §10; handover manual §8. | |
| D29 | Cloud Run in australia-southeast1, one service per app per environment (`feedback-api-staging`, `feedback-web-staging`, `feedback-api-production`, `feedback-web-production`), request-based billing, min 0 and max 1 instances, 1 CPU, 512 MiB for web and 1 GiB for the API (AI calls and Word/Excel parsing; to be confirmed by load testing), 300-second request timeout for streamed chat. Max 1 instance also keeps the in-process rate limiter correct; revisit both if traffic grows. Production deploys create a no-traffic `candidate` revision, are checked, then take traffic; rollback moves traffic back to the previous revision. | Deployment manual §8 to §15. | |
| D30 | Images in Artifact Registry `australia-southeast1-docker.pkg.dev/<project>/feedback/` named `feedback-api` and `feedback-web`, tagged `<environment>-<git sha>`. Every resource carries labels `project=feedback`, `environment`, `application`, `owner=digital-team`, `purpose`, `deployment-type`. | Deployment manual §5 to §7. | |
| D31 | Database version: **OPEN.** The brief says PostgreSQL 16; the company Cloud SQL standard is PostgreSQL 17.9 in australia-southeast1. **PROPOSED:** PostgreSQL 17 everywhere (`pgvector/pgvector:pg17` locally), separate staging and production databases. Marc to confirm. | Deployment manual §17 to §19 vs brief §7. | D9 (part) |
| D32 | Transactional email: **OPEN.** The brief says the Gmail API; the company standard is ZeptoMail (Zoho). Both are built behind one setting: `EMAIL_BACKEND=smtp` with ZeptoMail's SMTP service, or `EMAIL_BACKEND=gmail`. Sender `noreply@` the approved domain. **PROPOSED:** ZeptoMail, for its delivery monitoring. Marc to confirm. | Deployment manual §40 to §44 vs brief §7. | D11 (part) |
| D33 | Background work runs as a Cloud Run **job** (`feedback-worker-<env>`, `python -m app.worker --once`) that Cloud Scheduler starts every minute: it sends due emails, runs the daily digest and Friday drafter when their slot comes, and embeds open items whose embedding is missing or from another model (a failed call, a model change), a batch of 20 a run, so duplicate search finds them. It has the model key for that, and skips it when the chosen model is unreachable rather than fall back to stub embeddings. With min 0 instances a loop in a service would not keep running. Locally the worker loops. | Deployment manual §8, §16. | |
| D34 | Not used by this project: RAG Engine, Cloud Spanner, MCP servers, Redis. Duplicate search uses pgvector in Cloud SQL (D26). Documented so nobody provisions them by default. | Deployment manual §20 to §31. | |
| D35 | Production domain: a subdomain such as `feedback.redadair.com.au`, mapped to the production web service through Cloud Run domain mapping and Cloudflare DNS. **OPEN:** the name, with Chris. Staging never gets the production domain. | Deployment manual §37 to §39. | |
| D36 | Model spend guards. Every model call writes a `model_usage` row (tokens from Gemini's counts; embeddings estimated at four characters a token; cost in AUD from the configured prices; no message text). Limits, all configurable and 0 to switch off: `DAILY_TOKENS_PER_USER` (300,000), `DAILY_BUDGET_AUD` (5.00), `MONTHLY_BUDGET_AUD` (60.00), days and months in Australia/Sydney. Limits are checked only when a chat starts: a chat in progress always finishes, and over a limit a new chat opens the backup form with a notice, so the app never stops taking feedback. **OPEN:** the manual test checklist (S22.05) expects the opposite: a limit reached mid-chat hands over to the backup form with the typed text kept. Marc to decide which; until then browser test S22.05 is marked a known bug (`web/e2e/FINDINGS.md`). Each model call is capped (`MODEL_MAX_OUTPUT_TOKENS` 1,024, `MODEL_THINKING_BUDGET` 0). Model: **PROPOSED** `gemini-3.1-flash-lite`, the cheapest Gemini model open to new keys (USD 0.25 / 1.50 per million tokens; 2.5 Flash-Lite is closed to new users); on the 40-item routing set it scored 97.5 % project, 97.5 % work type, 100 % assignee at about AUD 0.010 per item. The brief names Gemini Flash; `gemini-2.5-flash` stays the fallback by config. Marc to confirm. Staff see their allowance under the chat; the console dashboard shows spend against the budgets, cost per item (brief target under AUD 0.05) and, for Admins, the top users today. Decided 2026-10-21 at the developer's request when the AI Studio key arrived; **PROPOSED** limits, Marc to confirm. | Brief §8 (cost per item). | |
| D37 | Brand and chat assistant: **OPEN.** **PROPOSED:** call the product Smoke Signal: feedback, good or bad, is the smoke staff send up. The logo is "Puff", a puff of smoke shaped like a speech bubble. The chat assistant is "Sig", a smart fire extinguisher with a screen face that deals with problems while they are still smoke, before they spread. Picked for a group-wide rollout: it is the group's own kit, it can't be mistaken for a real brigade or a person, it has flat and 3D versions, and it is clearly an AI. Flat artwork in the product, 3D only for large moments. The intranet tile keeps the word Feedback (D15). Assets in `web/public/brand/`; implementation plan in `docs/design/smoke-signal-integration.md`. Built on branch `ui/smoke-signal-brand` for staging only; it goes to `main` after Marc approves the name and the character, and if approved this replaces the product name in D15. If he approves Sig but not the name, keep the avatar and revert the wordmark and title changes. | Design session 2026-10-21: avatar, name and logo explored; the extinguisher picked for enterprise use. | |
| D38 | Reporter tally: **OPEN.** **PROPOSED:** the console shows how many people reported an item (the submitter plus each distinct colleague who added a +1 or was merged in; one per person, the submitter never twice) on the board card and the item panel. At 3 or more (`PRIORITY_REVIEW_REPORTERS`) on an open item that is not already P1, it shows "Priority review suggested" to Digital Staff and Admins; the priority itself never changes without a person. Staff never see the count, and a +1 is only possible on a match the agent offers, so asking colleagues to pile on has nothing to aim at. Impact still rises with +1s as before (team at 1, company at 10). Marc to confirm the threshold and that this is a suggestion only. |

### Asks to Chris (IT Director)

| # | Ask | Needed by |
| --- | --- | --- |
| 1 | Google Cloud projects (or one project with separate resources) for staging and production in australia-southeast1, with access for the developer | Sprint 1 (CI/CD, Cloud Run) |
| 2 | A Google OAuth client for the redadair.com.au Workspace | Sprint 1 (sign-in) |
| 3 | A Google AI Studio API key for Gemini Flash, stored in Secret Manager | Sprint 2 (agent) |
| 4 | A Gmail API service account and a sending mailbox | Sprint 3 (email notifications) |
| 5 | A repo in the company GitHub org, with branch protection and Marc as reviewer | Sprint 1 |
| 6 | The Digital Staff list with work emails, the triage lead and the IT Admin for access requests | Sprint 1 (seed) |
| 7 | Time with Marc to label the 40-item routing test set | Sprint 2 |
| 8 | About 15 pilot staff across REDMEN, ADAIR and offshore ops, and the intranet tile slot | Sprint 4 |
| 9 | An Artifact Registry repository, a Cloud SQL instance (or databases on the shared one), private buckets, service accounts with the roles in `docs/architecture.md`, and the APIs listed there enabled | Sprint 1 |
| 10 | ZeptoMail access and a verified sending domain (if D32 goes that way), and the production subdomain in Cloudflare (D35) | Sprint 3 / Sprint 4 |
| 11 | Answers on D31 (PostgreSQL version) and D32 (email provider) | Sprint 1 |

### Deviations register

The company standards are followed in full. The only deviations are for stacks that are not reachable yet, and each one is temporary. Dated 2026-10-21.

| # | Deviation (what is different for now) | Why | Closed when |
| --- | --- | --- | --- |
| 1 | Local PostgreSQL (Docker or pgserver) instead of Cloud SQL | Cloud SQL not provisioned; version also open (D31) | Asks 9 and 11 |
| 2 | The agent runs inside the API process, not on Agent Engine | No Google Cloud access yet | Asks 1 and 9 |
| 3 | Sign-in uses the local dev picker (D23); Google OAuth is built but untested against Google | No OAuth client yet | Ask 2 |
| 4 | Email is switched off or goes to Mailpit locally | No Gmail API account or ZeptoMail access; provider open (D32) | Asks 4 and 10 |
| 5 | The Gemini key is held in a git-ignored local `.env` | Secret Manager not available yet; the key never goes in code, `.env.example` or YAML | Asks 1 and 3 |
| 6 | Work is on feature branches cut from `main` (previously `feat/v3-build`, renamed 2026-10-23); `main` is not yet protected or tied to production | The company GitHub repo, `staging` and branch protection do not exist yet; the code lives in `jjtzoo/feedback-desk`, used with Marc's approval (2026-10-23) | Ask 5 |
| 7 | Deployment scripts, CI workflow and Cloud Run YAML are written but not run | No Google Cloud access or company repo | Asks 1, 5 and 9 |

## Stack and architecture

The intake agent talks to the user and classifies; the router decides the assignee in plain code. Everything writes to one Postgres database.

| Layer | Choice | Notes |
| --- | --- | --- |
| Front end | Next.js + React + TypeScript + Tailwind + shadcn/ui (D16) | One app: `/` staff landing page, `/chat` staff chat, tracker, My feedback, What's new; `/console` Digital Staff and Admin. Look at RAKE's chat UI for reference, don't copy it in. Reuse shadcn/ui components before writing new ones. |
| Auth | Google OAuth, redadair.com.au only | Role from `digital_staff`; everyone else is Staff. Session cookie: httpOnly, Secure, SameSite=Lax. |
| API | Python 3.12, FastAPI, Pydantic v2, SSE for chat and notifications | Pydantic schemas for every agent output. Role checked on every call. |
| Agent | Google ADK, single agent with tools, own package | `adk web` in development, Vertex AI Agent Engine in production. Gemini Flash via AI Studio key (D8). Prompt and project list versioned in the repo and the database. |
| Router | Plain Python in the API | Rules in "Assignment rules". |
| Data | PostgreSQL + pgvector (version per D31); Alembic migrations | Docker Desktop (`pgvector/pgvector:pg16`, named volume, nightly `pg_dump`) locally; Cloud SQL via the Cloud SQL connector in production. |
| Files | Private Cloud Storage bucket | Signed URLs, 15-minute expiry. Local: a fake GCS container or a local folder behind the same interface (PROPOSED). |
| Notifications | `notifications` table, SSE, ZeptoMail SMTP or Gmail API (D32) | Email for an event is sent from its notification row by the worker job. |
| Scheduling | Cloud Scheduler starts the `feedback-worker` Cloud Run job every minute (D33) | The job sends due emails, runs the daily digest (weekdays 8:00) and Friday drafter (9:00), Australia/Sydney, and embeds items duplicate search is missing. |
| CI/CD | GitHub Actions to Artifact Registry to Cloud Run; the agent deploys to Agent Engine from the same pipeline. `deploy.sh` / `deploy.ps1` and `deploy/service.<env>.yaml` for manual deploys | Separate staging and production services, databases and secrets (D25). |
| Observability | Cloud Logging, Error Reporting, agent traces | Log model, tokens and cost per conversation; traces kept 30 days. |
| Tooling | uv (with a generated `requirements.txt`), Ruff, mypy, pytest, ADK evals, Playwright | |
| Not used | Redis, Prisma, RAG Engine, Cloud Spanner, MCP servers (D26, D34) | Documented in `docs/architecture.md`. |

```
Staff (intranet tile) ──► Web app (Cloud Run): staff landing and chat, tracker, My feedback, What's new
Digital Staff, Admin ──► Web app (Cloud Run): console (board, list, cards, approvals, admin)
                               │
                               ▼
                    API (Cloud Run, Python) ──► Intake agent (Agent Engine, ADK, Gemini Flash)
                     │  router (code)                └── tools: list_projects, update_draft,
                     │  console API (role checked)            find_duplicates, submit_feedback
                     │  notifier (in-app + email)
                     ▼
     Cloud SQL Postgres + pgvector · Cloud Storage (files) · Secret Manager   (australia-southeast1)
```

## The agent

### Behaviour

1. Opens with a short greeting in RAKE's friendly Aussie tone, then lets the user type freely. No forms first. A `?project=` deep link preselects the project; it is served at `/chat?project=`, and `/?project=` redirects there.
2. Asks follow-up questions only for what is missing, **at most 3 per conversation**, chosen to fill the developer brief:
   - Which tool is this about? (quick-pick chips when project confidence is under 0.7)
   - What happened, or what would you like? For bugs: what you expected vs what you saw.
   - How much is this affecting your work? (blocking, slowing me down, nice-to-have)
   - If it can't tell the work type: does this exist today but isn't working, or is it something new?
3. Reads attachments (error screenshots, wrong reports, sample spreadsheets) to understand and classify.
4. Searches for duplicates in the same project and, on a likely match, offers "+1 and comment" on the existing item.
5. Shows a one-card summary (project, type, summary, priority) and lets the user confirm or edit (D12).
6. On confirm, submits; the router assigns; the agent replies with the reference and who it went to.
7. Off-topic questions get a polite redirect, with a pointer to RAKE for policy questions.
8. Never promises fixes or timelines. It says who has it and that they'll follow up.

### Tools

| Tool | What it does | Guard |
| --- | --- | --- |
| `list_projects()` | Active projects with name, slug, group, description, keywords, aliases. | Read only. |
| `update_draft(...)` | Writes classification fields and brief sections into `state["draft"]`; returns the draft and what is still missing. A fourth tool beside the brief's three (D22); it keeps the confirm guard (D12). | Validates every enum and the project slug; any call clears the confirmation. |
| `find_duplicates(limit=3)` | Open items in the draft's project above the similarity threshold: reference, title, date. | Same project, open items only, never returns submitter details. |
| `submit_feedback()` | Saves the confirmed draft, runs the router, queues notifications; returns reference and assignee name. | Refuses unless confirmed; takes no content arguments; once per session. |

Guards are enforced in code (`before_tool_callback`, `before_model_callback`), not only in the prompt: per-session tool limits, 2,000 characters per message, a turn cap that offers the backup form, 20-second turn timeout.

### Classification schema

The agent returns strict JSON validated against a Pydantic schema. Project candidates come from the database at runtime.

| Field | Values |
| --- | --- |
| `project_id` | An active project, or `general` |
| `target_type` | platform · agent · intranet · other (defaults from the project's group) |
| `area` | Short free text, e.g. login page, leave report, chat answers |
| `work_type` | fix · improvement · new_feature · no_change (question, access request, praise) |
| `category` | bug · performance · data_issue · usability · feature_request · access_request · question · praise |
| `priority` | P1 blocking work · P2 major (a real problem, but work can continue) · P3 minor · P4 nice-to-have |
| `impact` | one person · a team · company-wide (raised as duplicates come in) |
| `effort` | S (hours) · M (days) · L (a week or more) |
| `recommendation` | implement · decline · needs more info, with one sentence of reasoning |
| `summary` | One plain-English sentence |
| `title` | Under 80 characters |
| `confidence` | 0 to 1 for project, work type, category and priority |
| `sentiment` | positive · neutral · negative |

Work type is the headline: a badge (Fix, Improvement, New feature) on every card and approval, a filter, a report split, and the grouping of Friday releases. Digital Staff and Admins correct it in one click; corrections feed the agent's examples.

### Developer brief

Written by the agent from the chat, attachments and captured context; stored in `feedback.dev_brief`; shown at the top of the detail panel and the approval card. It uses only what the staff member said or attached and what the app captured, and never guesses steps. Developers can edit any section; edits are logged.

| Section | Contains | Used for |
| --- | --- | --- |
| Problem | One plain sentence | All |
| Steps to reproduce | Numbered steps | Fixes |
| Expected vs actual | What should happen, and what happened | Fixes |
| Who needs it and why | The job, how often, how many people | Improvements, new features |
| What they're asking for | The requested behaviour in their terms | Improvements, new features |
| Context | Browser, device, screen size, source app or page, time (automatic) | All |
| Evidence | Each attachment with a one-line description, text from Word and Excel, linked duplicates with a count | All |
| Done when | 1 to 3 acceptance criteria, editable | Fixes, improvements, new features |
| Submitter's words | A short quote from the original message | All |
| Open gaps | Anything not found within 3 questions, highlighted | All |

### Assignment rules (code, in this order)

1. **Confidence gate.** Project confidence under 0.7: ask the user with project chips. Still unclear after submit: Needs review (triage lead).
2. **Rule overrides.** Admin-defined `routing_rules` first, e.g. access_request on any project to the IT Admin; data_issue on Financial Platform to the finance data owner.
3. **Project owner.** The project's primary owner.
4. **Availability.** Owner marked away: Needs review for the triage lead to reassign.
5. **Load balance** (tie-breaker only): when a rule maps to a group, the member with the fewest open items.
6. **P1.** Also notify the Admins immediately, whoever the assignee is.
7. **Praise.** Assign to the owner as FYI and set Acknowledged; no approval needed.

After routing, an item waits in Awaiting approval with the agent's recommendation.

### Duplicate detection

Embed each summary (Gemini embeddings, model and dimension in config) and compare against open items in the same project. Above the threshold (start about 0.85, tuned on the test set): show the candidate in chat and flag it in the console. Digital Staff make the final merge call; the agent never auto-merges. A "+1 and comment" adds the user's comment to the existing item and raises its impact.

### Guardrails

- The agent only talks about feedback; it ignores instructions in the message that try to change its role or tools.
- Passwords, card numbers and TFNs are masked before anything is stored.
- Abusive or harassing content about a named colleague is flagged to the Admins and never routed to the named person.
- Rate limits per signed-in user, not per IP (an office shares one public address).
- The backup form keeps what the user typed when the model fails or times out; nothing is lost.

### Testing the agent

- **Week 2 gate:** a 40-item labelled test set written with Marc must score 85 % or more correct project, 85 % or more correct work type and 80 % or more correct assignee. Every test item has a complete developer brief or lists its open gaps. Run with one command; it gates every agent change.
- Prompt-injection and misuse cases (show me others' feedback, assign this to X, mark it resolved) must have zero passes before the pilot.
- The 10-conversation set written on 2026-10-20 (`backend/evals/`) is the starting point; it moves to the new classification fields.
- CI runs the agent tests against a stub model; the labelled set runs against Gemini.

## Feedback lifecycle

Nine internal statuses; staff see five tracker stages. Digital Staff never update two things.

```
New ──triaged──► Awaiting approval ──Admin approves──► Approved ──work starts──► In progress ⇄ Resolved ──► Closed
 │                    │      │                                                      (reopened by a submitter reply)
 └─low confidence─► Needs review ──► Awaiting approval
                      │      └──Admin declines──► Declined or merged ──► Closed
                      └──praise──► Acknowledged ──► Closed
```

| Tracker stage (staff see) | Internal status |
| --- | --- |
| Received | New, Needs review, Awaiting approval |
| Approved | Approved |
| In progress | In progress |
| Resolved | Resolved |
| Closed | Closed, Declined, Won't fix or merged, Acknowledged |

Won't fix is a close reason on Declined, not a separate status (D21).

## Data model

All tables in schema `app` (ADK sessions in schema `adk`). Ids are UUIDs; times are `timestamptz` in UTC. Keep it relational; pgvector for duplicate search, no separate vector store. Reporting is computed from `feedback` and `feedback_events`; no metrics store.

| Table | Purpose | Key fields |
| --- | --- | --- |
| `projects` | Catalogue the agent routes against | id, name, slug, group, description, keywords[], aliases[], owner_id, active |
| `digital_staff` | People who can be assigned | id, google_email, name, role (digital / admin), skills[], is_away, is_triage_lead, active |
| `routing_rules` | Admin overrides, checked before owner routing | id, project_id (null = any), category, assignee_id, priority_order, active |
| `feedback` | One row per item | id, ref_no (FB-0001, from a sequence), submitter_email, submitter_name, project_id, target_type, area, work_type, category, priority, impact, effort, ai_recommendation, status, title, summary, assignee_id, duplicate_of, ai_confidence (jsonb), dev_brief (jsonb), context (jsonb), expected_by, close_reason, created_at, first_response_at, approved_by, approved_at, resolved_at |
| `feedback_messages` | Chat transcript, replies, internal notes, progress updates | id, feedback_id, author_type (staff / digital / agent), author_email, message_type (chat / reply / note / progress), body, is_internal, expected_by, created_at |
| `attachments` | Uploaded files | id, feedback_id, file_name, gcs_path, mime_type, size_bytes, extracted_text |
| `feedback_events` | Append-only audit and training signal | id, feedback_id, actor, event_type, before (jsonb), after (jsonb), is_public, created_at |
| `feedback_embeddings` | Duplicate search | feedback_id, embedding (vector), model |
| `notifications` | In-app bell; the email is sent from the row | id, recipient_email, feedback_id, type, title, link, read_at, emailed_at, created_at |
| `notification_mutes` | Per-item mute (PROPOSED) | recipient_email, feedback_id |
| `project_messages` | Project channels | id, project_id, author_email, body, mentions[], feedback_refs[], pinned, created_at |
| `model_usage` | One row per model call (D36) | id, user_email, session_id, kind (chat / embedding), model, calls, input_tokens, output_tokens, estimated, cost_aud, created_at |
| `releases` | Friday releases | id, project_id, week_ending, status (draft / approved / published), approved_by, published_at |
| `release_items` | Lines in a release | id, release_id, title, body, work_type, source_type, source_id, visible_to_staff |
| `user_preferences` | Remembered console view (PROPOSED) | email, console_view |

**Rules in the service layer:**
- Every change to status, assignment, project, category, priority or work type writes a `feedback_events` row with before and after. Manual corrections are the routing training signal.
- `is_public` on events and `is_internal` on messages decide what the tracker shows; internal notes and admin-only changes never reach staff.
- A submitter reply on a Resolved item reopens it to In progress.
- Developers can only start Approved items; Start work is one conditional update.
- `first_response_at` is set by the first Digital Staff reply, progress update or stage change.

### What the tracker history shows

| Event | Written by | Shown as (example) |
| --- | --- | --- |
| Received | System | Received via chat, 1 screenshot |
| Classified | Agent | Classified: Bug, P2, RAKE Agent |
| Assigned or reassigned | Agent or Digital Staff | Assigned to Darlene |
| Approved or declined | Admin | Approved by Chris |
| First opened by assignee | System | Darlene opened your feedback |
| Stage change | Digital Staff | Darlene started work |
| Expected by set or changed | Digital Staff | Expected by Thu 23 Oct |
| Progress update | Digital Staff | Update: found the cause, fix in testing |
| Submitter reply | Staff | You added details |
| Resolved | Digital Staff | Resolved: fix deployed |
| Closed, merged, declined, won't fix | Digital Staff or Admin | Closed: merged into FB-0138 |

## API

All under `/api`; errors are `{"error": {"code", "message"}}`. Every route except sign-in requires a session; the role check is in a dependency on every route.

| Area | Endpoints | Sprint |
| --- | --- | --- |
| Auth | `GET /auth/google/start`, `GET /auth/google/callback`, `POST /auth/signout`, `GET /me` | 1 |
| Admin | CRUD on `/admin/projects`, `/admin/digital-staff`, `/admin/routing-rules` | 1 |
| Chat | `POST /chat/sessions` (`project_slug?`, context), `POST /chat/sessions/{id}/messages` (SSE), `POST /chat/sessions/{id}/attachments`, `POST /chat/sessions/{id}/confirm` (draft hash), `POST /chat/sessions/{id}/plus-one` | 2 |
| Backup form | `POST /feedback/fallback` | 2 |
| Staff | `GET /my/feedback`, `GET /feedback/{ref}/tracker`, `POST /feedback/{ref}/replies` (with files), `GET /whats-new` | 2–4 |
| Console | `GET /console/items` (view, inbox, filters, search, page), `GET /console/items/{id}`, `PATCH /console/items/{id}`, `POST /console/items/{id}/{start,update,resolve,reply,note,merge}`, bulk reassign and close | 3 |
| Approvals | `GET /console/approvals`, `POST /console/items/{id}/{approve,decline,ask-info}` | 3 |
| Files | `GET /files/{id}` (signed URL, role checked) | 2 |
| Notifications | `GET /notifications`, `GET /notifications/stream` (SSE), `POST /notifications/read`, `POST /feedback/{ref}/mute` | 3 |
| Channels | `GET/POST /console/projects/{slug}/messages`, pin | 3 |
| Releases | `GET /console/releases`, `PATCH /console/releases/{id}`, `POST /console/releases/{id}/publish` | 4 |
| Reports | `GET /console/dashboard`, `GET /console/usage` (D36) | 3 |
| Usage | `GET /usage/me` (the signed-in person's allowance today, D36) | 2 |
| Ops | `GET /health` (DB, migration, model credentials) | 1 |

## Project structure

```
Feedback/
  README.md  CLAUDE.md  .gitignore  .gcloudignore  .env.example (non-secret settings only, D13)
  compose.yml  deploy.sh  deploy.ps1
  deploy/        # Cloud Run service YAML per environment: api|web.staging.yaml, api|web.production.yaml
  backend/
    Dockerfile  pyproject.toml  uv.lock  requirements.txt (generated by uv export)  alembic/
    seed/projects.yaml  seed/digital_staff.yaml  seed/routing_rules.yaml
    app/            # FastAPI: main, config, db, models, schemas, api/, services/ (router, approvals,
                    # tracker, notifications, files, channels, releases, auth), worker.py, seed.py
    agent/          # ADK agent package, deployable to Agent Engine on its own (D7):
                    # agent.py, instruction.md, tools.py, callbacks.py, schema.py, stub.py
    evals/  tests/
  web/              # Next.js App Router + shadcn/ui: app/(staff)/, app/console/, components/ui/
  docs/             # this spec, architecture.md, restore runbook, staff guide, console runbook
  .github/workflows/ci.yml
```

## Local setup

1. Install Docker Desktop, uv, Node 22 and the gcloud CLI.
2. `gcloud auth application-default login` (reads secrets from Secret Manager, D19).
3. `cp .env.example .env` for non-secret settings; fill `backend/seed/*.yaml`.
4. `docker compose --profile dev up --build`, then `docker compose exec api python -m app.seed`.
5. Open http://localhost:5173 (staff), http://localhost:5173/console (Digital Staff), http://localhost:8025 (Mailpit).
6. Agent playground: `uv run adk web` from `backend/`.
7. Without Docker: `uv run python -m scripts.dev_server` (throwaway Postgres + pgvector via `pgserver`, API on port 8001).

## Conventions

- Python: Ruff, mypy strict, Pydantic for every request, response and agent output. Business rules in `app/services/` with unit tests; routers and agent tools stay thin.
- The agent package never imports FastAPI; agent tools call services through a small interface so the agent can run in Agent Engine.
- Every migration is an Alembic revision committed with the change.
- Pin exact versions (`uv.lock`, `package-lock.json`); upgrade ADK only in its own PR with the agent tests passing.
- Git (manual §7, §8): company GitHub org; never commit to `main` directly; one branch per focused change, named by type (`feat/`, `fix/`, `ui/`, `db/`, `infra/`, `deps/`, `perf/`, `security/`, `spike/`); tested and reviewed by Marc before merge; branches deleted after merge; Conventional Commits; changelog entry per feature.
- Keep the codebase clean (manual §6, §11): no unused files, imports or variables, no debugging leftovers, no hard-coded configuration, no secrets.
- Before any deploy or database operation, confirm the target environment; run the deployment review checklist in `docs/architecture.md` (manual §26).
- Before adding a dependency, check an existing one can't do the job; keep `requirements.txt` regenerated from `uv.lock` (manual §31).
- AI-assisted changes are checked against the real code, schema and docs before merge; never assume a table, endpoint, package or folder exists (manual §29, §36).
- Frontend design work may use the Impeccable skill, reviewed against D17 and shadcn/ui (manual §30).
- No secret or personal data in logs; emails redacted; PII masked before storage.

## Sprint plan

Four one-week sprints, one per brief phase. Points are relative size, not hours; about 25 points a week for one developer with AI coding tools. Each sprint ends with a Friday demo and a gate signed by Marc and Chris.

**Slip order (D14).** If anything slips: first the dashboard and daily digest (S3-7) move to phase 2, then AI drafting of releases (S4-1; owners write release items by hand until it lands). Routing quality (S2-4, S2-9) and attachments (S2-3) never slip.

### Sprint 1: Foundations (gate: design review)

| ID | Story | Pts |
| --- | --- | --- |
| S1-1 | Repo in the company org, CI (Ruff, mypy, pytest, web build), staging and production Cloud Run service YAML, deploy.sh and deploy.ps1, .gcloudignore, Docker Compose for local | 4 |
| S1-2 | v3 data model and migrations; FB- reference sequence; seed projects, owners, Digital Staff and rules | 4 |
| S1-3 | Google OAuth limited to redadair.com.au; `hd` and role checked on every request; Staff vs console areas | 5 |
| S1-4 | Admin page: projects, Digital Staff, routing rules | 5 |
| S1-5 | Short design doc (architecture, lifecycle, routing, data, security) for review | 2 |
| S1-6 | Rework the existing build to v3 (see "Starting point") so later sprints build on one base | 4 |

**S1-3 Done when:** a Digital Staff user and a Staff user see different areas; a non-redadair Google account is refused; an API call with a Staff session to a console route returns 403; the `hd` claim is checked server-side on every request (test).
**S1-4 Done when:** only Admins reach it (403 otherwise); a project added on the page appears in `list_projects` without a deploy; every change is logged.
**Gate accepted when:** a Digital Staff user and a Staff user see different areas; a non-redadair account is refused; the design doc is reviewed by Marc and Chris.

### Sprint 2: Chatbot and agent (gate: routing 85 %+ on the test set)

| ID | Story | Pts |
| --- | --- | --- |
| S2-1 | Intake agent v3: tools, classification schema, at most 3 questions, Aussie tone, `?project=`, guardrails, PII masking | 5 |
| S2-2 | Staff chat UI: streaming, quick-pick chips, confirm card, reference and assignee, automatic context | 3 |
| S2-3 | Attachments: upload, content type check, macro rejection, size and count limits, Word and Excel text, files to Gemini, signed URLs | 4 |
| S2-4 | Router: confidence gate, rule overrides, owner, away, load balance, P1, praise; Awaiting approval | 3 |
| S2-5 | Developer brief generation with open gaps | 3 |
| S2-6 | Duplicate detection with embeddings and "+1 and comment" | 3 |
| S2-7 | My feedback list and a basic tracker page | 2 |
| S2-8 | Backup form when the model fails; nothing lost | 1 |
| S2-9 | 40-item labelled test set with Marc; one-command eval with thresholds | 2 |

**Gate accepted when:** the test set scores 85 %+ correct project, 85 %+ correct work type and 80 %+ correct assignee; every file type uploads and informs classification; no feedback is lost when the model call fails; every test item has a complete developer brief or lists its open gaps.

### Sprint 3: Console (gate: UAT sign-off)

| ID | Story | Pts |
| --- | --- | --- |
| S3-1 | Board (default), List and Cards; drag to change stage; remembered view; inbox filters, filters, search; bulk reassign and close | 5 |
| S3-2 | Detail panel: brief, classification with confidence, duplicates, file preview, transcript, history; Start work, Post update and Expected by, Resolve with public note, reply, internal note, change fields, reassign, merge | 5 |
| S3-3 | Approvals: Admin view and column, P1 first, approve, decline with reason, ask for info, audit | 3 |
| S3-4 | Staff tracker: status header, five-stage stepper, who has it, latest update, history, Reply or add details, reopen | 3 |
| S3-5 | Notifications: bell with SSE and polling fallback, read state, 90 days, email via Gmail API, per-item mute | 4 |
| S3-6 | Project channels: @mentions, #FB chips, pinned notes, files | 3 |
| S3-7 | Dashboard and daily digest (first to slip) | 2 |

**Gate accepted when:** the full lifecycle is walked end to end; every manual change appears in `feedback_events`; staff see every stage and update on their tracker and get an in-app notification and an email for each.

### Sprint 4: Pilot and launch (gate: go-live)

| ID | Story | Pts |
| --- | --- | --- |
| S4-1 | Friday release drafter (Cloud Scheduler, 9:00 AEST), owner review and publish, What's new page, contributor notifications (second to slip) | 5 |
| S4-2 | Production deploy: Cloud Run, Agent Engine, Cloud SQL, Cloud Storage, Secret Manager in australia-southeast1; backups; error alerting | 5 |
| S4-3 | 3-day pilot with about 15 staff; daily fixes; no P1 open | 6 |
| S4-4 | Feedback tile on the intranet home; one-page staff guide; console runbook | 2 |

**Gate accepted when:** the pilot is complete, no P1 bugs are open, Marc and Chris sign off UAT, and the tile is live on the intranet.

### Build status (2026-10-25)

Built against this spec, ahead of the sprint gates; merged to `main`, nothing deployed.

| Area | Status |
| --- | --- |
| Data model, migration, seed (S1-2) | Built. v3 tables, FB- sequence, the brief's 15 projects and owners, interim roles (D20). |
| Sign-in and roles (S1-3) | Built and tested: Google OAuth flow with the domain checked on every request, a local sign-in picker (D23), roles from `digital_staff`. Needs the OAuth client (ask 2) to test against Google. |
| Admin page (S1-4) | Built: projects, Digital Staff, routing rules. |
| Spend guards (D36) | Built and tested: usage ledger, per-person and budget limits, allowance meter in the chat, AI usage panel on the dashboard. Checked against the real Gemini model. |
| Guide | A spotlight tour per area (staff, console), filtered by role, ending on the Guide button that reopens it. A step with something to click shows OK; the control then pulses and only it works; clicking it does its normal job and a "Try it out" card waits for Next. Skip this step and Skip tour always; Esc to leave; opens by itself on a first visit. |
| Navigation | Digital Staff and Admins land on the console after sign-in, Staff on the chat. A Console button in the staff header (Digital Staff and Admins) and a Smoke Signal home button in the console header; the account menu holds who you are and Sign out. An API address opened in the browser shows a "You can't open that" page, not JSON. |
| Chat uploads | Paperclip or drag and drop onto the chat. Size and count are refused in the browser before upload; type, contents, size and count are checked again by the API. |
| Agent, router, brief, duplicates, attachments, backup form (S2-1 to S2-8) | Built and tested on the stub model; Word/Excel text, content-type checks, macro rejection, PII masking, abuse flag, cost log. Needs the AI Studio key (ask 3) to score the routing gate. |
| Routing test set (S2-9) | A 40-item draft in `backend/evals/routing_set.yaml` and a runner; Marc to correct the labels. On Gemini 3.1 Flash-Lite (2026-10-21): 97.5 % project, 97.5 % work type, 100 % assignee, every brief complete: gate passed on the draft labels. The stub scores 75 % / 70 % / 75 % (keyword baseline). Re-run 2026-10-26 after the instruction changed: 95 % / 95 % / 97.5 %, pass. Conversation checks (`backend/evals/conversation_set.yaml`, 28 cases: follow-ups on existing feedback, misuse, privacy, off-topic, varied writing): 28 of 28 on Gemini; record in `docs/testing/conversation-eval-2026-10-26.md`. |
| Console, approvals, tracker, notifications, channels, dashboard, digest (S3-1 to S3-7) | Built and tested end to end; board drag-and-drop, list and cards views; in-app bell over SSE with polling fallback; email through Mailpit locally. |
| Friday releases (S4-1) | Built: drafter, owner review, publish, What's new, contributor notifications. The drafter assembles from sources; AI rewording comes with the key. |
| Deployment (S1-1, S4-2) | Written, not run: `deploy.sh`, `deploy.ps1`, Cloud Run YAML, worker job, scheduler, CI workflow. Needs Google Cloud access (asks 1, 9) and the company GitHub repository (ask 5). Agent Engine deployment still to do once access exists. |
| Pilot and launch (S4-3, S4-4) | Not started. |
| Browser tests | Playwright tests of the manual checklist on the stub model and a local database: 219 of 227 items have a test; on the full run of 2026-10-25, 216 pass, 2 are known bugs awaiting a product decision (S22.01 allowance meter, S22.05 limit mid-chat, D36) and 1 is skipped (S10.09, needs Docker, which this machine does not have); 214 tests are shown able to fail; 91 of them also passed 10 runs in a row on 2026-10-23; mobile (S27), dark mode (S29) and reduced motion (S30) have no test yet. Random test failures on 2026-10-25 were traced to the API committing after it replied; fixed (`Db` in `app/api/deps.py` commits before the response) and covered by a backend test. Per requirement F1 to F18: `docs/testing/feature-evidence.md`; run reports: `docs/testing/browser-tests-2026-10-22.md`, `docs/testing/browser-tests-2026-10-23.md`; bugs: `web/e2e/FINDINGS.md`. Not run on staging or against Gemini. |
| Checks | Backend: 82 tests, Ruff, mypy strict. Web: ESLint, TypeScript, production build. Screens checked in a browser at desktop and 375 px, light and dark. |

## UI

Visual direction (D17): modern and red-led. Landing page as mockup D (red hero band); tracker, My feedback and console as mockup E (charcoal header, red highlights). Mockups in `docs/design/mockups/directions-red.html`. Update `.claude/skills/fire-services-ui/SKILL.md` to match. Brand and assistant artwork: D37 (OPEN); assets in `web/public/brand/`, plan in `docs/design/smoke-signal-integration.md`.

Whatever the direction:
- **Mobile first.** Most staff open the tracker from an email on their phone; offshore staff are often on phones. Every screen works at 360 px.
- **Tracker like a parcel app** (brief §4.2 references): status up top with a reference chip and Expected by, a five-stage stepper, a who-has-it card, the latest update, then the history newest first with older entries greyed out.
- **Console like a board:** cards show the FB ref, work type badge, priority (P1 outlined red), title, project, submitter, age, Expected by (red when overdue), a paperclip for files, and an unread-reply dot.
- **Status never relies on colour:** every badge shows a word, and an icon where it helps.
- Keyboard-usable, readable contrast (WCAG AA) in light and dark themes.

Staff screens: chat, confirm card, done, backup form, My feedback, tracker, What's new, notifications. Console: board, list, cards, detail panel, approvals, project channel, release review, dashboard, admin.

## Non-functional requirements

| Area | Requirement |
| --- | --- |
| Authentication | Google OAuth, redadair.com.au accounts only; the `hd` claim checked server-side on every request; no local passwords |
| Authorisation | Role checked server-side on every API call; staff see only their own items |
| Data residency | Cloud Run, Cloud SQL and Cloud Storage in australia-southeast1 |
| Performance | Agent first token under 3 s; triage under 10 s after submit; console list under 1 s for 5,000 items |
| Availability | Business hours AU, best effort; the backup form when the model is down |
| Audit | Every status, assignment and classification change in the append-only events table (who, what, when, before and after) |
| Privacy | Submitter name visible to Digital Staff; internal notes never shown to staff; attachments private with signed URLs; file type checked by content; macro-enabled files rejected |
| Secrets | Secret Manager only, including the AI Studio key |
| Cost | LLM cost logged per conversation; under AUD 0.05 per feedback item |
| Accessibility | Keyboard-usable, readable contrast, works on mobile browsers |
| Observability | Structured logs, error alerting to the Admins, agent traces kept 30 days |

## Definition of Done

- Every "Done when" line passes, by an automated test where possible.
- Merged through a PR reviewed by Marc, with CI green (Ruff, mypy, pytest, agent tests, web build; Playwright once in).
- Tested on staging, deployed to production by the pipeline from `main`, noted in the changelog.
- Every deployment passes the pre-deployment checklist and the post-deployment verification in `docs/deployment.md` (deployment manual §45, §47).
- A migration is committed if the schema changed; `.env.example` updated if non-secret config changed; secrets only in Secret Manager.
- No secret or personal data in logs.
- Screens work at 360 px and on desktop, are keyboard-usable, and pass AA contrast in light and dark.

## Risks

| Risk | Mitigation |
| --- | --- |
| Agent misroutes; Digital Staff lose trust | Confidence gate and Needs review; reassignment rate tracked weekly; prompt and keywords tuned from corrections |
| Low adoption: staff keep messaging IT | Feedback tile on intranet home; IT redirects side-channel feedback to the agent; visible replies |
| Scope creep into a full helpdesk | Anything beyond feedback goes to a phase 2 list approved by Marc and Chris |
| Feedback sits unanswered | Daily digest of stale items; time to first response on the dashboard; approvals older than 2 business days flagged |
| Sensitive content in feedback | PII masking, abuse flagging, restricted access to transcripts |
| One month is tight for one developer; week 2 carries the most risk | Slip order (D14); the v2 build as a head start; AI coding tools; daily notes |
| Google Cloud access, OAuth client or AI Studio key arrive late | Asks 1 to 3 raised on day one; local stack and stub model keep work moving |
| Approvals become a bottleneck | P1s notify Admins immediately; daily approvals summary; one Admin decision is enough |

## Working agreement

- A weekly 30-minute check-in with Marc to demo something working; Chris joins the gate reviews.
- Raise blockers the same day.
- Architecture or scope changes: a short written proposal in the brief's comments before building.
- All code in the company GitHub org; PRs reviewed by Marc before merging to `main`.

## Weekly update template

> **Feedback, week _n_ (Sprint _n_: _phase_)**
> Gate: _criteria and status_.
> Stories done: _n_ of _m_ (_p_ points planned).
> Working now: _what was demoed_.
> Routing test set: project _%_, work type _%_, assignee _%_; injection cases _passed/total_.
> Next: _top stories_.
> Waiting on IT: _asks still open_.
> Risks and decisions needed: _list_.
