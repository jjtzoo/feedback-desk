"""A throwaway Postgres 16 + pgvector for running the backend or tests without Docker.

Uses the `pgserver` dev dependency. Prints a DATABASE_URL for the given database:

    uv run python -m scripts.local_db            # database "feedback"
    uv run python -m scripts.local_db --stop

Docker Compose remains the supported way to run the stack (spec, "Local setup").
"""

import argparse
from pathlib import Path

import pgserver
from sqlalchemy.engine import make_url

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DATA_DIR = BACKEND_DIR / ".localdb"
INIT_SQL = (BACKEND_DIR.parent / "db" / "init" / "01-schemas.sql").read_text()


def start(data_dir: Path = DEFAULT_DATA_DIR, database: str = "feedback", fresh: bool = False) -> str:
    """Start (or reuse) the server, make sure `database` exists with its schemas, return an asyncpg URL."""
    server = pgserver.get_server(data_dir, cleanup_mode=None)
    exists = server.psql(f"SELECT 1 FROM pg_database WHERE datname = '{database}';")
    if fresh and "(1 row)" in exists:
        server.psql(f'DROP DATABASE "{database}" WITH (FORCE);')
        exists = ""
    if "(1 row)" not in exists:
        server.psql(f'CREATE DATABASE "{database}";')
    # On Linux and macOS the URI names a Unix socket in its query (?host=/path), so swap the database
    # by parsing rather than by splitting on "/".
    url = make_url(server.get_uri()).set(database=database)
    _run_init(url.render_as_string(hide_password=False))
    return url.set(drivername="postgresql+asyncpg").render_as_string(hide_password=False)


def _run_init(uri: str) -> None:
    import asyncio

    import asyncpg

    async def run() -> None:
        conn = await asyncpg.connect(uri)
        try:
            await conn.execute(INIT_SQL)
        finally:
            await conn.close()

    asyncio.run(run())


def stop(data_dir: Path = DEFAULT_DATA_DIR) -> None:
    pgserver.get_server(data_dir, cleanup_mode="stop").cleanup()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", default="feedback")
    parser.add_argument("--fresh", action="store_true", help="drop and recreate the database")
    parser.add_argument("--stop", action="store_true")
    args = parser.parse_args()
    if args.stop:
        stop()
    else:
        print(start(database=args.database, fresh=args.fresh))
