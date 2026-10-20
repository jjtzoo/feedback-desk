# Company standard: Application Deployment and Infrastructure Manual

Digest of the rules in Darlene Antonette Duran's manual (REDADAIR engineering standard). The PDF
is the authority; section numbers point into it. How this project applies each rule is noted
in brackets.

## Source code (§2)
- All changes go through Git and the company GitHub organisation, with meaningful commit messages.
- **Company code, files, documents, configuration and credentials never go to personal or private GitHub accounts or other personal storage.** Without access, request it; don't work around it.
- Branches separate work from stable versions; document which branch deploys to which environment [here: `staging` to staging, `main` to production].

## Configuration and scripts (§3, §4)
- `.env.example` documents every variable without real values; real values never in code or Git.
- Staging and production have separate configuration; check variables before each deployment.
- Deployment scripts (Bash and PowerShell) state the environment and resources they target and the variables they need, and never print secrets. Review changes before scripts commit or push.

## Images and Artifact Registry (§5 to §7)
- Build an image, name and version it, push it to Artifact Registry, deploy that image to Cloud Run.
- Verify image location (region), repository, project ID, name and version before deploying.
- Consistent names for images and resources; labels on every resource that supports them: project, environment, application, owner, purpose, deployment type.

## Cloud Run (§8 to §15)
- Services for request-serving apps; jobs for tasks that run and finish.
- Pick the region deliberately and document it; keep related services in the same region where possible.
- Staging uses staging variables and resources; production uses production variables and resources; they never share configuration by accident.
- Use revisions: know the current and new revision before shifting production traffic, so you can roll back.
- Starting values, reviewed against real load: min 0, max 1 instance; 1 CPU; 512 MB; request timeout set from the app's real processing time; request-based billing; monitor usage and cost.

## Scheduler, database, storage (§16 to §21)
- Document every Cloud Scheduler task: what it triggers, how often, and what receives it.
- Cloud SQL PostgreSQL 17.9 in australia-southeast1 is the identified standard; separate staging and production databases; connection details from environment variables; production changed only through approved procedures.
- Cloud Storage buckets named by project and environment.

## RAG Engine, agents, MCP (§22 to §31)
- RAG Engine with corpora fed from Cloud Storage, Drive or uploads; embeddings model 002; Cloud Spanner vector store; document the architecture once chosen.
- Agents follow the Google ADK structure, kept simple and documented (purpose of each agent and tool).
- MCP servers exposed over the internet run on Cloud Run with their own deployment configuration and proper authentication.
[This project uses none of RAG Engine, Spanner or MCP; duplicate search uses pgvector.]

## APIs, credentials, IAM (§32 to §36)
- Enable required Google Cloud APIs in the correct project before troubleshooting API errors.
- OAuth and application credentials belong to the right project and environment.
- Document each external API: platform, API, credentials, environment, permissions, limits; separate staging and production credentials where possible.
- IAM least privilege for people and service accounts; document the roles so they can be recreated.

## Domains and email (§37 to §44)
- Custom domains: Cloud Run domain mapping plus the DNS records in Cloudflare; only production gets the production domain; verify service, project, revision and DNS before changing it.
- Transactional email through ZeptoMail (Zoho) from a noreply address on the approved domain; verify the domain's DNS; document the protocol (SMTP or API) and which environment may send; keep credentials out of Git; monitor delivery and review email activity after changing email features.

## Verification and checklist (§45 to §48)
- After deploying, verify: right service and revision, right image, app starts, variables correct, database connects, APIs and external services work, domain reaches the right service, features work. Only then is it done.
- Pre-deployment checklist: branch, everything committed and tested, `.env.example` current, environments separated, no secrets in GitHub, project, registry, region, image name and version, labels, service, Cloud Run region, revision, CPU and memory, timeout, database, PostgreSQL version, APIs, IAM, external credentials, production domain, test after deploying.
- Production is never a test environment. Treat sizes, regions, instance counts, billing, database layout and storage as project decisions, not defaults. Update the deployment documentation whenever the deployment changes.
