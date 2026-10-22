"""Put the browser-test database back to the seed: no feedback, references from FB-0001 again.

    uv run python -m scripts.e2e_reset

Each Playwright spec file runs this first (web/e2e/fixtures.ts), so files never depend on each
other. Only the `fd_e2e` database is touched. Sign-in sessions are kept, so windows a spec has
already opened stay signed in.
"""

import asyncio
import os

from scripts.e2e_server import E2E_DATABASE
from scripts.local_db import start

# Every table that holds test data; the same set the backend tests clear (tests/conftest.py),
# except user_sessions.
TABLES = (
    "feedback_events, feedback_messages, feedback_followers, attachments, feedback_embeddings, "
    "notification_mutes, notifications, release_items, releases, project_messages, feedback, "
    "routing_rules, projects, digital_staff, user_preferences, job_runs, model_usage"
)


async def reset() -> None:
    from sqlalchemy import text

    from app.db import dispose_engine, session_scope
    from app.seed import seed_all

    async with session_scope() as db:
        # An open page's notification stream holds a transaction for the moment it writes an event
        # (it once held one for as long as the page was open; e2e/FINDINGS.md). End any such one, in
        # this database only, so TRUNCATE never waits; that page's bell then polls every 30 s.
        await db.execute(text("SET LOCAL lock_timeout = '15s'"))
        await db.execute(
            text(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname = current_database() AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'"
            )
        )
        tables = ", ".join(f"app.{t.strip()}" for t in TABLES.split(","))
        await db.execute(text(f"TRUNCATE {tables} CASCADE"))
        await db.execute(text("ALTER SEQUENCE app.feedback_ref_seq RESTART WITH 1"))
        await seed_all(db)
    await dispose_engine()


def main() -> None:
    os.environ["DATABASE_URL"] = start(database=E2E_DATABASE)
    asyncio.run(reset())


if __name__ == "__main__":
    main()
