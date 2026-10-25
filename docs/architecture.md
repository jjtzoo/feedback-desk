# Feedback architecture

How the system fits together, per the company handover manual §17. Decisions (D-numbers) are in
`feedback-build-spec-v3.md`. Update this file in the same change as the code it describes.

## Components

| Component | Where | What it does |
| --- | --- | --- |
| Web app | `web/` (Next.js App Router, React, TypeScript, Tailwind, shadcn/ui) | Staff area: a landing page at `/` (start cards, tool picker, recent feedback), the chat at `/chat` (`?project=` preselects a tool, `?start=` pre-fills a starter), My feedback, tracker, What's new and the console at `/console` (board, approvals, channels, releases, dashboard, admin). It forwards `/api/*` to the API; it never touches the database or the model. |
| API | `backend/app/` (FastAPI) | Sign-in, every business rule (`app/services/`), the router that assigns owners, approvals, notifications, files, channels, releases, reports. Roles checked on every call. |
| Agent | `backend/agent/` (Google ADK) | One LlmAgent: talks to staff, classifies, writes the developer brief, calls `list_projects`, `update_draft`, `find_duplicates`, `submit_feedback`. Runs in the API process locally; on Vertex AI Agent Engine in production (D7). |
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

- **Frontend to backend:** same-origin `/api/*` through the web app, so the session cookie (httpOnly, Secure, SameSite=Lax) works without CORS. Chat and the notification bell use server-sent events, sent with `Cache-Control: no-cache, no-transform` (`STREAM_HEADERS`) so the web app does not gzip them: gzip holds small events in its buffer. The bell reconnects after a dropped stream (an API restart, a deploy, Cloud Run's request timeout) and polls every 30 seconds only while it is down. When someone opens an `/api/*` address in the address bar (a document navigation), the proxy (`web/src/proxy.ts`) checks the API's answer first: 401 goes to sign-in, 403 and 404 show the `/problem` page instead of raw JSON. Those routes resolve the signed-in user in their own short transaction (`stream_user`), so an open tab does not keep a transaction (or a lock on the sign-in tables) open. Every other route has one transaction per request (`Db` in `app/api/deps.py`), committed when the route returns and before the response is sent (`scope="function"`): a client acting on a 2xx at once, such as the page loaded straight after sign-in, always finds the data saved, and a failed commit is a 500, never a false success.
- **Backend to database:** SQLAlchemy async with asyncpg. In Cloud Run the connection goes through the Cloud SQL connector socket in `DATABASE_URL`. Migrations (Alembic) run when the API container starts, so staging migrates before production.
- **Agent to services:** tools call the same `app/services/` functions as the API; the model never writes to the database directly and never names an assignee (D2).
- **External services:** Google OAuth (sign-in, redadair.com.au only), Gemini (AI Studio key, or Vertex AI by config), ZeptoMail or Gmail API (D32), Cloudflare DNS for the production domain (D35).

## Data

Tables in schema `app` (models in `backend/app/models/entities.py`, migrations in `backend/alembic/versions/`):

| Table | Purpose |
| --- | --- |
| `projects`, `digital_staff`, `routing_rules` | The catalogue, people who can be assigned, admin overrides |
| `feedback` | One row per item: classification, status (nine values), assignee, developer brief, context, dates |
| `feedback_messages` | Chat transcript, replies, internal notes, progress updates, follow-ups |
| `feedback_events` | Append-only audit and routing training signal; `is_public` drives the tracker |
| `feedback_followers` | Staff who added "+1 and comment" |
| `attachments` | Files and their extracted text |
| `feedback_embeddings` | pgvector embeddings for duplicate search |
| `notifications`, `notification_mutes` | The bell and its emails (title and body masked, then cut to 300 characters); per-item mutes |
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

1. **Submitting:** chat message (PII masked) → agent classifies and fills the draft → confirm card → Confirm (draft hash) → `submit_feedback` saves the item, attachments, transcript and events → router assigns → Awaiting approval (or Needs review, or Acknowledged for praise) → notifications.
2. **Approving and working:** Admin approves or declines → owner starts work, posts updates and an Expected by date, resolves with a public note → every public change is an event the tracker shows, and a notification in the app and by email.
3. **Friday release:** drafter collects the week's resolved items, public progress and channel notes → owner ticks and edits → publishes → What's new, contributors notified.
