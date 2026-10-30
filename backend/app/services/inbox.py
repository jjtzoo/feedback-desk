"""The console Inbox (D105, D114): the items people are talking on, newest message first. A
conversation is the messages after intake: the reporter's replies, the team's replies, updates and
internal notes (not the chat with Sig, not system lines). Waiting on me is an open item whose newest
message the reporter can see came from the reporter, and is mine to answer: I hold it, or it waits
for a decision and I'm an Admin. Counted in Python from one read of each table, like the dashboard."""

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.errors import ServiceError
from app.models import Feedback, FeedbackMessage
from app.models.enums import APPROVAL_STATUSES, OPEN_STATUSES
from app.services.actors import User
from app.services.console import require_digital, unread_items

VIEWS = ("waiting", "mine", "all")
# The newest conversations shown in a view; the total says how many there are.
SHOWN = 100


@dataclass
class Row:
    item: Feedback
    last: FeedbackMessage
    waiting: bool
    unread: bool = False


def _on_me(user: User, fb: Feedback) -> bool:
    if fb.assignee_id is not None and fb.assignee_id == user.staff_id:
        return True
    return user.is_admin and fb.status in APPROVAL_STATUSES


async def _rows(db: AsyncSession, user: User) -> list[Row]:
    """Every item with a conversation, with its newest message and whether it waits on this person."""
    talk = select(FeedbackMessage).where(
        FeedbackMessage.message_type != "chat", FeedbackMessage.author_type.in_(("staff", "digital"))
    )
    messages = list(await db.scalars(talk.order_by(FeedbackMessage.created_at)))
    last: dict[uuid.UUID, FeedbackMessage] = {}
    last_public: dict[uuid.UUID, FeedbackMessage] = {}
    for m in messages:
        last[m.feedback_id] = m
        if not m.is_internal:
            last_public[m.feedback_id] = m
    if not last:
        return []
    items = await db.scalars(
        select(Feedback)
        .options(selectinload(Feedback.project), selectinload(Feedback.assignee))
        .where(Feedback.id.in_(list(last)))
    )
    rows = []
    for fb in items:
        public = last_public.get(fb.id)
        waiting = (
            fb.status in OPEN_STATUSES and public is not None and public.author_type == "staff" and _on_me(user, fb)
        )
        rows.append(Row(fb, last[fb.id], waiting))
    rows.sort(key=lambda r: r.last.created_at, reverse=True)
    return rows


def _in(view: str, user: User, row: Row) -> bool:
    if view == "waiting":
        return row.waiting
    if view == "mine":
        return row.item.assignee_id is not None and row.item.assignee_id == user.staff_id
    return True


async def inbox(db: AsyncSession, user: User, view: str) -> tuple[list[Row], int, dict[str, int]]:
    """The rows of one view (newest first, at most SHOWN), its total and every view's count."""
    require_digital(user)
    if view not in VIEWS:
        raise ServiceError("bad_filter", "Unknown inbox view.")
    rows = await _rows(db, user)
    counts = {v: sum(_in(v, user, r) for r in rows) for v in VIEWS}
    shown = [r for r in rows if _in(view, user, r)][:SHOWN]
    unread = await unread_items(db, user, [r.item for r in shown])
    for r in shown:
        r.unread = r.item.id in unread
    return shown, counts[view], counts


async def waiting_count(db: AsyncSession, user: User) -> int:
    return sum(r.waiting for r in await _rows(db, user))
