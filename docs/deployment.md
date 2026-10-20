# Deploying Feedback

The runbook for staging and production on Google Cloud, following the company deployment manual
(`docs/standards/deployment-infrastructure.md`) and spec v3 D25 to D35. Resource names, IAM roles
and APIs are listed in `docs/architecture.md`. **Confirm the environment before every step.**

## Environments and branches

| Environment | Branch | Settings | Secrets |
| --- | --- | --- | --- |
| Staging | `staging` | `deploy/staging.env` | Secret Manager `feedback-staging-*` |
| Production | `main` | `deploy/production.env` | Secret Manager `feedback-production-*` |

Work happens on short-lived branches, merges to `staging` after review, is verified on staging, then merges to `main`. The scripts refuse to deploy any other branch to an environment.

## First-time setup (per environment; needs Chris, asks 1, 2, 9, 10)

1. Pick the Google Cloud project and fill the REPLACE values in `deploy/<env>.env`.
2. Enable the APIs listed in `docs/architecture.md` in that project.
3. Create the Artifact Registry Docker repository `feedback` in australia-southeast1.
4. Cloud SQL (version per D31): create the database `feedback_<env>` and its user; apply `db/init/01-schemas.sql` once (schemas `app` and `adk`, extension `vector`).
5. Create the private bucket `redadair-feedback-<env>-files` (uniform access, no public access).
6. Create the service accounts and grant only the roles in `docs/architecture.md`.
7. Create the secrets (values typed into Secret Manager, never into files or chat):
   `feedback-<env>-database-url` (`postgresql+asyncpg://USER:PASSWORD@/feedback_<env>?host=/cloudsql/PROJECT:australia-southeast1:INSTANCE`),
   `-secret-key` (48+ random characters), `-google-api-key`, `-oauth-client-secret`, `-smtp-password`, `-job-token`.
8. Google OAuth client (Web application) in the same project: authorised redirect URI `<APP_BASE_URL>/api/auth/google/callback`; restrict the consent screen to the Workspace (internal).
9. Email (D32): ZeptoMail sending domain verified with its DNS records in Cloudflare, sender `noreply@<domain>`, the SMTP API key stored as `-smtp-password`. Or the Gmail API path in `docs/architecture.md`.
10. Production domain (D35): Cloud Run domain mapping for `feedback-web-production`, then add the TXT and CNAME records it gives you in Cloudflare; set `APP_BASE_URL` to the domain. Staging never gets this domain.

## Deploying

```bash
git switch staging && git pull
./deploy.sh staging                 # or: .\deploy.ps1 staging
```

The script checks the branch and a clean tree, shows the project, region, services, images, database and bucket, asks you to type the environment name, builds and pushes `feedback-api` and `feedback-web` tagged `<env>-<git sha>`, renders the YAML into `deploy/rendered/<env>/` (git-ignored) and applies it, updates the worker job and its every-minute schedule, then checks health.

- **Configuration-only change** (a setting, not code): `./deploy.sh <env> --config-only` re-applies the YAML with the images already running; no rebuild (handover manual §37).
- **Production:** run from `main`. The new revisions get no traffic and a `candidate` tag; the script checks the API candidate's health and that the web candidate loads, then asks before moving traffic. It prints the rollback commands.
- **Migrations** run when the API container starts, so staging migrates first. Check what a migration does to existing data before merging it.

## Rolling back

Move traffic back to the previous revision (the script prints the exact names):

```bash
gcloud run services update-traffic feedback-api-production --to-revisions PREVIOUS_REVISION=100 --project PROJECT --region australia-southeast1
gcloud run services update-traffic feedback-web-production --to-revisions PREVIOUS_REVISION=100 --project PROJECT --region australia-southeast1
```

A migration that already ran is not undone by moving traffic; plan reversible migrations, and restore from backup only through the approved production procedure.

## Pre-deployment checklist (deployment manual §47)

- [ ] Right branch for the environment; everything committed, reviewed and tested (CI green)
- [ ] `.env.example` and `deploy/<env>.env` reflect the configuration; staging and production separated
- [ ] No secrets committed; secrets exist in Secret Manager for this environment
- [ ] Google Cloud project, Artifact Registry repository, region (australia-southeast1), image name and tag confirmed
- [ ] Labels present (project, environment, application, owner, purpose, deployment-type)
- [ ] Cloud Run service, region and revision plan confirmed; CPU, memory and timeout reviewed (D29)
- [ ] Database: right instance and database, PostgreSQL version (D31), migration reviewed
- [ ] Required APIs enabled; IAM roles checked; external credentials (OAuth, email, Gemini) correct
- [ ] Production only: domain mapping and DNS checked; staging verified first

## Post-deployment verification (deployment manual §45)

- [ ] The intended Cloud Run services and job were updated, with new revisions
- [ ] The revisions run the expected image tag
- [ ] `/api/health`: database ok, migration current, model credentials set, environment correct
- [ ] Sign in with Google (and a non-redadair account is refused)
- [ ] Send one test item through the chat; it reaches the owner and the Approvals queue
- [ ] An email for that event arrives (and shows in ZeptoMail's activity log)
- [ ] A file upload works and opens through its signed link
- [ ] Production: the domain reaches `feedback-web-production`, not staging
- [ ] Only then is the deployment done; note it in the changelog

## Costs (handover manual §38, deployment manual §15)

Monthly: review Cloud Run, Cloud SQL, Storage, Artifact Registry and Gemini spend per environment (labels make this a filter); delete old staging images and unused staging resources after confirming nothing uses them; never remove production resources because they look idle. LLM cost per conversation is logged; the target is under AUD 0.05 per item.
