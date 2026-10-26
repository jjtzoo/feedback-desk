[2026-40 Feedback Desk: Project Hub (Evernote)](https://share.evernote.com/note/2657f749-5e19-6129-0a05-bdd4da4a3b86)

# 2026-40 Feedback Desk

A chat-style agent where any REDADAIR staff member gives feedback on the intranet's platforms and agents, plus a console where the Digital team approves, works and closes it. Staff track every item like a parcel.

- **Project documents:** [Project Hub draft](docs/project-hub.md), [requirements reference](docs/requirements.md)
- **Spec (source of truth):** [docs/feedback-build-spec-v3.md](docs/feedback-build-spec-v3.md) (decisions D1 to D35, sprints, gates)
- **How it fits together:** [docs/architecture.md](docs/architecture.md)
- **Deploying:** [docs/deployment.md](docs/deployment.md) (checklists, rollback)
- **Company standards it follows:** [docs/standards/](docs/standards/)
- **Brand:** the app shows as Smoke Signal with Sig, its assistant, on the `ui/smoke-signal-brand` branch while D37 is open (the intranet tile stays Feedback). Assets: `web/public/brand/`; plan: [docs/design/smoke-signal-integration.md](docs/design/smoke-signal-integration.md)

## Main technologies

| Part | Technology |
| --- | --- |
| Web app | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, shadcn/ui, Lucide icons |
| API | Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2 (async), Alembic, uv |
| Agent | Google ADK 2.12 with Gemini 3.1 Flash-Lite, 2.5 Flash as fallback (AI Studio key, or Vertex AI by config); a scripted stub model until the key arrives |
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

## Switching on the real agent

The stub model keeps everything working without a key. To use Gemini, load the AI Studio key from Secret Manager into the shell (never into a file) and restart the API:

```bash
export GOOGLE_API_KEY="$(gcloud secrets versions access latest --secret=feedback-staging-google-api-key)"
```

For Vertex AI instead, set `GOOGLE_GENAI_USE_ENTERPRISE=true`, `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION` in `.env` and run `gcloud auth application-default login`. `/api/health` shows which model is in use.

## Test

```bash
cd backend && uv run ruff check . && uv run mypy && uv run pytest
cd backend && uv run python -m evals.run_routing      # 40-item routing set; the gate is judged on Gemini
cd backend && uv run python -m evals.run_conversations  # 32 behaviour checks (follow-ups, misuse, privacy, no tool named, how people write)
cd backend && uv run python -m evals.run_conversations --set pressure  # 45 hostile and malformed conversations
cd web && npm run lint && npm run build
cd web && npm run test:e2e                            # browser tests (Playwright) of the manual checklist
cd web && npm run test:e2e:coverage                   # which checklist items have a test -> web/e2e/COVERAGE.md, docs/testing/feature-evidence.md
cd web && npm run test:e2e:mutation -- 04              # shows each test of section 4 fails when its key assertion is broken
```

Backend tests need no Docker: they start a throwaway Postgres 16 + pgvector, or use `TEST_DATABASE_URL`.

Browser tests start their own API (port 8002, `backend/scripts/e2e_server.py`, with a supervisor on 8012 that restarts it without a model for S06) and web build (port 3100) on a separate `fd_e2e` database with the scripted stub model, so they never touch the servers on 8001 and 3000. First time only: `cd web && npx playwright install chromium`. Rules for writing them, and the bugs they found: `web/e2e/CLAUDE.md`, `web/e2e/FINDINGS.md`.

## Build and deploy

Images are built from `backend/` and `web/`, pushed to Artifact Registry and deployed to Cloud Run by `./deploy.sh staging|production` (or `.\deploy.ps1`). `staging` deploys from the `staging` branch, production from `main` through a no-traffic candidate revision. Follow [docs/deployment.md](docs/deployment.md) every time. CI (`.github/workflows/ci.yml`) runs the checks on every pull request.

## Important rules and limitations

- Company code stays in the company GitHub organisation; never in personal repositories.
- Never commit to `main`; one branch per change; Marc reviews every pull request.
- No secrets in code, `.env.example`, YAML or images; they live in Secret Manager.
- Local development uses staging-like configuration, never production resources.
- Still waiting on IT (spec "Asks to Chris"): Google Cloud projects, the Google OAuth client, the AI Studio key, the email provider, the GitHub repository, and the real Digital Staff list. Until then the local stand-ins in D23 are used.
- Open decisions: D31 (PostgreSQL 16 or 17) and D32 (Gmail API or ZeptoMail).
