"""The in-app bell (brief §4.6): a list, read state, and a live stream over server-sent events.
The page falls back to polling every 30 seconds if the stream drops."""

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Cookie, Query, Request
from fastapi.responses import Response
from sse_starlette.sse import EventSourceResponse

from app.api.deps import STREAM_HEADERS, CurrentUser, Db, StreamUser
from app.db import session_scope
from app.models import Notification
from app.models.enums import STAGE_OF
from app.schemas import NotificationHistoryOut, NotificationOut, NotificationsOut, ReadIn
from app.services import auth, notifications

router = APIRouter(tags=["notifications"])
STREAM_CHECK_SECONDS = 3


def _out(n: Notification) -> NotificationOut:
    return NotificationOut.model_validate(n).model_copy(
        update={
            "item_status": n.feedback.status,
            "item_stage": STAGE_OF[n.feedback.status],
            "item_ending": n.feedback.ending,
            "reference": n.feedback.ref_no,
        }
        if n.feedback
        else {}
    )


@router.get("/notifications", response_model=NotificationsOut)
async def list_notifications(db: Db, user: CurrentUser) -> NotificationsOut:
    rows, unread = await notifications.list_for(db, user.email)
    return NotificationsOut(items=[_out(n) for n in rows], unread=unread)


@router.get("/notifications/history", response_model=NotificationHistoryOut)
async def notification_history(db: Db, user: CurrentUser, page: int = Query(1, ge=1)) -> NotificationHistoryOut:
    rows, more = await notifications.history(db, user.email, page)
    return NotificationHistoryOut(items=[_out(n) for n in rows], more=more)


@router.post("/notifications/clear", status_code=204)
async def clear(db: Db, user: CurrentUser) -> Response:
    await notifications.clear(db, user.email)
    return Response(status_code=204)


@router.post("/notifications/read", status_code=204)
async def read(body: ReadIn, db: Db, user: CurrentUser) -> Response:
    await notifications.mark_read(db, user.email, body.ids)
    return Response(status_code=204)


@router.get("/notifications/stream")
async def stream(
    request: Request, user: StreamUser, fb_session: Annotated[str | None, Cookie()] = None
) -> EventSourceResponse:
    """Sends {"unread": n} whenever the bell changes: a new notification, or one settled or updated
    in place (D54, D55). Checks Postgres (no Redis, D26), and the sign-in each time: signing out,
    or a revoked or expired session, ends the stream."""

    async def events() -> AsyncIterator[dict[str, str]]:
        last: str | None = "start"
        while not await request.is_disconnected():
            async with session_scope() as db:
                signed_in = await auth.user_for_session(db, fb_session) is not None
            if not signed_in:
                return
            unread: int | None = None
            async with session_scope() as db:
                state = await notifications.bell_state(db, user.email)
                if state != last:
                    last = state
                    unread = await notifications.unread_count(db, user.email)
            if unread is not None:  # sent outside any transaction, so an open tab holds nothing
                yield {"event": "unread", "data": json.dumps({"unread": unread})}
            await asyncio.sleep(STREAM_CHECK_SECONDS)

    return EventSourceResponse(events(), ping=15, headers=STREAM_HEADERS)
