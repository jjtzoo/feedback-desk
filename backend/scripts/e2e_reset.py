"""Put the browser-test database back to the seed: no feedback, references from FB-0001 again.

    uv run python -m scripts.e2e_reset
    uv run python -m scripts.e2e_reset usage [--email E] [--tokens N] [--cost AUD] [--month-start] | --clear

Each Playwright spec file runs this first (web/e2e/fixtures.ts), so files never depend on each
other. The tests ask the running test API's supervisor (scripts/e2e_server.py) to do it, which skips
starting Python and the database each time; the command line above does the same by itself. Only the
test database is touched (`fd_e2e`, or E2E_DATABASE). Sign-in sessions are kept, so windows a spec has
already opened stay signed in. `usage` adds the model usage the stub model never records, so the
spend-limit tests (checklist S22) can reach a limit; `--clear` removes only the rows it added.
"""

import argparse
import asyncio
import os
import sys
import uuid
from collections.abc import Callable, Coroutine
from functools import partial
from typing import Any

from scripts.e2e_server import E2E_DATABASE
from scripts.local_db import start

# Every table that holds test data; the same set the backend tests clear (tests/conftest.py),
# except user_sessions.
TABLES = (
    "feedback_events, feedback_messages, feedback_followers, attachments, feedback_embeddings, "
    "notification_mutes, notifications, release_items, releases, project_messages, feedback, "
    "routing_rules, projects, digital_staff, user_preferences, job_runs, model_usage"
)
# Model and session of the usage rows the browser tests add.
SEEDED = "e2e-seeded"


async def reset() -> None:
    from sqlalchemy import text

    from app.db import session_scope
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


async def add_usage(email: str | None, tokens: int, cost: float, month_start: bool) -> None:
    """One chat usage row: a person's tokens today, or (no email) spend toward the budgets."""
    from datetime import UTC, datetime, timedelta
    from zoneinfo import ZoneInfo

    from app.config import get_settings
    from app.db import session_scope
    from app.models.entities import ModelUsage

    row = ModelUsage(
        id=uuid.uuid4(),
        user_email=email,
        session_id=SEEDED,
        kind="chat",
        model=SEEDED,
        calls=1,
        input_tokens=tokens,
        output_tokens=0,
        cost_aud=cost,
    )
    if month_start:  # a minute into this month, as the usage service counts months (usage.period_starts)
        local = datetime.now(UTC).astimezone(ZoneInfo(get_settings().timezone))
        month = local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        row.created_at = (month + timedelta(minutes=1)).astimezone(UTC)
    async with session_scope() as db:
        db.add(row)


async def clear_usage() -> None:
    # DELETE, not TRUNCATE, so it never waits on an open notification stream.
    from sqlalchemy import delete

    from app.db import session_scope
    from app.models.entities import ModelUsage

    async with session_scope() as db:
        await db.execute(delete(ModelUsage).where(ModelUsage.session_id == SEEDED))


def _arguments() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="scripts.e2e_reset")
    commands = parser.add_subparsers(dest="command")
    usage = commands.add_parser("usage", help="add a chat usage row, or --clear the ones added")
    usage.add_argument("--email")
    usage.add_argument("--tokens", type=int, default=0)
    usage.add_argument("--cost", type=float, default=0)
    usage.add_argument("--month-start", action="store_true", help="dated at the start of this month, not now")
    usage.add_argument("--clear", action="store_true")
    return parser


def run(argv: list[str]) -> None:
    """The command these arguments name, on the database DATABASE_URL points at."""
    from sqlalchemy.exc import DBAPIError

    args = _arguments().parse_args(argv)
    command: Callable[[], Coroutine[Any, Any, None]]
    if args.command != "usage":
        command = reset
    elif args.clear:
        command = clear_usage
    else:
        command = partial(add_usage, args.email, args.tokens, args.cost, args.month_start)
    # A write still in flight from the last spec can deadlock with TRUNCATE, and Postgres cancels one
    # side; if it is this one, the second try finds the tables free.
    for attempt in (1, 2):
        try:
            asyncio.run(_released(command()))
            return
        except DBAPIError as exc:
            if attempt == 2 or "deadlock detected" not in str(exc):
                raise


async def _released(work: Coroutine[Any, Any, None]) -> None:
    """Run one command, then let go of the engine even if it failed: the supervisor keeps this process,
    and a pool left over from a failed run holds connections of a closed event loop, which failed every
    later reset of that shard."""
    from app.db import dispose_engine

    try:
        await work
    finally:
        await dispose_engine()


def main() -> None:
    os.environ["DATABASE_URL"] = start(database=E2E_DATABASE)
    run(sys.argv[1:])


if __name__ == "__main__":
    main()
