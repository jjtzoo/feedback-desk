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
from app.models.enums import CATEGORIES, CLOSED_STATUSES, OPEN_STATUSES, PRIORITIES, PRIORITY_RANK, STATUSES, WORK_TYPES
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
    ("closed", "Closed", CLOSED_STATUSES),
)


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
    inbox: str = "mine"  # mine | needs_review | open | closed | overdue | all
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


def _filtered(user: User, f: Filters) -> Select[Feedback]:
    query = select(Feedback).options(selectinload(Feedback.project), selectinload(Feedback.assignee))
    conds: list[Any] = []
    today = _now().date()
    if f.inbox == "mine":
        conds.append(Feedback.assignee_id == user.staff_id)
    elif f.inbox == "needs_review":
        conds.append(
            or_(
                Feedback.status.in_(("needs_review", "new")),
                Feedback.assignee_id.is_(None) & Feedback.status.in_(OPEN_STATUSES),
            )
        )
    elif f.inbox == "open":
        conds.append(Feedback.status.in_(OPEN_STATUSES))
    elif f.inbox == "closed":
        conds.append(Feedback.status.in_(CLOSED_STATUSES))
    elif f.inbox == "overdue":
        conds.append(and_(Feedback.expected_by < today, Feedback.status.in_(OPEN_STATUSES)))
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
        if key == "closed":
            query = query.where(Feedback.updated_at >= _now() - timedelta(days=30))
        items = list(await db.scalars(query.limit(100)))
        overdue = sum(1 for i in items if i.expected_by and i.expected_by < today and i.status in OPEN_STATUSES)
        cols.append(Column(key, title, items, len(items), overdue))
    return cols


async def has_files(db: AsyncSession, ids: list[uuid.UUID]) -> set[uuid.UUID]:
    if not ids:
        return set()
    return set(await db.scalars(select(Attachment.feedback_id).where(Attachment.feedback_id.in_(ids)).distinct()))


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
    return Detail(fb, messages, evs, files, followers, dups, linked, merged, staff)


# --- actions --------------------------------------------------------------------------


def _first_response(fb: Feedback) -> None:
    if fb.first_response_at is None:
        fb.first_response_at = _now()


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
    if fb.assignee_id is None:
        fb.assignee_id = user.staff_id
        events.log(
            db, fb.id, user.actor, "assigned", after={"assignee": user.email}, public_text=f"Assigned to {user.name}"
        )
    _set_status(db, fb, user, "in_progress", f"{user.name} started work")
    fb.resolved_at = None
    _first_response(fb)
    await notifications.notify_submitters(
        db, fb, type="stage", title=f"{fb.ref_no} is being worked on", actor_email=user.email
    )
    return await load(db, feedback_id=fb.id)


async def post_update(db: AsyncSession, user: User, ref_no: str, body: str, expected_by: date | None) -> Feedback:
    require_digital(user)
    fb = await load(db, ref_no=ref_no)
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
    title = f"Update on {fb.ref_no}" + (f", expected by {day_text(expected_by)}" if expected_by else "")
    await notifications.notify_submitters(
        db, fb, type="progress", title=title, body=body.strip()[:300], actor_email=user.email
    )
    return await load(db, feedback_id=fb.id)


async def resolve(db: AsyncSession, user: User, ref_no: str, note: str) -> Feedback:
    require_digital(user)
    if not note.strip():
        raise ServiceError("note_required", "Say briefly what was done; staff see it on their tracker.")
    fb = await load(db, ref_no=ref_no)
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
        )
    )
    _set_status(db, fb, user, "resolved", f"Resolved: {note.strip()[:140]}")
    fb.resolved_at = _now()
    _first_response(fb)
    await notifications.notify_submitters(
        db, fb, type="stage", title=f"{fb.ref_no} is resolved", body=note.strip()[:300], actor_email=user.email
    )
    return await load(db, feedback_id=fb.id)


async def close(db: AsyncSession, user: User, ref_no: str, reason: str, wont_fix: bool = False) -> Feedback:
    require_digital(user)
    fb = await load(db, ref_no=ref_no)
    if fb.status in CLOSED_STATUSES:
        raise Conflict("closed", "That item is already closed.")
    if wont_fix:
        if not reason.strip():
            raise ServiceError("reason_required", "Give the reason; staff see it on their tracker.")
        fb.close_reason = f"Won't fix: {reason.strip()}"
        _set_status(db, fb, user, "declined", fb.close_reason[:200])
    else:
        fb.close_reason = reason.strip() or None
        _set_status(db, fb, user, "closed", "Closed" + (f": {reason.strip()[:140]}" if reason.strip() else ""))
    await notifications.notify_submitters(
        db, fb, type="stage", title=f"{fb.ref_no} is closed", body=fb.close_reason or "", actor_email=user.email
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
    await notifications.notify_submitters(
        db,
        fb,
        type="reply",
        title=f"{user.name} replied on {fb.ref_no}",
        body=body.strip()[:300],
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
            fb.project_id = project.id
            await embeddings.store(db, fb.id, f"{fb.title}. {fb.summary}")
    if "assignee_id" in changes and changes["assignee_id"] != fb.assignee_id:
        new_id = changes["assignee_id"]
        target = await db.get(DigitalStaff, new_id) if new_id else None
        if new_id and (target is None or not target.active):
            raise ServiceError("bad_value", "That person can't take items.")
        previous = fb.assignee.google_email if fb.assignee else None
        events.log(
            db,
            fb.id,
            user.actor,
            "assigned",
            before={"assignee": previous},
            after={"assignee": target.google_email if target else None, "correction": True},
            public_text=f"Reassigned to {target.name}" if target else None,
        )
        fb.assignee_id = new_id
        fb.assignee_opened_at = None
        if target is not None:
            await notifications.notify(
                db,
                [target.google_email],
                type="assigned",
                title=f"{fb.ref_no} assigned to you: {fb.title}",
                link=notifications.console_link(fb),
                feedback_id=fb.id,
                actor_email=user.email,
            )
    fb.updated_at = _now()
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
    fb.close_reason = f"Merged into {target.ref_no}"
    _set_status(db, fb, user, "declined", f"Closed: merged into {target.ref_no}")
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
        title=f"{fb.ref_no} was merged into {target.ref_no}",
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
    if column == "closed":
        return await close(db, user, ref_no, note)
    raise Conflict("bad_move", "Cards can't be moved there.")


async def bulk(
    db: AsyncSession, user: User, refs: list[str], action: str, assignee_id: uuid.UUID | None, reason: str
) -> int:
    require_digital(user)
    done = 0
    for ref in refs[:100]:
        if action == "reassign":
            await update_fields(db, user, ref, {"assignee_id": assignee_id})
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
            .where(Feedback.status.in_(("awaiting_approval", "needs_review")))
            .order_by(rank, Feedback.created_at)
        )
    )


async def approve(db: AsyncSession, user: User, ref_no: str) -> Feedback:
    require_admin(user)
    fb = await load(db, ref_no=ref_no)
    if fb.status not in ("awaiting_approval", "needs_review"):
        raise Conflict("decided", "That item has already been decided.")
    fb.approved_by, fb.approved_at = user.email, _now()
    _set_status(db, fb, user, "approved", f"Approved by {user.name}")
    _first_response(fb)
    await notifications.notify_submitters(
        db,
        fb,
        type="stage",
        title=f"{fb.ref_no} was approved",
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
    fb.close_reason = reason.strip()[:1000]
    _set_status(db, fb, user, "declined", f"Declined: {reason.strip()[:140]}")
    _first_response(fb)
    await notifications.notify_submitters(
        db, fb, type="stage", title=f"{fb.ref_no} was declined", body=reason.strip()[:300], actor_email=user.email
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
            body=question.strip()[:300],
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
            body=question.strip()[:300],
            actor_email=user.email,
        )
    events.log(db, fb.id, user.actor, "asked_for_info", after={"ask": ask})
    fb.updated_at = _now()
    return await load(db, feedback_id=fb.id)


def work_type_label(value: str | None) -> str:
    return WORK_TYPE_LABEL.get(value or "", "")


def category_label(value: str | None) -> str:
    return CATEGORY_LABEL.get(value or "", "")
