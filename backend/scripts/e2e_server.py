"""The API for the browser tests (web/e2e): its own port and database, the scripted stub model, no email.

    uv run python -m scripts.e2e_server

Playwright starts this itself (web/playwright.config.ts). It recreates the `fd_e2e` database on
every start, so the data you click through by hand (database "feedback", port 8001) is never touched.
Port 8000 belongs to another local app; this never uses it.
"""

import asyncio
import os
import tempfile

import uvicorn

from scripts.local_db import start

E2E_DATABASE = "fd_e2e"
E2E_PORT = 8002


def main() -> None:
    # Set, not setdefault: these must win over anything in .env (a real GOOGLE_API_KEY above all).
    os.environ.update(
        {
            "DATABASE_URL": start(database=E2E_DATABASE, fresh=True),
            "APP_ENV": "local",
            "DEV_LOGIN": "true",
            "ALLOWED_DOMAINS": "redadair.com.au,redadair.example",
            "APP_BASE_URL": os.environ.get("E2E_WEB_URL", "http://localhost:3100"),
            "MODEL_PROVIDER": "stub",
            "GOOGLE_API_KEY": "",
            "GOOGLE_GENAI_USE_ENTERPRISE": "false",
            "GOOGLE_GENAI_USE_VERTEXAI": "false",
            "EMAIL_BACKEND": "off",
            # Tests open many chats as the same person; the hourly limit has its own backend test.
            "CHAT_SESSIONS_PER_USER_PER_HOUR": "1000",
            "STORAGE_DIR": os.path.join(tempfile.gettempdir(), "feedback-e2e-files"),
        }
    )

    from alembic.config import Config

    from alembic import command
    from app.seed import run as seed

    command.upgrade(Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini")), "head")
    asyncio.run(seed())
    uvicorn.run("app.main:app", host="127.0.0.1", port=E2E_PORT)


if __name__ == "__main__":
    main()
