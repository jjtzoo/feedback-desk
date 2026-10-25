"""Run the API without Docker: local Postgres (pgserver), migrations, seed, then Uvicorn.

    uv run python -m scripts.dev_server

Uses the stub model unless .env sets GOOGLE_API_KEY or Vertex AI. Emails are not sent
(no Mailpit); read sign-in links from app.email_outbox, or use Docker Compose.
"""

import asyncio
import os

import uvicorn

from scripts.local_db import start


def main() -> None:
    os.environ["DATABASE_URL"] = start(database="feedback")
    os.environ.setdefault("APP_ENV", "local")
    os.environ.setdefault("DEV_LOGIN", "true")
    os.environ.setdefault("ALLOWED_DOMAINS", "redadair.com.au,redadair.example")
    os.environ.setdefault("APP_BASE_URL", "http://localhost:3000")
    os.environ.setdefault("EMAIL_BACKEND", "off")

    from alembic.config import Config

    from alembic import command
    from app.seed import run as seed

    command.upgrade(Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini")), "head")
    asyncio.run(seed())
    # Longer than the web proxy's idle time, so the API never closes a connection the proxy is about to reuse.
    uvicorn.run("app.main:app", host="127.0.0.1", port=int(os.environ.get("PORT", "8001")), timeout_keep_alive=620)


if __name__ == "__main__":
    main()
