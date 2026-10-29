# Feedback

Staff feedback agent and management system for REDADAIR. Staff tell a chat agent about any intranet platform or agent; the agent classifies it, writes a developer brief, and code routes it to the project owner; an Admin approves or declines; Digital Staff work it on a board; staff follow it on a parcel-style tracker.

## Read first
- The user's instructions override the rules in this file and in any project's CLAUDE.md.

- **Spec (source of truth):** `docs/feedback-build-spec-v3.md`: decisions D1 to D35, sprints, gates. The master copy lives in `C:\Users\Jacob Toledo\Documents\`; keep the two in sync. v1 and v2 are history only.
- **Authority:** Marc's project brief governs scope and architecture; Darlene's two company manuals govern everything the brief doesn't settle. Digests: `docs/standards/` (developer-handover.md, deployment-infrastructure.md). Where they conflict, record an OPEN decision in the spec and tell the user; never pick silently.
- **Architecture:** `docs/architecture.md`. **Deployment:** `docs/deployment.md` (checklists).

## Stack

- Backend `backend/`: Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2 (async) + Alembic, PostgreSQL + pgvector (version per D31), uv. Business rules in `app/services/`; routers in `app/api/` stay thin.
- Agent `backend/agent/`: Google ADK, one LlmAgent with tools `list_projects`, `update_draft`, `find_duplicates`, `submit_feedback`; Gemini 3.8 Flash (3.1 Flash-Lite fallback, D36) via AI Studio key, Vertex AI by config; a scripted stub model until the key arrives (D8, D23). Separate package so it can deploy to Agent Engine; never import FastAPI there.
- Frontend `web/`: Next.js (App Router) + React + TypeScript + Tailwind + shadcn/ui (D16). Staff area `/` (landing) and `/chat`, console `/console`. Calls the API only.
- Not used: Redis, Prisma, RAG Engine, Cloud Spanner, MCP servers (D26, D34).
- Google Cloud australia-southeast1: Cloud Run (services for api and web, a job for the worker), Cloud SQL, Cloud Storage, Secret Manager, Artifact Registry, Cloud Scheduler (D29, D30, D33).

## Run and test

- Docker: `cp .env.example .env`, `docker compose --profile dev up --build`, `docker compose exec api python -m app.seed`.
- Without Docker: `.\dev.ps1` (Windows) or `./dev.sh` starts both in one terminal, Ctrl+C stops both; separately: `cd backend && uv run python -m scripts.dev_server` (API on 8001, dev sign-in on, stub model), `cd web && npm run dev`. Port 8000 belongs to another local app; don't kill it.
- Checks before any merge: `cd backend && uv run ruff check . && uv run mypy && uv run pytest`; `cd web && npm run build`.
- Browser tests (Playwright, own database, stub model): one spec while working on a feature, `cd web && npx playwright test e2e/<file>` (ports 8002/3100, or `E2E_API_PORT`/`E2E_WEB_PORT`/`E2E_CONTROL_PORT` in a second worktree); the whole suite at the end of a batch and before merging into `main`, `cd web && npm run test:e2e:full` (shards at the same time, each with its own servers and database, ports 87n2/37n0/87n9; `E2E_SHARDS` sets how many), then `npm run test:e2e:coverage`. Their rules are in `web/e2e/CLAUDE.md`; app bugs they find go in `web/e2e/FINDINGS.md`, never fixed inside a test change. Agent changes also run `uv run python -m evals.run_routing` (gate 85 % project, 85 % work type, 80 % assignee on Gemini).

## Rules for every change

- Company code and files stay in the company GitHub org and approved storage; never personal or private repos (D27).
- Work on feature branches cut from main, named by type (`feat/`, `fix/`, `ui/`, `db/`, `infra/`, `deps/`). Push feature branches after significant changes; main is the working branch until staging and production exist (D28).
- Roles are checked server-side on every call; staff see their own items in full and others' only as general information, with names hidden (D97); the model never names an assignee (D1, D2); nothing saves without the confirm card (D12).
- No secrets in code, `.env.example`, YAML, images or logs; secrets come from Secret Manager (D13). Mask PII before storing.
- Every schema change is an Alembic revision; check what existing data it affects.
- Keep the codebase clean: no unused code, debug leftovers, hard-coded config or temporary files. Check an existing dependency before adding one; regenerate `backend/requirements.txt` from `uv.lock` when dependencies change.
- Inspect the real code, schema and docs before building; never assume a table, endpoint, package or folder exists.
- Update README, `docs/architecture.md`, `docs/deployment.md` and the spec in the same change when behaviour, config or deployment changes.
- Deployments: confirm the environment first; run the pre-deployment checklist and post-deployment verification in `docs/deployment.md`; production is never a test environment.

## UI

Visual direction D17: modern and red-led (landing page mockup D, everything else mockup E; `docs/design/mockups/directions-red.html`). Use shadcn/ui components; load the `fire-services-ui` skill for its structure and accessibility rules, but follow D17 for colour and type until the skill is updated. Mobile first, keyboard-usable, AA contrast, status never by colour alone. Light theme only (D48); the chat fills the page and Sig moves only while it writes (D49).
Brand assets (Puff logo, icons, Sig) live in `web/public/brand/`; wiring and rules: `docs/design/smoke-signal-integration.md` (D37, open).

## Not part of this project

`crumb/` and `ticketing app.md` (a separate bakery app). Leave them alone.
