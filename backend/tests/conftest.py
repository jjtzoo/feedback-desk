"""Test setup: a real Postgres 16 + pgvector (TEST_DATABASE_URL, or a local pgserver), migrated
with Alembic and seeded; the stub model; no email; dev sign-in for the seeded people."""

import os
import tempfile
from collections.abc import AsyncIterator
from typing import Any

import pytest

if not os.environ.get("TEST_DATABASE_URL"):
    from scripts.local_db import start

    os.environ["TEST_DATABASE_URL"] = start(database="fd_test", fresh=True)

os.environ.update(
    {
        "DATABASE_URL": os.environ["TEST_DATABASE_URL"],
        "APP_ENV": "test",
        "MODEL_PROVIDER": "stub",
        "APP_BASE_URL": "http://testserver",
        "GOOGLE_API_KEY": "",
        "GOOGLE_GENAI_USE_ENTERPRISE": "false",
        "DEV_LOGIN": "true",
        "ALLOWED_DOMAINS": "redadair.com.au,redadair.example",
        "EMAIL_BACKEND": "smtp",
        "STORAGE_BACKEND": "local",
        "STORAGE_DIR": tempfile.mkdtemp(prefix="fb-test-files-"),
        "JOB_TOKEN": "test-job-token",
    }
)

import httpx
from alembic.config import Config
from sqlalchemy import text

from alembic import command
from app import agent_runtime
from app.api.chat import session_limiter
from app.config import get_settings
from app.db import session_scope
from app.main import app

get_settings.cache_clear()

STAFF = "sam.lee@redadair.example"
STAFF2 = "priya.nair@redadair.example"
MARC = "marc@redadair.example"  # Admin, triage lead
CHRIS = "chris@redadair.example"  # Admin, access requests
DARLENE = "darlene@redadair.example"  # Digital Staff, owns RAKE Agent
MARIO = "mario@redadair.example"  # Digital Staff, owns CPD Tracker


@pytest.fixture(scope="session", autouse=True)
def migrated() -> None:
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.attributes["database_url"] = os.environ["DATABASE_URL"]
    command.upgrade(cfg, "head")


@pytest.fixture(autouse=True)
async def clean_db(migrated: None) -> AsyncIterator[None]:
    """Every test starts with the seed and no feedback."""
    from app.seed import seed_all

    async with session_scope() as db:
        await db.execute(
            text(
                "TRUNCATE app.feedback_events, app.feedback_messages, app.feedback_followers, app.attachments, "
                "app.feedback_embeddings, app.notification_mutes, app.item_reads, app.notifications, "
                "app.release_items, app.releases, "
                "app.project_messages, app.feedback, app.routing_rules, app.projects, app.digital_staff, "
                "app.user_sessions, app.user_preferences, app.job_runs, app.model_usage CASCADE"
            )
        )
        await db.execute(text("ALTER SEQUENCE app.feedback_ref_seq RESTART WITH 1"))
        await seed_all(db)
    session_limiter.reset()
    agent_runtime.reset()
    get_settings.cache_clear()
    yield


async def signed_in(email: str) -> httpx.AsyncClient:
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
    r = await client.post("/api/auth/dev/sign-in", json={"email": email})
    assert r.status_code == 204, r.text
    return client


@pytest.fixture
async def staff() -> AsyncIterator[httpx.AsyncClient]:
    c = await signed_in(STAFF)
    yield c
    await c.aclose()


@pytest.fixture
async def marc() -> AsyncIterator[httpx.AsyncClient]:
    c = await signed_in(MARC)
    yield c
    await c.aclose()


@pytest.fixture
async def darlene() -> AsyncIterator[httpx.AsyncClient]:
    c = await signed_in(DARLENE)
    yield c
    await c.aclose()


@pytest.fixture
async def anon() -> AsyncIterator[httpx.AsyncClient]:
    c = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
    yield c
    await c.aclose()


def parse_sse(body: str) -> list[tuple[str, dict[str, Any]]]:
    import json

    events: list[tuple[str, dict[str, Any]]] = []
    for block in body.replace("\r\n", "\n").split("\n\n"):
        name, data = "message", None
        for line in block.split("\n"):
            if line.startswith("event:"):
                name = line[6:].strip()
            elif line.startswith("data:"):
                data = line[5:].strip()
        if data is not None:
            events.append((name, json.loads(data)))
    return events


def first(events: list[tuple[str, dict[str, Any]]], name: str) -> dict[str, Any] | None:
    return next((d for e, d in events if e == name), None)


def texts(events: list[tuple[str, dict[str, Any]]]) -> list[str]:
    return [d["text"] for e, d in events if e == "message"]


async def start_chat(client: httpx.AsyncClient, project: str | None = None, **context: str) -> str:
    r = await client.post("/api/chat/sessions", json={"project_slug": project, "context": context})
    assert r.status_code == 200, r.text
    assert r.json()["mode"] == "chat"
    return str(r.json()["session_id"])


async def say(
    client: httpx.AsyncClient, sid: str, text: str, files: list[str] | None = None
) -> list[tuple[str, dict[str, Any]]]:
    r = await client.post(f"/api/chat/sessions/{sid}/messages", json={"text": text, "attachment_ids": files or []})
    assert r.status_code == 200, r.text
    return parse_sse(r.text)


async def submit_via_chat(
    client: httpx.AsyncClient, message: str, answers: list[str] | None = None, project: str | None = None
) -> dict[str, Any]:
    """Run a whole conversation: describe, answer questions until the card shows, confirm."""
    sid = await start_chat(client, project)
    events = await say(client, sid, message)
    for answer in answers or []:
        if first(events, "draft"):
            break
        events = await say(client, sid, answer)
    card = first(events, "draft")
    assert card is not None, texts(events)
    r = await client.post(f"/api/chat/sessions/{sid}/confirm", json={"draft_hash": card["hash"]})
    done = first(parse_sse(r.text), "done")
    assert done is not None, r.text
    return done
