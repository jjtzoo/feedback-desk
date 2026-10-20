# Company standard: Developer Handover and Technical User Manual

Digest of the rules in Darlene Antonette Duran's manual (REDADAIR engineering standard), for
day-to-day use. The PDF is the authority; section numbers point into it. How this project
applies each rule is noted in brackets.

## Documentation (§1, §15 to §17)
- Keep README.md, CLAUDE.md and `docs/architecture.md` accurate and update them in the same change as the code.
- README: what it does, technologies, structure, required software, install, environment setup, run, test, build, deploy, requirements, warnings.
- CLAUDE.md: purpose, framework, folder structure, architecture, conventions, database, dependencies, how to run, tests, deployment, restrictions, project decisions.
- architecture.md: frontend, backend, database, external services, environment configuration, deployment architecture, cloud services, key data flows, what uses Redis and Prisma (here: neither).

## Source code and Git (§6 to §8, §11)
- Keep the codebase clean: no unused files, imports, functions or variables; no debugging statements, experimental code, outdated comments, hard-coded configuration or secrets.
- Never change `main` (or the stable branch) directly. One branch per focused change; name it by type (`feat/`, `fix/`, `ui/`, `db/`, `infra/`, `deps/`, `perf/`, `security/`, `spike/`). Start from the latest stable branch.
- Test every change before merging; have it reviewed by another developer (here: Marc). Delete branches once merged.
- `.gitignore` keeps secrets and local-only files out of the repository.

## Deployment configuration (§9 to §14, §25, §26, §32 to §37)
- `.gcloudignore` excludes local env files, Git files, local dependencies, temporary files, logs and development-only files from the deployment source. It is not secret management.
- A YAML file describes the Cloud Run deployment; review it with the deploy scripts; never put secrets in it; check it targets the right project, service, region, image and environment.
- Deployment files work together: `deploy.sh`, `deploy.ps1`, `.gcloudignore`, YAML, `.env.example`, per-environment configuration.
- Before deploying, confirm: branch, Google Cloud project, Cloud Run service, Artifact Registry repository, image, database, environment variables available, no secrets exposed, `.gitignore` not hiding needed files, YAML pointing at the intended environment, production configuration not used for staging.
- Source change: rebuild the image. Configuration-only change: update the Cloud Run revision configuration without rebuilding.

## Environments (§18, §19)
- Separate local, staging and production: databases, services, variables and supporting resources. Local development uses staging configuration, never production.
- Confirm the target environment before any run, deployment or database operation; make sure staging variables never point at production resources.

## Database (§20 to §24)
- Treat PostgreSQL data as persistent: plan changes, check what existing data a migration affects, test migrations in a safe environment first, take special care with drops, renames and type changes.
- Access production data through the SQL proxy only after confirming which instance you are on.
- The schema definition is the reference for how data is stored [here: SQLAlchemy models and Alembic, not Prisma].

## Frontend (§28, §30)
- Use shadcn/ui components and icons; reuse an existing component before creating a new one; change shared components carefully.
- The Impeccable skill may help with design; review its output against the project's design system and requirements.

## Dependencies, secrets, costs (§31, §35, §38)
- Check whether an existing dependency can do the job before adding one; keep the dependency record (`requirements.txt` where used) current; test dependency changes.
- Never hard-code secrets, bake them into images, or print them in build, deploy or application logs.
- Know which cloud resources exist, which environment each belongs to and why; review costs regularly; remove unused staging resources safely; never touch production resources because they look idle.

## Working with Claude (§29, §36)
- Claude is an assistant, not an authority. Review AI-generated code against the actual code, schema, documentation and deployment requirements.
- Before building, inspect the existing implementation; never assume a table, endpoint, package or folder exists. The person approving a change owns it.
