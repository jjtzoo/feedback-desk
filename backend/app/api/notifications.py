"""The in-app bell (brief §4.6): a list, read state, and a live stream over server-sent events.
The page falls back to polling every 30 seconds if the stream drops."""

import asyncio
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Request
from fastapi.responses import Response
from sse_starlette.sse import EventSourceResponse

from app.api.deps import CurrentUser, Db
from app.db import session_scope
from app.schemas import NotificationOut, NotificationsOut, ReadIn
from app.services import notifications

router = APIRouter(tags=["notifications"])
STREAM_CHECK_SECONDS = 3


@router.get("/notifications", response_model=NotificationsOut)
async def list_notifications(db: Db, user: CurrentUser) -> NotificationsOut:
    rows, unread = await notifications.list_for(db, user.email)
    return NotificationsOut(items=[NotificationOut.model_validate(n) for n in rows], unread=unread)


@router.post("/notifications/read", status_code=204)
async def read(body: ReadIn, db: Db, user: CurrentUser) -> Response:
    await notifications.mark_read(db, user.email, body.ids)
    return Response(status_code=204)


@router.get("/notifications/stream")
async def stream(request: Request, user: CurrentUser) -> EventSourceResponse:
    """Sends {"unread": n} whenever something new arrives. Checks Postgres (no Redis, D26)."""

    async def events() -> AsyncIterator[dict[str, str]]:
        last: str | None = "start"
        while not await request.is_disconnected():
            async with session_scope() as db:
                newest = await notifications.latest_id(db, user.email)
                if newest != last:
                    last = newest
                    unread = await notifications.unread_count(db, user.email)
                    yield {"event": "unread", "data": json.dumps({"unread": unread})}
            await asyncio.sleep(STREAM_CHECK_SECONDS)

    return EventSourceResponse(events(), ping=15)
