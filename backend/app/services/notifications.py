"""In-app notifications and email for the same event (brief §4.6, D11).

Every notification is a row; the bell reads the rows, and the worker sends each row's email.
The person who caused an event is never notified about it, and a muted item stays quiet.
Title and body are masked here, before they are stored or emailed (brief §5.5), and cut only
after masking so a card number split at the cut cannot slip through.

A notification that asks for an action settles once anyone takes it: it turns read for everyone
who got it and says what happened instead (D54). Each Admin has one standing "N items waiting
for your approval" row, updated in place and gone at zero (D55).

Each row about an item carries its step in a word or two ("Approved", "Fixed"): the bell shows
one row per item with the steps as a trail (D78). Links open the item where the news is: the
console panel on the message, the tracker at its Latest update (D81).
"""

import uuid
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.models import DigitalStaff, Feedback, FeedbackFollower, Notification, NotificationMute
from app.models.enums import APPROVAL_STATUSES
from app.services.privacy import mask

KEEP_DAYS = 90
MAX_CHARS = 300

# Notifications that ask for an action, by the action that settles them (D54).
DECIDE = ("approval_p1", "flagged")  # an Admin approves or declines
START = ("assigned", "approved")  # the assignee starts work, or the item changes hands
ANSWER = ("ask_info",)  # the person asked replies
ASKS = DECIDE + START + ANSWER
# The standing approvals count (bell only) and the daily approvals email (email only, D55).
APPROVALS_WAITING = "approvals_waiting"
EMAIL_ONLY = ("approvals_summary",)
# The step each kind of notification stands for; stage notifications name their own (D78).
STEPS = {
    "assigned": "Assigned",
    "approval_p1": "Needs approval",
    "flagged": "Flagged",
    "approved": "Approved",
    "due_moved": "Due date moved",
    "ask_info": "Question",
    "praise": "Thanks",
    "plus_one": "Reported again",
    "submitter_reply": "Reply",
    "taken_over": "Taken over",
    "handed_over": "Handed over",
    "progress": "Update",
    "reply": "Reply",
    "mention": "Mention",
}


# Asks the person who raised a resolved item whether it's fixed; its email carries the two answers (D92).
IS_IT_FIXED = "is_it_fixed"


def tracker_link(fb: Feedback, latest: bool = False) -> str:
    """The staff tracker; at its Latest update when that is the news."""
    return f"/track/{fb.ref_no}" + ("#latest" if latest else "")


async def ask_is_it_fixed(
    db: AsyncSession, fb: Feedback, *, title: str, body: str, actor_email: str | None, followers: bool = True
) -> None:
    """The person who raised it is asked Is it fixed?; followers hear the stage, since only the person
    who raised it closes or reopens it (D92). The worker's reminder goes to the person who raised it only."""
    await notify(
        db,
        [fb.submitter_email],
        type=IS_IT_FIXED,
        title=title,
        body=body,
        link=f"/track/{fb.ref_no}#is-it-fixed",
        feedback_id=fb.id,
        actor_email=actor_email,
        step="Resolved",
    )
    if not followers:
        return
    await notify(
        db,
        (await submitters(db, fb))[1:],
        type="stage",
        title=title,
        body=body,
        link=tracker_link(fb, latest=True),
        feedback_id=fb.id,
        actor_email=actor_email,
        step="Resolved",
    )


def console_link(fb: Feedback, message_id: uuid.UUID | None = None, tab: str | None = None) -> str:
    """The item's panel; on its Activity tab at one message when the news is a message."""
    if message_id:
        return f"/console?item={fb.ref_no}&tab=activity&msg={message_id}"
    return f"/console?item={fb.ref_no}" + (f"&tab={tab}" if tab else "")


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
    step: str | None = None,
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
    title, body = mask(title)[:MAX_CHARS], mask(body)[:MAX_CHARS]
    for email in sorted(emails):
        db.add(
            Notification(
                recipient_email=email,
                feedback_id=feedback_id,
                type=type,
                title=title,
                body=body,
                link=link,
                email_status=email_status,
                step=step or (STEPS.get(type) if feedback_id else None),
            )
        )
    return len(emails)


async def submitters(db: AsyncSession, fb: Feedback) -> list[str]:
    """The person who raised it plus everyone who added "+1 and comment"."""
    followers = await db.scalars(select(FeedbackFollower.email).where(FeedbackFollower.feedback_id == fb.id))
    return [fb.submitter_email, *followers]


async def notify_submitters(
    db: AsyncSession,
    fb: Feedback,
    *,
    type: str,
    title: str,
    body: str = "",
    actor_email: str | None = None,
    step: str | None = None,
    latest: bool = False,
) -> int:
    """Everyone who raised it, merged duplicates included: merging makes their people followers."""
    return await notify(
        db,
        await submitters(db, fb),
        type=type,
        title=title,
        body=body,
        link=tracker_link(fb, latest),
        feedback_id=fb.id,
        actor_email=actor_email,
        step=step,
    )


async def notify_assignee(
    db: AsyncSession,
    fb: Feedback,
    *,
    type: str,
    title: str,
    body: str = "",
    actor_email: str | None = None,
    message_id: uuid.UUID | None = None,
    tab: str | None = None,
    step: str | None = None,
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
        link=console_link(fb, message_id, tab),
        feedback_id=fb.id,
        actor_email=actor_email,
        step=step,
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


async def triage_viewers(db: AsyncSession) -> list[str]:
    """Everyone who can see Triage (Needs review): the Admins and the triage lead."""
    return sorted(set(await admin_emails(db)) | set(await triage_lead_emails(db)))


async def notify_fixed(db: AsyncSession, fb: Feedback, *, step: str, title: str, actor_email: str) -> int:
    """Close the loop with the people told a P1 was blocking: everyone who can see Triage hears it is
    resolved or fixed, at once (D84). Those who raised it hear it as reporters, not twice. Fixes of
    other priorities wait on an open decision (at once too, or in the daily digest)."""
    if fb.priority != "P1":
        return 0
    reporters = {e.lower() for e in await submitters(db, fb)}
    return await notify(
        db,
        [e for e in await triage_viewers(db) if e.lower() not in reporters],
        type="fixed",
        title=title,
        body=fb.title,
        link=console_link(fb),
        feedback_id=fb.id,
        actor_email=actor_email,
        step=step,
    )


async def settle(
    db: AsyncSession, feedback_id: uuid.UUID, types: Iterable[str], outcome: str, recipient: str | None = None
) -> None:
    """Close the open asks of these types on an item, for everyone who got them or for one recipient."""
    now = datetime.now(UTC)
    query = update(Notification).where(
        Notification.feedback_id == feedback_id,
        Notification.type.in_(tuple(types)),
        Notification.settled_at.is_(None),
    )
    if recipient is not None:
        query = query.where(Notification.recipient_email == recipient.lower())
    await db.execute(
        query.values(
            settled_at=now,
            outcome=mask(outcome)[:MAX_CHARS],
            read_at=func.coalesce(Notification.read_at, now),
            updated_at=now,
        )
    )


def _waiting_title(n: int) -> str:
    return f"{n} item{'s' if n != 1 else ''} waiting for your approval"


async def refresh_approvals(db: AsyncSession) -> None:
    """Bring each Admin's standing approvals row up to date. A rising count makes it unread and new
    again; a falling one only changes the words; at zero it goes. Never emailed: the daily summary is."""
    await db.flush()
    waiting = int(
        await db.scalar(select(func.count()).select_from(Feedback).where(Feedback.status.in_(APPROVAL_STATUSES))) or 0
    )
    rows = {
        n.recipient_email: n
        for n in await db.scalars(select(Notification).where(Notification.type == APPROVALS_WAITING))
    }
    now = datetime.now(UTC)
    title = _waiting_title(waiting)
    for email in await admin_emails(db) if waiting else []:
        row = rows.pop(email, None)
        if row is None:
            db.add(
                Notification(
                    recipient_email=email,
                    type=APPROVALS_WAITING,
                    title=title,
                    link="/console/approvals",
                    email_status="skipped",
                    created_at=now,
                    updated_at=now,
                )
            )
        elif row.title != title:
            if waiting > int(row.title.split()[0]):
                row.read_at, row.created_at = None, now
            row.title, row.updated_at = title, now
    for row in rows.values():
        await db.delete(row)


# --- the bell -----------------------------------------------------------------------


def _bell(email: str) -> list[Any]:
    since = datetime.now(UTC) - timedelta(days=KEEP_DAYS)
    return [
        Notification.recipient_email == email,
        Notification.created_at >= since,
        Notification.type.not_in(EMAIL_ONLY),
    ]


async def list_for(db: AsyncSession, email: str, limit: int = 60) -> tuple[list[Notification], int]:
    rows = list(
        await db.scalars(
            select(Notification)
            .options(selectinload(Notification.feedback))
            .where(*_bell(email))
            .order_by(Notification.created_at.desc(), Notification.id)
            .limit(limit)
        )
    )
    return rows, await unread_count(db, email)


async def unread_count(db: AsyncSession, email: str) -> int:
    return int(
        await db.scalar(
            select(func.count()).select_from(Notification).where(*_bell(email), Notification.read_at.is_(None))
        )
        or 0
    )


async def bell_state(db: AsyncSession, email: str) -> str:
    """Changes whenever the bell would look different: a row added, changed in place or removed."""
    newest, rows = (
        await db.execute(
            select(func.max(Notification.updated_at), func.count()).where(Notification.recipient_email == email)
        )
    ).one()
    return f"{newest}|{rows}"


async def mark_read(db: AsyncSession, email: str, ids: list[uuid.UUID] | None) -> None:
    query = update(Notification).where(Notification.recipient_email == email, Notification.read_at.is_(None))
    if ids:
        query = query.where(Notification.id.in_(ids))
    now = datetime.now(UTC)
    await db.execute(query.values(read_at=now, updated_at=now))


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
