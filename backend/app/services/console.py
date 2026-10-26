"""The management console: board, list and cards, the detail panel, Digital Staff actions and
Admin approvals (brief §4.4, §4.5). Every change writes feedback_events; public changes flow
to the staff tracker and notify the submitter."""

import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.errors import Conflict, Forbidden, ServiceError
from app.models import (
    Attachment,
    DigitalStaff,
    Feedback,
    FeedbackEvent,
    FeedbackFollower,
    FeedbackMessage,
    Project,
    UserPreference,
)
from app.models.enums import (
    APPROVAL_STATUSES,
    CATEGORIES,
    CLOSED_STATUSES,
    ENDINGS,
    OPEN_STATUSES,
    PRIORITIES,
    PRIORITY_RANK,
    STATUSES,
    WORK_TYPES,
)
from app.services import embeddings, events, notifications
from app.services.actors import User
from app.services.drafts import CATEGORY_LABEL, WORK_TYPE_LABEL
from app.services.feedback import day_text, load

log = logging.getLogger(__name__)

PAGE_SIZE = 50
BOARD_COLUMNS = (
    ("needs_review", "Needs review", ("needs_review", "new")),
    ("awaiting_approval", "Awaiting approval", ("awaiting_approval",)),
    ("approved", "Approved", ("approved",)),
    ("in_progress", "In progress", ("in_progress",)),
    ("resolved", "Resolved", ("resolved",)),
    ("fixed", "Fixed", ("closed",)),
)
# The board's last column shows only Fixed items, for this many days; every other ending goes to the Archive (D47).
FIXED_SHOWN_DAYS = 7


def _now() -> datetime:
    return datetime.now(UTC)


def require_digital(user: User) -> None:
    if not user.is_digital:
        raise Forbidden("The console is for the Digital team.")


def require_admin(user: User) -> None:
    if not user.is_admin:
        raise Forbidden("Only Admins (Mike, Chris or Marc) can approve or decline feedback.")


def visible_columns(user: User) -> list[tuple[str, str, tuple[str, ...]]]:
    out: list[tuple[str, str, tuple[str, ...]]] = []
    for key, title, statuses in BOARD_COLUMNS:
        if key == "needs_review" and not (user.is_triage_lead or user.is_admin):
            continue
        if key == "awaiting_approval" and not user.is_admin:
            continue
        out.append((key, title, statuses))
    return out


# --- listing --------------------------------------------------------------------------


@dataclass
class Filters:
    inbox: str = "mine"  # mine | needs_review | open | overdue | archive | all
    project: str | None = None
    category: str | None = None
    priority: str | None = None
    status: str | None = None
    work_type: str | None = None
    assignee: str | None = None  # me | none | staff id
    q: str | None = None
    date_from: date | None = None
    date_to: date | None = None
    sort: str = "urgent"  # urgent | newest | oldest | expected
    page: int = 1
    ending: str | None = None  # in the Archive: an ending, or "acknowledged" for praise


def _recently_fixed() -> Any:
    return and_(Feedback.ending == "fixed", Feedback.updated_at >= _now() - timedelta(days=FIXED_SHOWN_DAYS))


def _filtered(user: User, f: Filters) -> Select[Feedback]:
    query = select(Feedback).options(selectinload(Feedback.project), selectinload(Feedback.assignee))
    conds: list[Any] = []
    today = _now().date()
    if f.inbox == "mine":
        conds.append(Feedback.assignee_id == user.staff_id)
        conds.append(or_(Feedback.status.in_(OPEN_STATUSES), _recently_fixed()))
    elif f.inbox == "needs_review":
        conds.append(
            or_(
                Feedback.status.in_(("needs_review", "new")),
                Feedback.assignee_id.is_(None) & Feedback.status.in_(OPEN_STATUSES),
            )
        )
    elif f.inbox == "open":
        conds.append(Feedback.status.in_(OPEN_STATUSES))
    elif f.inbox == "archive":
        conds.append(Feedback.status.in_(CLOSED_STATUSES))
    elif f.inbox == "overdue":
        conds.append(and_(Feedback.expected_by < today, Feedback.status.in_(OPEN_STATUSES)))
    if f.ending == "acknowledged":
        conds.append(Feedback.status == "acknowledged")
    elif f.ending in ENDINGS:
        conds.append(Feedback.ending == f.ending)
    elif f.ending:
        raise ServiceError("bad_filter", "Unknown ending.")
    if f.project:
        conds.append(Feedback.project.has(Project.slug == f.project))
    if f.category:
        conds.append(Feedback.category == f.category)
    if f.priority:
        conds.append(Feedback.priority == f.priority)
    if f.status:
        conds.append(Feedback.status == f.status)
    if f.work_type:
        conds.append(Feedback.work_type == f.work_type)
    if f.assignee == "me":
        conds.append(Feedback.assignee_id == user.staff_id)
    elif f.assignee == "none":
        conds.append(Feedback.assignee_id.is_(None))
    elif f.assignee:
        try:
            conds.append(Feedback.assignee_id == uuid.UUID(f.assignee))
        except ValueError as exc:
            raise ServiceError("bad_filter", "Assignee must be me, none or a staff id.") from exc
    if f.q:
        like = f"%{f.q.strip()}%"
        conds.append(
            or_(
                Feedback.title.ilike(like),
                Feedback.summary.ilike(like),
                Feedback.ref_no.ilike(like),
                Feedback.submitter_name.ilike(like),
            )
        )
    if f.date_from:
        conds.append(Feedback.created_at >= datetime.combine(f.date_from, datetime.min.time(), UTC))
    if f.date_to:
        conds.append(Feedback.created_at < datetime.combine(f.date_to + timedelta(days=1), datetime.min.time(), UTC))
    return query.where(*conds)


def _ordered(query: Select[Feedback], sort: str) -> Select[Feedback]:
    from sqlalchemy import case

    rank = case(PRIORITY_RANK, value=Feedback.priority, else_=9)
    if sort == "newest":
        return query.order_by(Feedback.created_at.desc())
    if sort == "oldest":
        return query.order_by(Feedback.created_at)
    if sort == "expected":
        return query.order_by(Feedback.expected_by.asc().nulls_last(), rank)
    return query.order_by(rank, Feedback.created_at)


async def list_items(db: AsyncSession, user: User, f: Filters) -> tuple[list[Feedback], int]:
    require_digital(user)
    base = _filtered(user, f)
    total = int(await db.scalar(select(func.count()).select_from(base.with_only_columns(Feedback.id).subquery())) or 0)
    page = max(f.page, 1)
    rows = await db.scalars(_ordered(base, f.sort).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE))
    return list(rows), total


@dataclass
class Column:
    key: str
    title: str
    items: list[Feedback]
    count: int
    overdue: int


async def board(db: AsyncSession, user: User, f: Filters) -> list[Column]:
    require_digital(user)
    cols = []
    today = _now().date()
    for key, title, statuses in visible_columns(user):
        query = _ordered(_filtered(user, f).where(Feedback.status.in_(statuses)), f.sort)
        if key == "fixed":
            query = query.where(_recently_fixed())
        items = list(await db.scalars(query.limit(100)))
        overdue = sum(1 for i in items if i.expected_by and i.expected_by < today and i.status in OPEN_STATUSES)
        cols.append(Column(key, title, items, len(items), overdue))
    return cols


INBOXES = ("mine", "needs_review", "open", "overdue", "archive")


async def counts(db: AsyncSession, user: User) -> dict[str, int]:
    """What needs attention, for the sidebar and the inbox tabs: one number per inbox, plus the Admin's approvals."""
    require_digital(user)
    out: dict[str, int] = {}
    for inbox in INBOXES:
        query = _filtered(user, Filters(inbox=inbox))
        if inbox == "mine":
            query = query.where(Feedback.status.in_(OPEN_STATUSES))  # recently fixed items show, but aren't to do
        ids = query.with_only_columns(Feedback.id).subquery()
        out[inbox] = int(await db.scalar(select(func.count()).select_from(ids)) or 0)
    waiting = select(func.count()).where(Feedback.status.in_(APPROVAL_STATUSES))
    out["approvals"] = int(await db.scalar(waiting) or 0) if user.is_admin else 0
    return out


async def has_files(db: AsyncSession, ids: list[uuid.UUID]) -> set[uuid.UUID]:
    if not ids:
        return set()
    return set(await db.scalars(select(Attachment.feedback_id).where(Attachment.feedback_id.in_(ids)).distinct()))


async def reporter_counts(db: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    """How many people reported each item: the submitter plus each distinct colleague who added a
    +1 (or was merged in). Followers are unique per person and never include the submitter."""
    if not ids:
        return {}
    rows = await db.execute(
        select(FeedbackFollower.feedback_id, func.count())
        .where(FeedbackFollower.feedback_id.in_(ids))
        .group_by(FeedbackFollower.feedback_id)
    )
    extra = {fid: int(n) for fid, n in rows.all()}
    return {i: 1 + extra.get(i, 0) for i in ids}


def needs_priority_review(fb: Feedback, reporters: int) -> bool:
    """Suggest, never apply, a priority review once enough different people report the same open
    item (D38). Staff never see the count, so asking colleagues to +1 has nothing to aim at."""
    return fb.status in OPEN_STATUSES and fb.priority != "P1" and reporters >= get_settings().priority_review_reporters


async def get_view(db: AsyncSession, user: User) -> str:
    pref = await db.get(UserPreference, user.email)
    return pref.console_view if pref else "board"


async def set_view(db: AsyncSession, user: User, view: str) -> None:
    pref = await db.get(UserPreference, user.email)
    if pref is None:
        db.add(UserPreference(email=user.email, console_view=view))
    else:
        pref.console_view = view


# --- detail ---------------------------------------------------------------------------


@dataclass
class Detail:
    feedback: Feedback
    messages: list[FeedbackMessage]
    events: list[FeedbackEvent]
    attachments: list[Attachment]
    followers: list[FeedbackFollower]
    duplicates: list[embeddings.Similar]
    linked: list[Feedback]
    merged_into: str | None
    staff: list[DigitalStaff] = field(default_factory=list)
    holder_activity: "Activity | None" = None


@dataclass
class Activity:
    """The assignee's latest step on an item ("posted an update"), shown before anyone takes it over."""

    text: str
    at: datetime


MESSAGE_DOING = {"progress": "posted an update", "reply": "replied to the submitter", "note": "added a note"}
STATUS_DOING = {"in_progress": "started work", "resolved": "resolved it"}


def holder_activity(fb: Feedback, messages: list[FeedbackMessage], evs: list[FeedbackEvent]) -> Activity | None:
    if fb.assignee is None:
        return None
    email = fb.assignee.google_email
    found = [
        Activity(MESSAGE_DOING[m.message_type], m.created_at)
        for m in messages
        if m.author_email == email and m.message_type in MESSAGE_DOING
    ]
    opened = None
    for e in evs:
        if e.actor_email != email:
            continue
        if e.event_type == "status":
            found.append(Activity(STATUS_DOING.get(str(e.after.get("status")), "moved it on"), e.created_at))
        elif e.event_type in CHANGE_EVENTS:
            found.append(Activity("took it on", e.created_at))
        elif e.event_type == "opened":
            opened = Activity("opened it", e.created_at)
    # Opening it only counts when they have done nothing else: the panel records it after their first step too.
    return max(found, key=lambda a: a.at, default=opened)


async def detail(db: AsyncSession, user: User, ref_no: str) -> Detail:
    require_digital(user)
    fb = await load(db, ref_no=ref_no)
    if fb.assignee_id is not None and fb.assignee_id == user.staff_id:
        now = _now()
        if fb.assignee_opened_at is None:
            fb.assignee_opened_at = now
            events.log(db, fb.id, user.actor, "opened", public_text=f"{user.name} opened your feedback")
        fb.assignee_read_at = now
    messages = list(
        await db.scalars(
            select(FeedbackMessage).where(FeedbackMessage.feedback_id == fb.id).order_by(FeedbackMessage.created_at)
        )
    )
    evs = list(
        await db.scalars(
            select(FeedbackEvent).where(FeedbackEvent.feedback_id == fb.id).order_by(FeedbackEvent.created_at.desc())
        )
    )
    files = list(
        await db.scalars(select(Attachment).where(Attachment.feedback_id == fb.id).order_by(Attachment.created_at))
    )
    followers = list(await db.scalars(select(FeedbackFollower).where(FeedbackFollower.feedback_id == fb.id)))
    linked = list(await db.scalars(select(Feedback).where(Feedback.duplicate_of == fb.id)))
    dups: list[embeddings.Similar] = []
    if fb.project_id and fb.status in OPEN_STATUSES:
        try:
            dups = await embeddings.find_similar(db, fb.project_id, f"{fb.title}. {fb.summary}", exclude_id=fb.id)
        except Exception:
            # Duplicate search needs the embedding model; without it the panel still opens, minus the suggestions.
            log.exception("duplicate search failed for %s; showing the panel without it", ref_no)
    merged = None
    if fb.duplicate_of:
        target = await db.get(Feedback, fb.duplicate_of)
        merged = target.ref_no if target else None
    staff = list(
        await db.scalars(select(DigitalStaff).where(DigitalStaff.active.is_(True)).order_by(DigitalStaff.name))
    )
    return Detail(fb, messages, evs, files, followers, dups, linked, merged, staff, holder_activity(fb, messages, evs))


# --- actions --------------------------------------------------------------------------


def _first_response(fb: Feedback) -> None:
    if fb.first_response_at is None:
        fb.first_response_at = _now()


def require_holder(fb: Feedback, user: User) -> None:
    """Only the person who has an item starts work on it, posts updates and resolves it (D1, D53).
    Anyone else takes it over first, so every change of hands is named and told."""
    if fb.assignee_id is None or fb.assignee_id != user.staff_id:
        if fb.assignee is None:
            raise Forbidden(f"Nobody has {fb.ref_no} yet. Assign it to yourself first.")
        raise Forbidden(f"{fb.assignee.name} has {fb.ref_no}. Take it over first.")


def _require_open(fb: Feedback) -> None:
    if fb.status in CLOSED_STATUSES:
        raise Conflict("closed", "That item has ended; it can't change hands.")


async def _load_locked(db: AsyncSession, ref_no: str) -> Feedback:
    """Load an item holding its row, so two people changing hands at once are told apart."""
    await db.execute(select(Feedback.id).where(Feedback.ref_no == ref_no.upper()).with_for_update())
    return await load(db, ref_no=ref_no)


# A change of hands, by how it happened (D53). Kept apart from routing corrections in the data.
CHANGE_EVENTS = ("assigned", "taken_over", "handed_over")


async def _change_hands(
    db: AsyncSession, fb: Feedback, user: User, target: DigitalStaff, event: str, reason: str = ""
) -> None:
    previous = fb.assignee
    before = {"assignee": previous.google_email, "name": previous.name} if previous else {"assignee": None}
    after = {"assignee": target.google_email, "name": target.name} | ({"reason": reason[:500]} if reason else {})
    # Staff see who has it now; they are not notified (D53).
    events.log(db, fb.id, user.actor, event, before=before, after=after, public_text=f"Now with {target.name}")
    fb.assignee_id, fb.assignee_opened_at, fb.routed = target.id, None, None
    fb.updated_at = _now()
    await notifications.settle(db, fb.id, notifications.START, f"{fb.ref_no} is now with {target.name}")
    if target.google_email != user.email:
        await notifications.notify(
            db,
            [target.google_email],
            type="assigned",
            title=f"{fb.ref_no} assigned to you: {fb.title}",
            body=reason,
            link=notifications.console_link(fb),
            feedback_id=fb.id,
            actor_email=user.email,
        )
    if previous is not None and previous.google_email != user.email:
        title = (
            f"{user.name} took over {fb.ref_no}"
            if event == "taken_over"
            else f"{user.name} handed {fb.ref_no} to {target.name}"
        )
        await notifications.notify(
            db,
            [previous.google_email],
            type=event,
            title=title,
            body=reason,
            link=notifications.console_link(fb),
            feedback_id=fb.id,
            actor_email=user.email,
        )


async def assign_to_me(db: AsyncSession, user: User, ref_no: str) -> Feedback:
    """Take on an item nobody has."""
    require_digital(user)
    fb = await _load_locked(db, ref_no)
    _require_open(fb)
    if fb.assignee is not None:
        if fb.assignee_id == user.staff_id:
            raise Conflict("yours", "It's already yours.")
        raise Conflict("changed_hands", f"{fb.assignee.name} has just taken this on.")
    me = await db.get(DigitalStaff, user.staff_id)
    assert me is not None  # a Digital user always has a staff row
    await _change_hands(db, fb, user, me, "assigned")
    return await load(db, feedback_id=fb.id)


async def take_over(db: AsyncSession, user: User, ref_no: str, holder_id: uuid.UUID, reason: str) -> Feedback:
    """Take an item from whoever has it. holder_id is who had it when the dialog opened: if that
    changed, nothing happens and the person is told who has it now."""
    require_digital(user)
    fb = await _load_locked(db, ref_no)
    _require_open(fb)
    if fb.assignee is None:
        raise Conflict("changed_hands", "Nobody has this now. Use Assign to me.")
    if fb.assignee_id == user.staff_id:
        raise Conflict("yours", "It's already yours.")
    if fb.assignee_id != holder_id:
        raise Conflict("changed_hands", f"{fb.assignee.name} has just taken this over.")
    me = await db.get(DigitalStaff, user.staff_id)
    assert me is not None
    await _change_hands(db, fb, user, me, "taken_over", reason.strip())
    return await load(db, feedback_id=fb.id)


async def hand_over(db: AsyncSession, user: User, ref_no: str, to_id: uuid.UUID | None, reason: str = "") -> Feedback:
    """Give an item to someone: its holder, an Admin or the triage lead (who also assign items nobody has)."""
    require_digital(user)
    fb = await _load_locked(db, ref_no)
    _require_open(fb)
    holder = fb.assignee_id is not None and fb.assignee_id == user.staff_id
    if not (holder or user.is_admin or user.is_triage_lead):
        raise Forbidden("Only the person who has it, an Admin or the triage lead can hand it over. Take it over.")
    target = await db.get(DigitalStaff, to_id) if to_id else None
    if target is None or not target.active:
        raise ServiceError("bad_value", "Choose someone who can take items.")
    if target.id == fb.assignee_id:
        raise Conflict("same", f"{target.name} already has it.")
    await _change_hands(db, fb, user, target, "handed_over" if fb.assignee else "assigned", reason.strip())
    return await load(db, feedback_id=fb.id)


def _set_status(db: AsyncSession, fb: Feedback, user: User, new: str, public_text: str | None = None) -> None:
    if new not in STATUSES:
        raise ServiceError("bad_value", "Unknown status.")
    events.log(
        db, fb.id, user.actor, "status", before={"status": fb.status}, after={"status": new}, public_text=public_text
    )
    fb.status = new
    fb.updated_at = _now()


async def start_work(db: AsyncSession, user: User, ref_no: str) -> Feedback:
    require_digital(user)
    fb = await load(db, ref_no=ref_no)
    if fb.status not in ("approved", "resolved"):
        raise Conflict("not_approved", "Only approved items can be started. Ask an Admin to approve it first.")
    if fb.assignee_id is None:  # starting an item nobody has takes it on first
        await assign_to_me(db, user, ref_no)
        fb = await load(db, ref_no=ref_no)
    require_holder(fb, user)
    _set_status(db, fb, user, "in_progress", f"{user.name} started work")
    await notifications.settle(db, fb.id, notifications.START, f"{fb.ref_no}: {user.name} started work")
    fb.resolved_at = None
    _first_response(fb)
    await notifications.notify_submitters(
        db, fb, type="stage", title=f"{fb.ref_no} is being worked on", actor_email=user.email
    )
    return await load(db, feedback_id=fb.id)


async def post_update(db: AsyncSession, user: User, ref_no: str, body: str, expected_by: date | None) -> Feedback:
    require_digital(user)
    fb = await load(db, ref_no=ref_no)
    require_holder(fb, user)
    if not body.strip() and expected_by is None:
        raise ServiceError("empty", "Write an update or set an Expected by date.")
    if expected_by is not None and expected_by != fb.expected_by:
        events.log(
            db,
            fb.id,
            user.actor,
            "expected_by",
            before={"expected_by": str(fb.expected_by or "")},
            after={"expected_by": str(expected_by)},
            public_text=f"Expected by {day_text(expected_by)}",
        )
        fb.expected_by = expected_by
    if body.strip():
        db.add(
            FeedbackMessage(
                feedback_id=fb.id,
                author_type="digital",
                author_email=user.email,
                author_name=user.name,
                message_type="progress",
                body=body.strip()[:4000],
                expected_by=expected_by,
            )
        )
    fb.updated_at = _now()
    _first_response(fb)
    await _answered(db, fb, user)
    title = f"Update on {fb.ref_no}" + (f", expected by {day_text(expected_by)}" if expected_by else "")
    await notifications.notify_submitters(
        db, fb, type="progress", title=title, body=body.strip(), actor_email=user.email
    )
    return await load(db, feedback_id=fb.id)


async def resolve(db: AsyncSession, user: User, ref_no: str, note: str) -> Feedback:
    require_digital(user)
    if not note.strip():
        raise ServiceError("note_required", "Say briefly what was done; staff see it on their tracker.")
    fb = await load(db, ref_no=ref_no)
    require_holder(fb, user)
    if fb.status not in ("approved", "in_progress"):
        raise Conflict("bad_stage", "Only approved or in-progress items can be resolved.")
    db.add(
        FeedbackMessage(
            feedback_id=fb.id,
            author_type="digital",
            author_email=user.email,
            author_name=user.name,
            message_type="progress",
            body=note.strip()[:4000],
            # Stamped just before the status event below, so the tracker lists "Resolved: ..." as the newest entry.
            created_at=datetime.now(UTC) - timedelta(milliseconds=1),
        )
    )
    _set_status(db, fb, user, "resolved", f"Resolved: {note.strip()[:140]}")
    fb.resolved_at = _now()
    _first_response(fb)
    await notifications.notify_submitters(
        db, fb, type="stage", title=f"{fb.ref_no} is resolved", body=note.strip(), actor_email=user.email
    )
    return await load(db, feedback_id=fb.id)


CLOSE_TEXT = {"fixed": "Fixed", "wont_fix": "Won't fix", "no_longer_needed": "No longer needed"}
CLOSE_TITLE = {
    "fixed": "{ref} is fixed",
    "wont_fix": "{ref} won't be fixed",
    "no_longer_needed": "{ref} is no longer needed",
}


async def close(db: AsyncSession, user: User, ref_no: str, reason: str, ending: str | None = None) -> Feedback:
    """Close with a named ending (D44, D45): a resolved item closes as fixed with no reason; an open one
    as won't fix or no longer needed, with the reason staff see on their tracker."""
    require_digital(user)
    fb = await load(db, ref_no=ref_no)
    if fb.status in CLOSED_STATUSES:
        raise Conflict("closed", "That item is already closed.")
    reason = reason.strip()
    if fb.status == "resolved":
        if ending not in (None, "fixed"):
            raise Conflict("resolved", "A resolved item closes as fixed. If it isn't fixed, start work on it again.")
        ending, reason = "fixed", ""
    else:
        ending = ending or "no_longer_needed"
        if ending == "fixed":
            raise Conflict("not_resolved", "Only resolved items can close as fixed. Resolve it first.")
        if ending not in CLOSE_TEXT:
            raise ServiceError("bad_value", "Close as won't fix or no longer needed.")
        if not reason:
            raise ServiceError("reason_required", "Give the reason; staff see it on their tracker.")
    fb.ending = ending
    fb.close_reason = reason[:1000] or None
    # Won't fix stays a declined item (D21); fixed and no longer needed are closed.
    text = CLOSE_TEXT[ending] + (f": {reason[:140]}" if reason else "")
    _set_status(db, fb, user, "declined" if ending == "wont_fix" else "closed", text)
    await _ended(db, fb, f"{fb.ref_no} closed: {CLOSE_TEXT[ending]}")
    await notifications.notify_submitters(
        db,
        fb,
        type="stage",
        title=CLOSE_TITLE[ending].format(ref=fb.ref_no),
        body=fb.close_reason or "",
        actor_email=user.email,
    )
    return await load(db, feedback_id=fb.id)


async def reply(db: AsyncSession, user: User, ref_no: str, body: str) -> Feedback:
    require_digital(user)
    if not body.strip():
        raise ServiceError("empty", "Write a reply first.")
    fb = await load(db, ref_no=ref_no)
    db.add(
        FeedbackMessage(
            feedback_id=fb.id,
            author_type="digital",
            author_email=user.email,
            author_name=user.name,
            message_type="reply",
            body=body.strip()[:4000],
        )
    )
    fb.updated_at = _now()
    _first_response(fb)
    await _answered(db, fb, user)
    await notifications.notify_submitters(
        db,
        fb,
        type="reply",
        title=f"{user.name} replied on {fb.ref_no}",
        body=body.strip(),
        actor_email=user.email,
    )
    return await load(db, feedback_id=fb.id)


async def add_note(db: AsyncSession, user: User, ref_no: str, body: str) -> Feedback:
    require_digital(user)
    if not body.strip():
        raise ServiceError("empty", "Write a note first.")
    fb = await load(db, ref_no=ref_no)
    db.add(
        FeedbackMessage(
            feedback_id=fb.id,
            author_type="digital",
            author_email=user.email,
            author_name=user.name,
            message_type="note",
            body=body.strip()[:4000],
            is_internal=True,
        )
    )
    await _answered(db, fb, user)
    return fb


async def update_fields(db: AsyncSession, user: User, ref_no: str, changes: dict[str, Any]) -> Feedback:
    """Change project, category, priority, work type or assignee. Each correction is logged as
    the routing training signal (brief §4.4.5)."""
    require_digital(user)
    fb = await load(db, ref_no=ref_no)
    for fname, allowed in (("category", CATEGORIES), ("priority", PRIORITIES), ("work_type", WORK_TYPES)):
        if fname in changes and changes[fname] != getattr(fb, fname):
            if changes[fname] not in allowed:
                raise ServiceError("bad_value", f"Unknown {fname}.")
            events.log(
                db, fb.id, user.actor, "correction", before={fname: getattr(fb, fname)}, after={fname: changes[fname]}
            )
            setattr(fb, fname, changes[fname])
    if "project_slug" in changes:
        project = await db.scalar(select(Project).where(Project.slug == changes["project_slug"]))
        if project is None:
            raise ServiceError("bad_value", "Unknown project.")
        if project.id != fb.project_id:
            before = fb.project.slug if fb.project else "general"
            events.log(db, fb.id, user.actor, "correction", before={"project": before}, after={"project": project.slug})
            fb.project_id, fb.routed = project.id, None
            await embeddings.store(db, fb.id, f"{fb.title}. {fb.summary}")
    fb.updated_at = _now()
    if "assignee_id" in changes and changes["assignee_id"] != fb.assignee_id:
        await db.flush()
        return await hand_over(db, user, ref_no, changes["assignee_id"])
    await db.flush()
    return await load(db, feedback_id=fb.id)


async def merge(db: AsyncSession, user: User, ref_no: str, into_ref: str) -> Feedback:
    """Close as a duplicate of another item; the submitter follows the original (brief §4.2.6)."""
    require_digital(user)
    fb = await load(db, ref_no=ref_no)
    target = await load(db, ref_no=into_ref)
    if fb.id == target.id or target.duplicate_of == fb.id:
        raise ServiceError("bad_value", "Pick a different item to merge into.")
    if target.status in CLOSED_STATUSES:
        raise Conflict("closed", f"{target.ref_no} is closed; reopen or pick another.")
    for email, name in [(fb.submitter_email, fb.submitter_name)] + [
        (f.email, f.name)
        for f in await db.scalars(select(FeedbackFollower).where(FeedbackFollower.feedback_id == fb.id))
    ]:
        if email != target.submitter_email and await db.get(FeedbackFollower, (target.id, email)) is None:
            db.add(FeedbackFollower(feedback_id=target.id, email=email, name=name))
    db.add(
        FeedbackMessage(
            feedback_id=target.id,
            author_type="system",
            author_name="Feedback",
            message_type="follow_up",
            body=f"Merged from {fb.ref_no}: {fb.summary}",
        )
    )
    fb.duplicate_of = target.id
    fb.ending, fb.close_reason = "duplicate", None
    _set_status(db, fb, user, "declined", f"Duplicate of {target.ref_no}")
    await _ended(db, fb, f"{fb.ref_no} merged into {target.ref_no}")
    events.log(
        db,
        target.id,
        user.actor,
        "linked",
        after={"merged": fb.ref_no},
        public_text="Another staff member reported the same thing",
    )
    await notifications.notify_submitters(
        db,
        fb,
        type="stage",
        title=f"{fb.ref_no} is a duplicate of {target.ref_no}",
        body="Follow the original item for updates.",
        actor_email=user.email,
    )
    await db.flush()
    return await load(db, feedback_id=fb.id)


async def move(db: AsyncSession, user: User, ref_no: str, column: str, note: str = "") -> Feedback:
    """Dragging a card on the board is the same as changing its stage."""
    fb = await load(db, ref_no=ref_no)
    if column == "approved":
        if fb.status in ("awaiting_approval", "needs_review"):
            return await approve(db, user, ref_no)
        raise Conflict("bad_move", "Only items waiting for approval can move to Approved.")
    if column == "in_progress":
        return await start_work(db, user, ref_no)
    if column == "resolved":
        return await resolve(db, user, ref_no, note)
    if column == "fixed":
        if fb.status != "resolved":
            raise Conflict("bad_move", "Only resolved items can move to Fixed. Use Close to say why it ends.")
        return await close(db, user, ref_no, "", "fixed")
    raise Conflict("bad_move", "Cards can't be moved there.")


async def bulk(
    db: AsyncSession, user: User, refs: list[str], action: str, assignee_id: uuid.UUID | None, reason: str
) -> int:
    require_digital(user)
    done = 0
    for ref in refs[:100]:
        if action == "reassign":
            await hand_over(db, user, ref, assignee_id)
        elif action == "close":
            await close(db, user, ref, reason)
        else:
            raise ServiceError("bad_value", "Unknown bulk action.")
        done += 1
    return done


# --- approvals ------------------------------------------------------------------------


async def approvals(db: AsyncSession, user: User) -> list[Feedback]:
    require_admin(user)
    from sqlalchemy import case

    rank = case(PRIORITY_RANK, value=Feedback.priority, else_=9)
    return list(
        await db.scalars(
            select(Feedback)
            .options(selectinload(Feedback.project), selectinload(Feedback.assignee))
            .where(Feedback.status.in_(APPROVAL_STATUSES))
            .order_by(rank, Feedback.created_at)
        )
    )


async def approve(db: AsyncSession, user: User, ref_no: str) -> Feedback:
    require_admin(user)
    fb = await load(db, ref_no=ref_no)
    if fb.status not in ("awaiting_approval", "needs_review"):
        raise Conflict("decided", "That item has already been decided.")
    fb.approved_by, fb.approved_at = user.email, _now()
    fb.routed = None  # an Admin accepted routing's choice
    # Staff see stage 2 as Planned (D43); the console keeps Approved.
    _set_status(db, fb, user, "approved", f"Planned ({user.name} accepted it)")
    _first_response(fb)
    await notifications.settle(db, fb.id, notifications.DECIDE, f"{fb.ref_no} approved by {user.name}")
    await notifications.refresh_approvals(db)
    await notifications.notify_submitters(
        db,
        fb,
        type="stage",
        title=f"{fb.ref_no} is planned",
        body="The team will start on it.",
        actor_email=user.email,
    )
    await notifications.notify_assignee(
        db, fb, type="approved", title=f"Approved, ready to start: {fb.ref_no} · {fb.title}", actor_email=user.email
    )
    return await load(db, feedback_id=fb.id)


async def decline(db: AsyncSession, user: User, ref_no: str, reason: str) -> Feedback:
    require_admin(user)
    if not reason.strip():
        raise ServiceError("reason_required", "Give the reason; the person who raised it sees it.")
    fb = await load(db, ref_no=ref_no)
    if fb.status not in ("awaiting_approval", "needs_review"):
        raise Conflict("decided", "That item has already been decided.")
    fb.ending, fb.close_reason = "declined", reason.strip()[:1000]
    _set_status(db, fb, user, "declined", f"Declined: {reason.strip()[:140]}")
    _first_response(fb)
    await _ended(db, fb, f"{fb.ref_no} declined by {user.name}")
    await notifications.notify_submitters(
        db, fb, type="stage", title=f"{fb.ref_no} was declined", body=reason.strip(), actor_email=user.email
    )
    return await load(db, feedback_id=fb.id)


async def ask_info(db: AsyncSession, user: User, ref_no: str, question: str, ask: str) -> Feedback:
    """Ask the submitter (a public reply) or the owner (an internal note); the item keeps waiting."""
    require_admin(user)
    if not question.strip():
        raise ServiceError("empty", "Write the question first.")
    fb = await load(db, ref_no=ref_no)
    if ask == "submitter":
        db.add(
            FeedbackMessage(
                feedback_id=fb.id,
                author_type="digital",
                author_email=user.email,
                author_name=user.name,
                message_type="reply",
                body=question.strip()[:4000],
            )
        )
        await notifications.notify_submitters(
            db,
            fb,
            type="ask_info",
            title=f"A question about {fb.ref_no}",
            body=question.strip(),
            actor_email=user.email,
        )
    else:
        db.add(
            FeedbackMessage(
                feedback_id=fb.id,
                author_type="digital",
                author_email=user.email,
                author_name=user.name,
                message_type="note",
                body=f"Question for the owner: {question.strip()[:4000]}",
                is_internal=True,
            )
        )
        await notifications.notify_assignee(
            db,
            fb,
            type="ask_info",
            title=f"{user.name} asked about {fb.ref_no}",
            body=question.strip(),
            actor_email=user.email,
        )
    events.log(db, fb.id, user.actor, "asked_for_info", after={"ask": ask})
    fb.updated_at = _now()
    return await load(db, feedback_id=fb.id)


async def _answered(db: AsyncSession, fb: Feedback, user: User) -> None:
    """A question to the owner is answered once they write anything on the item."""
    await notifications.settle(db, fb.id, notifications.ANSWER, f"{fb.ref_no} answered", recipient=user.email)


async def _ended(db: AsyncSession, fb: Feedback, outcome: str) -> None:
    """Nothing is left to do on an ended item: every ask on it settles, and it leaves the approvals count."""
    fb.routed = None
    await notifications.settle(db, fb.id, notifications.ASKS, outcome)
    await notifications.refresh_approvals(db)


def work_type_label(value: str | None) -> str:
    return WORK_TYPE_LABEL.get(value or "", "")


def category_label(value: str | None) -> str:
    return CATEGORY_LABEL.get(value or "", "")
