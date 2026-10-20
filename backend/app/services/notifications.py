"""In-app notifications and email for the same event (brief §4.6, D11).

Every notification is a row; the bell reads the rows, and the worker sends each row's email.
The person who caused an event is never notified about it, and a muted item stays quiet.
"""

import uuid
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import DigitalStaff, Feedback, FeedbackFollower, Notification, NotificationMute

KEEP_DAYS = 90


def tracker_link(fb: Feedback) -> str:
    return f"/track/{fb.ref_no}"


def console_link(fb: Feedback) -> str:
    return f"/console?item={fb.ref_no}"


async def notify(
    db: AsyncSession,
    recipients: Iterable[str],
    *,
    type: str,
    title: str,
    link: str,
    body: str = "",
    feedback_id: uuid.UUID | None = None,
    actor_email: str | None = None,
) -> int:
    emails = {e.lower() for e in recipients if e} - {(actor_email or "").lower()}
    if feedback_id is not None and emails:
        muted = set(
            await db.scalars(
                select(NotificationMute.recipient_email).where(
                    NotificationMute.feedback_id == feedback_id, NotificationMute.recipient_email.in_(emails)
                )
            )
        )
        emails -= muted
    email_status = "skipped" if get_settings().email_backend == "off" else "queued"
    for email in sorted(emails):
        db.add(
            Notification(
                recipient_email=email,
                feedback_id=feedback_id,
                type=type,
                title=title[:300],
                body=body,
                link=link,
                email_status=email_status,
            )
        )
    return len(emails)


async def submitters(db: AsyncSession, fb: Feedback) -> list[str]:
    """The person who raised it plus everyone who added "+1 and comment"."""
    followers = await db.scalars(select(FeedbackFollower.email).where(FeedbackFollower.feedback_id == fb.id))
    return [fb.submitter_email, *followers]


async def notify_submitters(
    db: AsyncSession, fb: Feedback, *, type: str, title: str, body: str = "", actor_email: str | None = None
) -> int:
    return await notify(
        db,
        await submitters(db, fb),
        type=type,
        title=title,
        body=body,
        link=tracker_link(fb),
        feedback_id=fb.id,
        actor_email=actor_email,
    )


async def notify_assignee(
    db: AsyncSession, fb: Feedback, *, type: str, title: str, body: str = "", actor_email: str | None = None
) -> int:
    if fb.assignee_id is None:
        return 0
    staff = await db.get(DigitalStaff, fb.assignee_id)
    if staff is None:
        return 0
    return await notify(
        db,
        [staff.google_email],
        type=type,
        title=title,
        body=body,
        link=console_link(fb),
        feedback_id=fb.id,
        actor_email=actor_email,
    )


async def admin_emails(db: AsyncSession) -> list[str]:
    return list(
        await db.scalars(
            select(DigitalStaff.google_email).where(DigitalStaff.role == "admin", DigitalStaff.active.is_(True))
        )
    )


async def triage_lead_emails(db: AsyncSession) -> list[str]:
    leads = list(
        await db.scalars(
            select(DigitalStaff.google_email).where(
                DigitalStaff.is_triage_lead.is_(True), DigitalStaff.active.is_(True)
            )
        )
    )
    return leads or await admin_emails(db)


# --- the bell -----------------------------------------------------------------------


async def list_for(db: AsyncSession, email: str, limit: int = 30) -> tuple[list[Notification], int]:
    since = datetime.now(UTC) - timedelta(days=KEEP_DAYS)
    rows = list(
        await db.scalars(
            select(Notification)
            .where(Notification.recipient_email == email, Notification.created_at >= since)
            .order_by(Notification.created_at.desc())
            .limit(limit)
        )
    )
    return rows, await unread_count(db, email)


async def unread_count(db: AsyncSession, email: str) -> int:
    since = datetime.now(UTC) - timedelta(days=KEEP_DAYS)
    return int(
        await db.scalar(
            select(func.count())
            .select_from(Notification)
            .where(
                Notification.recipient_email == email,
                Notification.read_at.is_(None),
                Notification.created_at >= since,
            )
        )
        or 0
    )


async def latest_id(db: AsyncSession, email: str) -> str | None:
    newest = await db.scalar(
        select(Notification.id)
        .where(Notification.recipient_email == email)
        .order_by(Notification.created_at.desc())
        .limit(1)
    )
    return str(newest) if newest else None


async def mark_read(db: AsyncSession, email: str, ids: list[uuid.UUID] | None) -> None:
    query = update(Notification).where(Notification.recipient_email == email, Notification.read_at.is_(None))
    if ids:
        query = query.where(Notification.id.in_(ids))
    await db.execute(query.values(read_at=datetime.now(UTC)))


async def set_mute(db: AsyncSession, email: str, feedback_id: uuid.UUID, muted: bool) -> None:
    await db.execute(
        delete(NotificationMute).where(
            NotificationMute.recipient_email == email, NotificationMute.feedback_id == feedback_id
        )
    )
    if muted:
        db.add(NotificationMute(recipient_email=email, feedback_id=feedback_id))


async def is_muted(db: AsyncSession, email: str, feedback_id: uuid.UUID) -> bool:
    return (
        await db.scalar(
            select(NotificationMute.feedback_id).where(
                NotificationMute.recipient_email == email, NotificationMute.feedback_id == feedback_id
            )
        )
    ) is not None


async def prune(db: AsyncSession) -> None:
    await db.execute(
        delete(Notification).where(Notification.created_at < datetime.now(UTC) - timedelta(days=KEEP_DAYS))
    )
