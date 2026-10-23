"""Server-sent-event routes stay open as long as the page is, so they must not hold a database
transaction while they stream: each open tab would pin a pooled connection and keep share locks
that block migrations on the sign-in tables. They also tell the web app's proxy not to gzip them,
or the events would wait in the compressor's buffer."""

import asyncio
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx
from sqlalchemy import text

from app.db import session_scope
from app.main import app
from tests.conftest import start_chat


@asynccontextmanager
async def streaming(
    client: httpx.AsyncClient, method: str, path: str, body: Any = None
) -> AsyncIterator[dict[str, str]]:
    """Drive the app over raw ASGI and hold the response at its first event (httpx's
    ASGITransport only returns once the stream ends). Yields the response headers; disconnects on exit."""
    payload = json.dumps(body).encode() if body is not None else b""
    first_event, release = asyncio.Event(), asyncio.Event()
    status: list[int] = []
    headers: dict[str, str] = {}
    sent_request = False

    async def receive() -> dict[str, Any]:
        nonlocal sent_request
        if not sent_request:
            sent_request = True
            return {"type": "http.request", "body": payload, "more_body": False}
        await release.wait()
        return {"type": "http.disconnect"}

    async def send(message: dict[str, Any]) -> None:
        if message["type"] == "http.response.start":
            status.append(message["status"])
            headers.update((k.decode().lower(), v.decode()) for k, v in message["headers"])
        elif message["type"] == "http.response.body" and message.get("body"):
            first_event.set()
            await release.wait()

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "root_path": "",
        "query_string": b"",
        "headers": [
            (b"host", b"testserver"),
            (b"content-type", b"application/json"),
            (b"cookie", f"fb_session={client.cookies['fb_session']}".encode()),
        ],
        "client": ("testclient", 50000),
        "server": ("testserver", 80),
    }
    task = asyncio.create_task(app(scope, receive, send))
    try:
        await asyncio.wait_for(first_event.wait(), 10)
        assert status == [200]
        yield headers
    finally:
        release.set()
        await asyncio.wait_for(task, 10)


async def assert_sign_in_tables_unlocked() -> None:
    """A migration's lock on the sign-in tables goes through while the stream is open."""
    async with session_scope() as db:
        await db.execute(text("SET LOCAL lock_timeout = '2s'"))
        await db.execute(text("LOCK TABLE app.user_sessions, app.digital_staff IN ACCESS EXCLUSIVE MODE"))


async def test_notification_stream_holds_no_transaction(darlene: httpx.AsyncClient) -> None:
    async with streaming(darlene, "GET", "/api/notifications/stream"):
        await assert_sign_in_tables_unlocked()


async def test_chat_stream_holds_no_transaction(staff: httpx.AsyncClient) -> None:
    sid = await start_chat(staff)
    async with streaming(staff, "POST", f"/api/chat/sessions/{sid}/messages", {"text": "Hello", "attachment_ids": []}):
        await assert_sign_in_tables_unlocked()


async def test_streams_tell_the_web_proxy_not_to_compress(staff: httpx.AsyncClient, darlene: httpx.AsyncClient) -> None:
    async with streaming(darlene, "GET", "/api/notifications/stream") as bell:
        assert "no-transform" in bell["cache-control"]
    sid = await start_chat(staff)
    async with streaming(
        staff, "POST", f"/api/chat/sessions/{sid}/messages", {"text": "Hello", "attachment_ids": []}
    ) as chat:
        assert "no-transform" in chat["cache-control"]
