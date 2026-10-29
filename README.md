[2026-40 Feedback Desk: Project Hub (Evernote)](https://share.evernote.com/note/2657f749-5e19-6129-0a05-bdd4da4a3b86)

# 2026-40 Feedback Desk

A chat-style agent where any REDADAIR staff member gives feedback on the intranet's platforms and agents, plus a console where the Digital team approves, works and closes it. Staff track every item like a parcel.

- **Project documents:** [Project Hub draft](docs/project-hub.md), [requirements reference](docs/requirements.md)
- **Spec (source of truth):** [docs/feedback-build-spec-v3.md](docs/feedback-build-spec-v3.md) (decisions D1 to D104, sprints, gates, build status)
- **How it fits together:** [docs/architecture.md](docs/architecture.md)
- **Deploying:** [docs/deployment.md](docs/deployment.md) (checklists, rollback)
- **Company standards it follows:** [docs/standards/](docs/standards/)
- **Brand:** the app shows as Smoke Signal with Sig, its assistant, while D37 is open (the intranet tile stays Feedback). Assets: `web/public/brand/`; plan: [docs/design/smoke-signal-integration.md](docs/design/smoke-signal-integration.md)

## Status

Built and tested locally on the stub model, and checked against Gemini; **nothing is deployed**. Not done yet:

- **Google Cloud:** there is no project yet, so the deploy scripts, Cloud Run YAML, worker job and scheduler are written but have never run, and there is no staging or production (asks 1 and 9 in the spec).
- **Google sign-in** needs the OAuth client (ask 2); the local sign-in picker stands in.
- **Email** goes to Mailpit locally; the provider is still open (D32).
- **People** are placeholders until the real Digital Staff list arrives (ask 6).
- **Pilot and launch** (Sprint 4) have not started.

What is built, area by area: the spec's Build status.

## Main technologies

| Part | Technology |
| --- | --- |
| Web app | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, shadcn/ui, Lucide icons |
| API | Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2 (async), Alembic, uv |
| Agent | Google ADK 2.12 with Gemini 3.8 Flash, 3.1 Flash-Lite as the cheaper fallback (AI Studio key, or Vertex AI by config); a scripted stub model until the key arrives |
| Data | PostgreSQL + pgvector (Docker locally, Cloud SQL in the cloud) |
| Cloud | Google Cloud australia-southeast1: Cloud Run, Cloud SQL, Cloud Storage, Secret Manager, Artifact Registry, Cloud Scheduler |
| Not used | Redis, Prisma, RAG Engine, Cloud Spanner, MCP servers |

## Project structure

```
backend/        API (app/), agent package (agent/), migrations, seed data, tests, evals
web/            Next.js app: src/app/(staff)/ for staff, src/app/console/ for the Digital team
deploy/         Cloud Run YAML templates and per-environment settings (no secrets)
db/init/        Database bootstrap (schemas app and adk, vector extension)
docs/           Spec, architecture, deployment runbook, standards, design mockups
deploy.sh, deploy.ps1, compose.yml, .env.example, .gcloudignore
```

## Required software

Docker Desktop, uv, Node 22 (local Node 24 also works), Git, and the gcloud CLI for anything in Google Cloud.

## Set up and run (local)

```bash
cp .env.example .env
docker compose --profile dev up --build
docker compose exec api python -m app.seed
```

Open http://localhost:3000. Sign in with the local development picker (placeholder people from `backend/seed/`); Mailpit shows every email at http://localhost:8025. API docs: http://localhost:8001/api/docs.

Without Docker, one command starts the API and the web app in the same terminal; Ctrl+C stops both:

```powershell
.\dev.ps1
```

```bash
./dev.sh
```

(`dev.ps1` on Windows, `dev.sh` on macOS and Linux.) The script runs `uv run python -m scripts.dev_server` in `backend` and `npm run dev` in `web`, installs the web packages on the first run, and stops early if port 8001 or 3000 is already taken. The API then runs on port 8001 with a throwaway Postgres (`pgserver`), the stub model and email off. Port 8000 is left free for other local apps.

## Resolved items

A Resolved item asks the person who raised it Is it fixed? (D92). If they don't answer, the worker sends one reminder after `RESOLVED_REMINDER_DAYS` (3) and closes it as Fixed after `RESOLVED_AUTO_CLOSE_DAYS` (7); they can still reopen it with I still have an issue for `REOPEN_DAYS` (14) after it closes. All three are in `.env.example`. Under Docker Compose the `worker` service runs it; `dev.ps1` and `dev.sh` don't start the worker, so nothing reminds or closes by itself there.

## Switching on the real agent

The stub model keeps everything working without a key. To use Gemini, load the AI Studio key from Secret Manager into the shell (never into a file) and restart the API (the secret exists once the Google Cloud project does):

```bash
export GOOGLE_API_KEY="$(gcloud secrets versions access latest --secret=feedback-staging-google-api-key)"
```

For Vertex AI instead, set `GOOGLE_GENAI_USE_ENTERPRISE=true`, `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION` in `.env` and run `gcloud auth application-default login`. `/api/health` shows which model is in use.

The chat's duplicate check looks at open items and at items fixed in the last `DUPLICATE_FIXED_DAYS` (183 by default, 0 for open items only); a match that was fixed before is linked to the new report as a possible regression (D73).

## Test

```bash
cd backend && uv run ruff check . && uv run mypy && uv run pytest
cd backend && uv run python -m evals.run_routing      # 40-item routing set in its own fresh local database; the gate is judged on Gemini
cd backend && uv run python -m evals.run_conversations  # 98 conversation cases judged turn by turn, in their own fresh local database (Gemini)
cd web && npm run lint && npm run build
cd web && npm run test:e2e:full                       # browser tests (Playwright) of the manual checklist, in shards at the same time
cd web && npx playwright test e2e/03-chat.spec.ts     # one spec file
cd web && npm run test:e2e:coverage                   # which checklist items have a test -> web/e2e/COVERAGE.md, docs/testing/feature-evidence.md
cd web && npm run test:e2e:mutation -- 04              # shows each test of section 4 fails when its key assertion is broken
```

Backend tests need no Docker: they start a throwaway Postgres 16 + pgvector, or use `TEST_DATABASE_URL`.

Browser tests start their own API (port 8002, `backend/scripts/e2e_server.py`, with a supervisor on 8012 that restarts it without a model for S06) and web build (port 3100) on a separate `fd_e2e` database with the scripted stub model, so they never touch the servers on 8001 and 3000. The full run (`web/e2e/shards.mjs`) builds the web app once and splits the spec files into shards (2 by default, `E2E_SHARDS` changes it), each with its own API, web server and `fd_e2e_<n>` database on ports 87n2, 37n0 and 87n9, then merges their reports so the coverage step reads one result. First time only: `cd web && npx playwright install chromium`. Rules for writing them, and the bugs they found: `web/e2e/CLAUDE.md`, `web/e2e/FINDINGS.md`.

## Build and deploy

Images are built from `backend/` and `web/`, pushed to Artifact Registry and deployed to Cloud Run by `./deploy.sh staging|production` (or `.\deploy.ps1`). `staging` deploys from the `staging` branch, production from `main` through a no-traffic candidate revision. Follow [docs/deployment.md](docs/deployment.md) every time. None of this has run yet: it waits for the Google Cloud project. CI (`.github/workflows/ci.yml`) runs the checks on every pull request and push; its deploy jobs stay off until the repository variable `GCP_PROJECT_ID` is set.

## Important rules and limitations

- Company code stays in the company GitHub organisation; never in personal repositories.
- Never commit to `main`; one branch per change; Marc reviews every pull request.
- No secrets in code, `.env.example`, YAML or images; they live in Secret Manager.
- Local development uses staging-like configuration, never production resources.
- Still waiting on IT (spec "Asks to Chris"): Google Cloud projects, the Google OAuth client, the AI Studio key, the email provider, branch protection on the GitHub repository, and the real Digital Staff list. Until then the local stand-ins in D23 are used.
- Open decisions: D31 (PostgreSQL 16 or 17) and D32 (Gmail API or ZeptoMail).
