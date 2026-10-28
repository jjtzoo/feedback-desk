"""How a resolved item ends (D92). The person who raised it answers Is it fixed? on the tracker or from
the email: Yes, close it ends it as Fixed; I still have an issue reopens it to In progress with the same
owner, while it is Resolved or for REOPEN_DAYS after it closed. If they say nothing, the worker sends one
reminder after RESOLVED_REMINDER_DAYS and closes it as Fixed by System after RESOLVED_AUTO_CLOSE_DAYS.
Digital Staff can't close a resolved item; an Admin can, with a reason (console.close)."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.errors import Conflict, Forbidden, NotFound, ServiceError
from app.models import Feedback, FeedbackEvent, FeedbackMessage
from app.models.entities import stamp
from app.services import console, events, notifications
from app.services.actors import SYSTEM, User
from app.services.feedback import day_text, is_following, load, reopen_until, sees_in_full
from app.services.privacy import mask

BATCH = 100


async def _load_for_submitter(db: AsyncSession, user: User, ref_no: str) -> Feedback:
    """Only the person who raised it closes or reopens it; followers see the stage."""
    fb = await load(db, ref_no=ref_no)
    if fb.submitter_email != user.email:
        if sees_in_full(user, fb) or await is_following(db, user, fb):
            raise Forbidden("Only the person who raised it can answer this.")
        raise NotFound("We can't find that feedback.")
    return fb


async def confirm_fixed(db: AsyncSession, user: User, ref_no: str) -> Feedback:
    """Yes, close it: the item ends as Fixed, by the person who raised it."""
    fb = await _load_for_submitter(db, user, ref_no)
    if fb.status != "resolved":
        raise Conflict("not_resolved", "This isn't waiting for you to confirm a fix.")
    await console.close_fixed(db, fb, user.actor, "submitter")
    return await load(db, feedback_id=fb.id)


async def still_an_issue(db: AsyncSession, user: User, ref_no: str, body: str) -> Feedback:
    """I still have an issue: what is still wrong goes on the item and it goes back to In progress with
    the same owner, who is told. A file follows through the tracker's usual upload."""
    fb = await _load_for_submitter(db, user, ref_no)
    if not body.strip():
        raise ServiceError("empty", "Say what is still wrong.")
    if fb.status == "closed" and fb.ending == "fixed":
        status_events = list(
            await db.scalars(
                select(FeedbackEvent).where(FeedbackEvent.feedback_id == fb.id, FeedbackEvent.event_type == "status")
            )
        )
        if reopen_until(fb, status_events) is None:
            days = get_settings().reopen_days
            raise Conflict(
                "reopen_window",
                f"It closed more than {days} days ago. Send it as new feedback and mention {fb.ref_no}.",
            )
    elif fb.status != "resolved":
        raise Conflict("not_resolved", "This isn't waiting for you to confirm a fix. Reply instead.")
    message_id = uuid.uuid4()
    db.add(
        FeedbackMessage(
            id=message_id,
            feedback_id=fb.id,
            author_type="staff",
            author_email=user.email,
            author_name=user.name,
            message_type="follow_up",
            body=mask(body.strip())[:4000],
            created_at=stamp(),
        )
    )
    events.log(
        db,
        fb.id,
        user.actor,
        "status",
        before={"status": fb.status, "ending": fb.ending},
        after={"status": "in_progress", "by": "submitter", "reopened": True},
        public_text=f"Reopened: {user.name} still has an issue",
    )
    fb.status, fb.ending, fb.close_reason, fb.resolved_at = "in_progress", None, None, None
    fb.submitter_replied_at = fb.updated_at = datetime.now(UTC)
    await notifications.notify_assignee(
        db,
        fb,
        type="reopened",
        title=f"{fb.ref_no} reopened: {user.name} still has an issue",
        body=body.strip(),
        actor_email=user.email,
        message_id=message_id,
        step="Reopened",
    )
    await db.flush()
    return await load(db, feedback_id=fb.id)


async def run_clock(db: AsyncSession, now: datetime | None = None) -> tuple[int, int]:
    """The worker's pass over resolved items (D33, D92): close those resolved RESOLVED_AUTO_CLOSE_DAYS
    ago as Fixed by System, then remind once those resolved RESOLVED_REMINDER_DAYS ago. The reminder is
    a `reminded` event, so it goes once even when the person has muted the item. Returns (closed, reminded)."""
    settings = get_settings()
    now = now or datetime.now(UTC)
    due_close = list(
        await db.scalars(
            select(Feedback)
            .where(
                Feedback.status == "resolved",
                Feedback.resolved_at <= now - timedelta(days=settings.resolved_auto_close_days),
            )
            .order_by(Feedback.resolved_at)
            .limit(BATCH)
            .with_for_update(skip_locked=True)
        )
    )
    for row in due_close:
        await console.close_fixed(db, await load(db, feedback_id=row.id), SYSTEM, "system")

    reminded = exists().where(
        and_(
            FeedbackEvent.feedback_id == Feedback.id,
            FeedbackEvent.event_type == "reminded",
            FeedbackEvent.created_at >= Feedback.resolved_at,
        )
    )
    due_remind = list(
        await db.scalars(
            select(Feedback)
            .where(
                Feedback.status == "resolved",
                Feedback.resolved_at <= now - timedelta(days=settings.resolved_reminder_days),
                ~reminded,
            )
            .order_by(Feedback.resolved_at)
            .limit(BATCH)
            .with_for_update(skip_locked=True)
        )
    )
    for fb in due_remind:
        assert fb.resolved_at is not None  # selected as resolved
        closes = day_text((fb.resolved_at + timedelta(days=settings.resolved_auto_close_days)).date())
        await notifications.ask_is_it_fixed(
            db,
            fb,
            title=f"Is {fb.ref_no} fixed?",
            body=f"It closes as fixed on {closes} unless you say you still have an issue.",
            actor_email=None,
            followers=False,
        )
        events.log(db, fb.id, SYSTEM, "reminded", after={"days": settings.resolved_reminder_days})
    await db.flush()
    return len(due_close), len(due_remind)
