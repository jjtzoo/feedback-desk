# Feedback architecture

How the system fits together, per the company handover manual §17. Decisions (D-numbers) are in
`feedback-build-spec-v3.md`. Update this file in the same change as the code it describes.

## Components

| Component | Where | What it does |
| --- | --- | --- |
| Web app | `web/` (Next.js App Router, React, TypeScript, Tailwind, shadcn/ui) | Staff area: a help-centre style landing page at `/` (one Give feedback action, four starting points, tool picker, recent feedback), the chat at `/chat` (`?project=` preselects a tool, `?start=` pre-fills a starter), My feedback, tracker, Fixes and updates and the console at `/console` (work as board, list or cards with inbox counts from `GET /console/counts`, approvals, channels, releases, dashboard, admin; the item opens in a side panel with its properties, one activity feed and previous/next). It forwards `/api/*` to the API; it never touches the database or the model. |
| API | `backend/app/` (FastAPI) | Sign-in, every business rule (`app/services/`), the router that assigns owners, approvals, notifications, files, channels, releases, reports. Roles checked on every call. |
| Agent | `backend/agent/` (Google ADK, Gemini 3.8 Flash; 3.1 Flash-Lite as fallback by config, D36) | One LlmAgent: chats with staff first and starts a report only when there is something to report (D64), classifies, writes the developer brief, calls `list_projects`, `update_draft`, `find_duplicates`, `submit_feedback`. Runs in the API process locally; on Vertex AI Agent Engine in production (D7). |
| Worker | `backend/app/worker.py` | Sends the email for each notification (3 tries), runs the daily digest and the Friday release drafter. A loop locally; a Cloud Run job started every minute by Cloud Scheduler in the cloud (D33). |
| Database | PostgreSQL + pgvector | Schema `app` (everything below) and schema `adk` (agent sessions, owned by ADK). |
| Files | Local folder (local), private Cloud Storage bucket (cloud) | Attachments, served through 15-minute signed links. |

Not used: Redis, Prisma, RAG Engine, Cloud Spanner, MCP servers (D26, D34). Live notifications poll Postgres; queues are Postgres tables.

## How the parts talk

```
Browser ──HTTPS──► web (Next.js, Cloud Run) ──/api/* proxy──► api (FastAPI, Cloud Run)
                                                              │  ├─ agent (ADK; Agent Engine in production) ──► Gemini Flash
                                                              │  ├─ router (code) picks the assignee
                                                              │  └─ services ──► Cloud SQL (Postgres + pgvector)
                                                              │                ──► Cloud Storage (attachments)
Cloud Scheduler ──every minute──► worker job (Cloud Run job) ──► Cloud SQL, email (ZeptoMail SMTP or Gmail API)
```

- **Frontend to backend:** same-origin `/api/*` through the web app, so the session cookie (httpOnly, Secure, SameSite=Lax) works without CORS. Chat and the notification bell use server-sent events, sent with `Cache-Control: no-cache, no-transform` (`STREAM_HEADERS`) so the web app does not gzip them: gzip holds small events in its buffer. The bell reconnects after a dropped stream (an API restart, a deploy, Cloud Run's request timeout) and polls every 30 seconds only while it is down. When someone opens an `/api/*` address in the address bar (a document navigation), the proxy (`web/src/proxy.ts`) checks the API's answer first: 401 goes to sign-in, 403 and 404 show the `/problem` page instead of raw JSON. Those routes resolve the signed-in user in their own short transaction (`stream_user`), so an open tab does not keep a transaction (or a lock on the sign-in tables) open. Every other route has one transaction per request (`Db` in `app/api/deps.py`), committed when the route returns and before the response is sent (`scope="function"`): a client acting on a 2xx at once, such as the page loaded straight after sign-in, always finds the data saved, and a failed commit is a 500, never a false success. uvicorn runs with `--timeout-keep-alive 620` (Dockerfile and the local and test servers): the web proxy reuses idle connections to the API, so the API must not close them first, which showed up as a rare random 500.
- **Backend to database:** SQLAlchemy async with asyncpg. In Cloud Run the connection goes through the Cloud SQL connector socket in `DATABASE_URL`. Migrations (Alembic) run when the API container starts, so staging migrates before production.
- **Agent to services:** tools call the same `app/services/` functions as the API; the model never writes to the database directly and never names an assignee (D2).
- **External services:** Google OAuth (sign-in, redadair.com.au only), Gemini (AI Studio key, or Vertex AI by config), ZeptoMail or Gmail API (D32), Cloudflare DNS for the production domain (D35).

## Data

Tables in schema `app` (models in `backend/app/models/entities.py`, migrations in `backend/alembic/versions/`):

| Table | Purpose |
| --- | --- |
| `projects`, `digital_staff`, `routing_rules` | The catalogue, people who can be assigned, admin overrides |
| `feedback` | One row per item: classification, status (nine values), ending (how a closed or declined item ended, D44), assignee, `routed` (routing's reason while nobody has accepted or changed its choice, D56), developer brief, context, dates |
| `feedback_messages` | Chat transcript, replies, internal notes, progress updates, follow-ups. `asks_check` marks an update or Resolve note that asks the reporter to try it; the tracker then offers It's fixed and Still happening (D80) |
| `feedback_events` | Append-only audit and routing training signal; `is_public` drives the tracker. A change of hands is `assigned`, `taken_over` or `handed_over`, kept apart from routing `correction`s (D53). Events, messages, notifications and usage rows are stamped by `entities.stamp()`, always later than the process's previous stamp, and lists sort by time then id, so rows written together keep their order even where the clock repeats (Windows, D77) |
| `feedback_followers` | Staff who added "+1 and comment" (one row per person, never the submitter). The console's reporter tally is 1 + these rows; at `PRIORITY_REVIEW_REPORTERS` (3) it suggests a priority review, never applies one (D38, proposed) |
| `attachments` | Files and their extracted text |
| `feedback_embeddings` | pgvector embeddings for duplicate search |
| `notifications`, `notification_mutes` | The bell and its emails (title and body masked, then cut to 300 characters); per-item mutes. An ask (needs approval, assigned, ready to start, asked about) settles for everyone once anyone acts, with `outcome` saying what happened (D54); each Admin has one standing approvals row, updated in place and never emailed (D55); `updated_at` lets the bell's stream see rows change in place. `step` names the stage in a word or two; the bell groups rows by item with the steps as a trail, and the worker sends one email for one person's rows about one item that are due together (D78). Links open the panel at the message (`&tab=activity&msg=`) or the tracker at `#latest` (D81) |
| `item_reads` | When each Digital Staff member last opened an item; later replies, notes and updates from others show as New in the panel and New reply on the list and board (D82) |
| `project_messages`, `releases`, `release_items` | Project channels and Friday releases |
| `user_sessions`, `user_preferences`, `job_runs` | Sign-in sessions, remembered console view, scheduled-job slots |

## Environments (D25)

| | Local | Staging | Production |
| --- | --- | --- | --- |
| Branch | any feature branch | `staging` | `main` |
| Config | `.env` (non-secret) using staging-like values; dev sign-in on; stub model unless a key is set | `deploy/staging.env` + Secret Manager `feedback-staging-*` | `deploy/production.env` + Secret Manager `feedback-production-*` |
| Database | Docker `pgvector/pgvector` or `pgserver` | Cloud SQL database `feedback_staging` | Cloud SQL database `feedback_production` |
| Files | `backend/.uploads/` | bucket `redadair-feedback-staging-files` | bucket `redadair-feedback-production-files` |
| Email | Mailpit or off | ZeptoMail sandbox sender, staff test addresses | ZeptoMail (or Gmail API), real staff |
| Domain | localhost | Cloud Run URL | `feedback.redadair.com.au` (D35, to confirm) |

Staging never points at production resources, and the scripts refuse to deploy a branch to the wrong environment.

Browser tests (`web/e2e/`, Playwright) are a fourth, local-only setup: API on port 8002 (`backend/scripts/e2e_server.py`, which runs it as a child process and restarts it with `MODEL_PROVIDER` stub or none on request from 127.0.0.1:8012), a production web build in `web/.next-e2e/` on port 3100, the `fd_e2e` database in the same `pgserver`, the stub model, email off. `backend/scripts/e2e_reset.py` puts that database back to the seed before each spec file. Nothing in it reaches the local hand-testing servers (8001, 3000) or the cloud.

## Cloud resources (australia-southeast1)

| Resource | Name (per environment `<env>`) | Settings |
| --- | --- | --- |
| Cloud Run service, API | `feedback-api-<env>` | 1 CPU, 1 GiB, min 0, max 1, timeout 300 s, request-based billing |
| Cloud Run service, web | `feedback-web-<env>` | 1 CPU, 512 MiB, min 0, max 1, timeout 300 s, request-based billing |
| Cloud Run job, worker | `feedback-worker-<env>` | `python -m app.worker --once`, 1 task, 300 s |
| Cloud Scheduler | `feedback-worker-<env>` | every minute, Australia/Sydney, starts the worker job |
| Artifact Registry | `australia-southeast1-docker.pkg.dev/<project>/feedback/feedback-api`, `.../feedback-web` | tags `<env>-<git sha>` |
| Cloud SQL | per D31 | databases `feedback_staging`, `feedback_production` |
| Cloud Storage | `redadair-feedback-<env>-files` | private, uniform access |
| Secret Manager | `feedback-<env>-database-url`, `-secret-key`, `-google-api-key`, `-oauth-client-secret`, `-smtp-password`, `-job-token` | |

Labels on everything: `project=feedback`, `environment=<env>`, `application=api|web|worker`, `owner=digital-team`, `purpose=...`, `deployment-type=cloud-run-service|cloud-run-job`.

## Service accounts and IAM (least privilege)

| Service account | Roles |
| --- | --- |
| `feedback-api-<env>@` | Cloud SQL Client; Secret Manager Secret Accessor on its own secrets; Storage Object User on its bucket only; Service Account Token Creator on itself (to sign file links); Vertex AI User (Agent Engine and Vertex models); Logs Writer |
| `feedback-web-<env>@` | Logs Writer |
| `feedback-worker-<env>@` | Cloud SQL Client; Secret Manager Secret Accessor on its own secrets and `-google-api-key` (embeddings); Vertex AI User only when `MODEL_PROVIDER=vertex`; Logs Writer |
| `feedback-scheduler-<env>@` | Cloud Run Jobs Executor on the worker job only |
| `feedback-deployer@` (GitHub Actions through Workload Identity Federation) | Cloud Run Admin on the four services and two jobs; Artifact Registry Writer on `feedback`; Service Account User on the runtime accounts; Cloud Scheduler Admin |

Gmail API (only if D32 chooses it): domain-wide delegation for the API account, scope `gmail.send`, approved by a Workspace admin.

## Google Cloud APIs to enable

Cloud Run, Artifact Registry, Cloud SQL Admin, Secret Manager, Cloud Storage, Cloud Scheduler, Vertex AI, IAM Credentials, Cloud Logging, Error Reporting; Gmail API only for D32 = Gmail.

## Scheduled tasks

| Task | Trigger | Runs | Target |
| --- | --- | --- | --- |
| Email sending | Cloud Scheduler, every minute | `feedback-worker-<env>` job | Due notification emails |
| Daily digest | the same job, first run after 8:00 weekdays (Australia/Sydney) | `jobs.run_digest` | Needs review over 24 h to the triage lead; approvals summary to Admins |
| Friday release drafter | the same job, first run after 9:00 Friday | `jobs.run_release_drafter` | A draft per active project, owner notified |
| Embedding backfill | the same job, every run | `embeddings.backfill` | Up to 20 open items whose embedding is missing or from another model; skipped when the chosen model is unreachable |

## Model spend guards (D36)

Every chat turn and embedding call writes an `app.model_usage` row (tokens, estimated AUD cost, no text). `services/usage.py` checks the per-person daily token limit and the daily and monthly budgets before a chat starts and before each message; over a limit, the chat hands over to the backup form. `GET /api/usage/me` feeds the allowance meter under the chat; `GET /api/console/usage` feeds the dashboard's AI usage panel.

`job_runs` makes each slot run once. `/api/jobs/daily-digest` and `/api/jobs/release-drafts` (header `X-Job-Token`) run them on demand.

## Key data flows

The whole journey on one page: [smoke-signal-workflow.svg](design/smoke-signal-workflow.svg) (lanes for staff, Sig, system, Admin and Digital Staff, the five tracker stages, and the Friday release).

1. **Submitting:** a new chat opens with the app cards (D99): `POST /api/chat/sessions` returns the catalogue and the person's `usual` tools, which the cards show first; a card calls `POST /api/chat/sessions/{id}/tool`, where code sets the tool in session state (as `?project=` does, confidence 1) and sends its name as the person's turn, so Sig asks what happened and never which tool; the stream's `tool` event tells the page once the tool is known, and the cards go. Screenshots come by paperclip, drop, paste or the phone camera, upload to the session at once and show as thumbnails (D95) → chat message (PII masked) → the agent replies to what was said; a question about Sig or small talk stays chat (D64) → when something is reported, it classifies and fills the draft, asking what happened before impact (D61), and signals each turn's step through `update_draft`'s `next_step`; the API shows the chips for that step only (the tool chips under the tool question, the person's usual tools first; impact chips under the impact question, by fault or idea; Yes and No under "Want me to send that to the team?" for a question or praise; the model's checked replies; D60, D62, D65) → confirm card, only on the `show_card` step (D65), with what happened and anything still unknown (D63) → Confirm (draft hash) → `submit_feedback` saves the item, attachments, transcript and events → router assigns (logged by System with its reason) → Awaiting approval (or Needs review, or Acknowledged for praise) → notifications, and each Admin's approvals count updates.
2. **Adding later:** the tracker's Reply or add details uploads pasted, attached or photographed files to `POST /api/feedback/{ref}/attachments` before the reply; a Digital Staff reply can carry images the same way, and the tracker shows the team's files apart (`from_team`, D95). Type, contents, size and count are checked by the API on every upload (D10); the pages check size and count first from the limits the API returns.
3. **Approving and working:** Admin approves or declines → the holder (only the holder, D53) starts work, posts updates and an Expected by date, resolves with a public note; anyone else uses Assign to me, Take over or Hand over, each named and told → every public change is an event the tracker shows, and a notification in the app and by email. An update can ask the reporter to try it, and a Resolve note always does: the tracker leads with It's fixed and Still happening, and Still happening reopens a Resolved item (D80). A P1 resolved or closed as fixed is told to the Admins and the triage lead (D84).
4. **Friday release:** drafter collects the week's resolved items, public progress and channel notes → owner ticks and edits → publishes → Fixes and updates, contributors notified.
