# Standards this project follows

| Source | Owner | Digest | Applied in |
| --- | --- | --- | --- |
| Feedback Project Brief (2026-10-19) | Marc, Team Lead AI Engineer; signed by Chris, IT Director | The brief itself governs scope; see `../feedback-build-spec-v3.md` | The spec (decisions D1 to D35) |
| Developer Handover and Technical User Manual | Darlene Antonette Duran | [developer-handover.md](developer-handover.md) | Spec D24 to D26; CLAUDE.md; README; `../architecture.md` |
| Application Deployment and Infrastructure Manual | Darlene Antonette Duran | [deployment-infrastructure.md](deployment-infrastructure.md) | Spec D27 to D35; `../deployment.md`; `deploy/`, `deploy.sh`, `deploy.ps1` |

Order of authority: the project brief for scope and architecture; the two manuals for everything
the brief doesn't settle. Conflicts are recorded as **OPEN** decisions in the spec and raised
with Marc (currently D31, PostgreSQL version, and D32, email provider).

The original PDFs are kept by the team, not in this repository. When a manual changes, update its
digest here in the same change.
