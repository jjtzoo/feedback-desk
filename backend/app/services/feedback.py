"""Feedback items from the staff side: submitting, "+1 and comment", My feedback, the parcel
tracker and follow-ups (brief §4.1, §4.2)."""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.errors import Conflict, Forbidden, NotFound
from app.models import Attachment, DigitalStaff, Feedback, FeedbackEvent, FeedbackFollower, FeedbackMessage, Project
from app.models.enums import CLOSED_STATUSES, OPEN_STATUSES, STAGE_OF, STAGES
from app.services import embeddings, events, notifications
from app.services.actors import AGENT, SYSTEM, User
from app.services.catalog import list_staff, project_by_slug
from app.services.drafts import CATEGORY_LABEL, GENERAL, WORK_TYPE_LABEL, Draft, first_sentence
from app.services.privacy import is_abusive_about, mask
from app.services.router import Routing, route

# Staff-side words (D43): stage 2 is "Planned" for staff; the console and Admins keep "Approved".
STATUS_TEXT = {
    "new": "Received",
    "needs_review": "Under review",
    "awaiting_approval": "Under review",
    "approved": "Planned, not started yet",
    "in_progress": "Being worked on",
    "resolved": "Resolved",
    "acknowledged": "Acknowledged, thank you",
    "declined": "Declined",
    "closed": "Closed",
}
STAGE_LABEL = {
    "received": "Received",
    "approved": "Planned",
    "in_progress": "In progress",
    "resolved": "Resolved",
    "closed": "Closed",
}
# How an item ended (D44); the tracker's last step and the status line show it.
ENDING_TEXT = {
    "fixed": "Fixed",
    "wont_fix": "Won't fix",
    "duplicate": "Duplicate",
    "declined": "Declined",
    "no_longer_needed": "No longer needed",
}
# Endings that carry a reason staff see; Fixed needs none and a duplicate links to the original.
ENDINGS_WITH_REASON = ("wont_fix", "declined", "no_longer_needed")


def status_text(fb: Feedback, merged_into: str | None = None) -> str:
    """What staff see as the item's state: the ending's name once it has ended."""
    if fb.ending == "duplicate" and merged_into:
        return f"Duplicate of {merged_into}"
    if fb.ending:
        return ENDING_TEXT[fb.ending]
    return STATUS_TEXT[fb.status]


def shown_reason(fb: Feedback) -> str | None:
    return fb.close_reason if fb.ending in ENDINGS_WITH_REASON else None


TARGET_FROM_GROUP = {"platforms": "platform", "agents": "agent", "other": "intranet"}


def _now() -> datetime:
    return datetime.now(UTC)


def day_text(d: date) -> str:
    return d.strftime("%a %d %b").replace(" 0", " ")


async def load(db: AsyncSession, *, ref_no: str | None = None, feedback_id: uuid.UUID | None = None) -> Feedback:
    query = select(Feedback).options(selectinload(Feedback.project), selectinload(Feedback.assignee))
    query = query.where(Feedback.ref_no == ref_no.upper()) if ref_no else query.where(Feedback.id == feedback_id)
    fb = await db.scalar(query.execution_options(populate_existing=True))
    if fb is None:
        raise NotFound("We can't find that feedback.")
    return fb


async def can_view(db: AsyncSession, user: User, fb: Feedback) -> bool:
    if user.is_digital or fb.submitter_email == user.email:
        return True
    follower = await db.scalar(
        select(FeedbackFollower.email).where(
            FeedbackFollower.feedback_id == fb.id, FeedbackFollower.email == user.email
        )
    )
    return follower is not None


# --- submitting -------------------------------------------------------------------------


@dataclass
class Submission:
    user: User
    draft: Draft
    context: dict[str, Any]
    channel: str = "chat"
    session_id: str | None = None
    chat_turns: list[tuple[str, str, datetime]] = field(default_factory=list)
    original_text: str = ""
    # A fixed item the duplicate check matched in the chat: linked as a possible regression (D73).
    regression_of: dict[str, str] | None = None


@dataclass
class Created:
    feedback: Feedback
    routing: Routing


async def submit(db: AsyncSession, sub: Submission) -> Created:
    """Save a confirmed draft (or a backup-form entry), route it and notify (brief §4.1, §5.3)."""
    d = sub.draft
    slug = d.get("project_slug") or GENERAL
    project = None if slug == GENERAL else await project_by_slug(db, slug)
    confidence: dict[str, float] = dict(d.get("confidence") or {})
    staff_names = [s.name for s in await list_staff(db)]
    words = mask(sub.original_text or d.get("summary", ""))
    flagged = bool(d.get("flag_abuse")) or is_abusive_about(words, staff_names)

    brief: dict[str, Any] = dict(d.get("brief") or {})
    brief.setdefault("problem", d.get("summary", ""))
    if words and not brief.get("submitter_quote"):
        brief["submitter_quote"] = first_sentence(words, 200)
    if sub.channel == "fallback":
        brief.setdefault("open_gaps", ["Sent through the backup form, so the agent didn't classify it."])

    fb = Feedback(
        submitter_email=sub.user.email,
        submitter_name=sub.user.name,
        project_id=project.id if project else None,
        target_type=d.get("target_type") or (TARGET_FROM_GROUP.get(project.project_group) if project else "other"),
        area=d.get("area"),
        work_type=d.get("work_type"),
        category=d.get("category"),
        priority=d.get("priority"),
        impact=d.get("impact") or "one_person",
        effort=d.get("effort"),
        ai_recommendation={"decision": d.get("recommendation"), "reason": d.get("recommendation_reason", "")}
        if d.get("recommendation")
        else {},
        sentiment=d.get("sentiment"),
        status="new",
        title=(d.get("title") or first_sentence(d.get("summary", ""), 80))[:80],
        summary=d.get("summary") or first_sentence(words),
        ai_confidence=confidence,
        dev_brief=brief,
        context=sub.context,
        channel=sub.channel,
        flagged=flagged,
    )
    db.add(fb)
    await db.flush()

    files = 0
    if sub.session_id:
        result = await db.execute(
            update(Attachment)
            .where(Attachment.session_id == sub.session_id, Attachment.uploaded_by == sub.user.email)
            .values(feedback_id=fb.id)
        )
        files = result.rowcount or 0  # type: ignore[attr-defined]
    for role, text, at in sub.chat_turns:
        db.add(
            FeedbackMessage(
                feedback_id=fb.id,
                author_type="staff" if role == "user" else "agent",
                author_email=sub.user.email if role == "user" else None,
                author_name=sub.user.name if role == "user" else "Feedback agent",
                message_type="chat",
                body=mask(text),
                created_at=at,
            )
        )

    via = "the backup form" if sub.channel == "fallback" else "chat"
    extra = f", {files} file{'s' if files != 1 else ''}" if files else ""
    events.log(
        db, fb.id, sub.user.actor, "received", after={"channel": sub.channel}, public_text=f"Received via {via}{extra}"
    )
    if sub.channel == "chat":
        labels = [
            CATEGORY_LABEL.get(fb.category or "", ""),
            fb.priority or "",
            project.name if project else "project to confirm",
        ]
        events.log(
            db,
            fb.id,
            AGENT,
            "classified",
            after={k: getattr(fb, k) for k in ("work_type", "category", "priority", "impact", "effort")}
            | {"project": slug, "confidence": confidence},
            public_text="Classified: " + ", ".join(x for x in labels if x),
        )

    routing = await route(db, fb, project, float(confidence.get("project", 1.0 if project else 0.0)))
    fb.status = routing.status
    # Shown as "Auto-assigned ... · owner of X" until a person approves, reassigns or corrects it (D56).
    fb.routed = routing.reason
    events.log(
        db, fb.id, SYSTEM, "status", before={"status": "new"}, after={"status": fb.status, "reason": routing.reason}
    )
    if routing.assignee is not None:
        fb.assignee_id = routing.assignee.id
        # Routing is code, not the model (D2), so the system makes the assignment.
        events.log(
            db,
            fb.id,
            SYSTEM,
            "assigned",
            after={"assignee": routing.assignee.google_email, "name": routing.assignee.name, "reason": routing.reason},
            public_text=f"Assigned to {routing.assignee.name}",
        )
    if fb.status == "acknowledged":
        events.log(db, fb.id, SYSTEM, "acknowledged", public_text="Acknowledged: passed on to the team as thanks")
    if sub.regression_of:
        # For the owner only: staff were told in the chat that it was fixed before.
        events.log(db, fb.id, AGENT, "linked", after={"regression_of": sub.regression_of})

    await embeddings.store(db, fb.id, f"{fb.title}. {fb.summary}")
    await _notify_new(db, fb, routing)
    await notifications.refresh_approvals(db)
    return Created(await load(db, feedback_id=fb.id), routing)


async def _notify_new(db: AsyncSession, fb: Feedback, routing: Routing) -> None:
    label = f"{fb.ref_no} · {fb.title}"
    if routing.assignee is not None:
        kind = "praise" if fb.status == "acknowledged" else "assigned"
        title = f"Thanks from staff: {label}" if kind == "praise" else f"New feedback assigned to you: {label}"
        await notifications.notify(
            db,
            [routing.assignee.google_email],
            type=kind,
            title=title,
            body=fb.summary,
            link=notifications.console_link(fb),
            feedback_id=fb.id,
        )
    if fb.flagged:
        await notifications.notify(
            db,
            await notifications.admin_emails(db),
            type="flagged",
            title=f"Flagged feedback needs an Admin: {fb.ref_no}",
            body="The message may be abusive about a colleague. It was not routed to them.",
            link=notifications.console_link(fb),
            feedback_id=fb.id,
        )
    elif fb.priority == "P1" and fb.status in ("awaiting_approval", "needs_review"):
        await notifications.notify(
            db,
            await notifications.admin_emails(db),
            type="approval_p1",
            title=f"P1 needs approval: {label}",
            body=fb.summary,
            link=notifications.console_link(fb),
            feedback_id=fb.id,
        )


async def plus_one(db: AsyncSession, user: User, ref_no: str, comment: str) -> Feedback:
    """Add the user's comment to an existing item instead of opening a new one (brief §4.1.9)."""
    fb = await load(db, ref_no=ref_no)
    if fb.status not in OPEN_STATUSES:
        raise Conflict("closed", "That item is already closed. Send yours as new feedback.")
    if fb.submitter_email != user.email:
        exists = await db.get(FeedbackFollower, (fb.id, user.email))
        if exists is None:
            db.add(FeedbackFollower(feedback_id=fb.id, email=user.email, name=user.name))
    if comment.strip():
        db.add(
            FeedbackMessage(
                feedback_id=fb.id,
                author_type="staff",
                author_email=user.email,
                author_name=user.name,
                message_type="follow_up",
                body=mask(comment.strip())[:4000],
            )
        )
    await db.flush()
    followers = int(
        await db.scalar(select(func.count()).select_from(FeedbackFollower).where(FeedbackFollower.feedback_id == fb.id))
        or 0
    )
    new_impact = "company" if followers >= 10 else "team" if followers >= 1 else fb.impact
    if new_impact != fb.impact:
        events.log(db, fb.id, SYSTEM, "impact", before={"impact": fb.impact}, after={"impact": new_impact})
        fb.impact = new_impact
    events.log(
        db,
        fb.id,
        user.actor,
        "plus_one",
        after={"followers": followers + 1},
        public_text="Another staff member reported the same thing",
    )
    fb.updated_at = _now()
    fb.submitter_replied_at = _now()
    await notifications.notify_assignee(
        db, fb, type="plus_one", title=f"+1 on {fb.ref_no}: {fb.title}", body=comment, actor_email=user.email
    )
    return await load(db, feedback_id=fb.id)


# --- My feedback and the tracker --------------------------------------------------------


async def my_feedback(db: AsyncSession, user: User) -> list[Feedback]:
    followed = select(FeedbackFollower.feedback_id).where(FeedbackFollower.email == user.email)
    rows = await db.scalars(
        select(Feedback)
        .options(selectinload(Feedback.project), selectinload(Feedback.assignee))
        .where(or_(Feedback.submitter_email == user.email, Feedback.id.in_(followed)))
        .order_by(Feedback.updated_at.desc())
        .limit(200)
    )
    items = list(rows)
    return sorted(items, key=lambda f: (f.status in CLOSED_STATUSES, -f.updated_at.timestamp()))


@dataclass
class TimelineEntry:
    at: datetime
    text: str
    detail: str | None = None


@dataclass
class TrackerView:
    feedback: Feedback
    status_text: str
    stage: str
    stages: list[dict[str, Any]]
    assignee: dict[str, str] | None
    latest_update: dict[str, Any] | None
    history: list[TimelineEntry]
    merged_into: str | None
    attachments: list[Attachment]
    can_reply: bool
    muted: bool


def _public_text(e: FeedbackEvent) -> str:
    # Approvals logged before D43 read "Approved by Chris"; staff see "Planned (Chris accepted it)".
    if e.event_type == "status" and e.after.get("status") == "approved" and e.actor_name:
        return f"Planned ({e.actor_name} accepted it)"
    return e.public_text or ""


async def tracker(db: AsyncSession, user: User, ref_no: str) -> TrackerView:
    fb = await load(db, ref_no=ref_no)
    if not await can_view(db, user, fb):
        raise NotFound("We can't find that feedback.")  # same answer as unknown: reveals nothing

    public_events = list(
        await db.scalars(
            select(FeedbackEvent)
            .where(FeedbackEvent.feedback_id == fb.id, FeedbackEvent.is_public.is_(True))
            .order_by(FeedbackEvent.created_at, FeedbackEvent.id)
        )
    )
    status_events = list(
        await db.scalars(
            select(FeedbackEvent)
            .where(FeedbackEvent.feedback_id == fb.id, FeedbackEvent.event_type == "status")
            .order_by(FeedbackEvent.created_at)
        )
    )
    messages = list(
        await db.scalars(
            select(FeedbackMessage)
            .where(
                FeedbackMessage.feedback_id == fb.id,
                FeedbackMessage.is_internal.is_(False),
                FeedbackMessage.message_type.in_(("reply", "progress", "follow_up")),
            )
            .order_by(FeedbackMessage.created_at)
        )
    )

    stage = STAGE_OF[fb.status]
    reached: dict[str, datetime] = {"received": fb.created_at}
    for ev in status_events:
        to = STAGE_OF.get(str(ev.after.get("status", "")))
        if to and to not in reached:
            reached[to] = ev.created_at
    current_index = STAGES.index(stage)
    last_label = (
        status_text(fb) if fb.ending else "Acknowledged" if fb.status == "acknowledged" else STAGE_LABEL["closed"]
    )
    stages = [
        {
            "key": s,
            "label": last_label if s == "closed" else STAGE_LABEL[s],
            "state": "done" if i < current_index else "current" if i == current_index else "todo",
            "at": reached.get(s).isoformat() if reached.get(s) and i <= current_index else None,  # type: ignore[union-attr]
        }
        for i, s in enumerate(STAGES)
    ]

    # Messages first, so an update wins a tie with the event logged in the same moment.
    history: list[TimelineEntry] = []
    for m in messages:
        if m.message_type == "progress":
            history.append(TimelineEntry(m.created_at, f"Update: {first_sentence(m.body, 140)}", m.body))
        elif m.message_type == "reply":
            history.append(TimelineEntry(m.created_at, f"Reply from {m.author_name}", m.body))
        elif m.author_email == user.email:
            history.append(TimelineEntry(m.created_at, "You added details", m.body))
        else:
            history.append(TimelineEntry(m.created_at, "Another staff member added details"))
    history += [TimelineEntry(e.created_at, _public_text(e)) for e in public_events]
    history.sort(key=lambda h: h.at, reverse=True)

    latest = next((m for m in reversed(messages) if m.message_type in ("progress", "reply")), None)
    assignee = None
    if fb.assignee is not None:
        owns = fb.project is not None and fb.project.owner_id == fb.assignee.id
        role = "Admin" if fb.assignee.role == "admin" else "Digital Staff"
        assignee = {
            "name": fb.assignee.name,
            "role": f"{role} · {fb.project.name} owner" if owns and fb.project else role,
            "email": fb.assignee.google_email,
        }
    merged = None
    if fb.duplicate_of:
        target = await db.get(Feedback, fb.duplicate_of)
        merged = target.ref_no if target else None
    files = list(
        await db.scalars(select(Attachment).where(Attachment.feedback_id == fb.id).order_by(Attachment.created_at))
    )
    return TrackerView(
        feedback=fb,
        status_text=status_text(fb, merged),
        stage=stage,
        stages=stages,
        assignee=assignee,
        latest_update={"body": latest.body, "author": latest.author_name, "at": latest.created_at.isoformat()}
        if latest
        else None,
        history=history,
        merged_into=merged,
        attachments=files,
        can_reply=fb.status not in CLOSED_STATUSES,
        muted=await notifications.is_muted(db, user.email, fb.id),
    )


async def submitter_reply(db: AsyncSession, user: User, ref_no: str, body: str) -> Feedback:
    """Reply or add details from the tracker. A reply on a Resolved item reopens it (brief §4.2.7)."""
    fb = await load(db, ref_no=ref_no)
    if not await can_view(db, user, fb):
        raise NotFound("We can't find that feedback.")
    if user.is_digital and fb.submitter_email != user.email:
        raise Forbidden("Reply from the console instead.")
    if fb.status in CLOSED_STATUSES:
        raise Conflict("closed", "This item is closed. Send a new piece of feedback instead.")
    db.add(
        FeedbackMessage(
            feedback_id=fb.id,
            author_type="staff",
            author_email=user.email,
            author_name=user.name,
            message_type="follow_up",
            body=mask(body.strip())[:4000],
        )
    )
    fb.submitter_replied_at = _now()
    fb.updated_at = _now()
    if fb.status == "resolved":
        events.log(
            db,
            fb.id,
            user.actor,
            "status",
            before={"status": "resolved"},
            after={"status": "in_progress"},
            public_text="Reopened after you added details",
        )
        fb.status = "in_progress"
        fb.resolved_at = None
    await notifications.settle(db, fb.id, notifications.ANSWER, f"{fb.ref_no}: you replied", recipient=user.email)
    await notifications.notify_assignee(
        db,
        fb,
        type="submitter_reply",
        title=f"{fb.ref_no}: {user.name} added details",
        body=body.strip(),
        actor_email=user.email,
    )
    await db.flush()
    return await load(db, feedback_id=fb.id)


async def project_owner_name(db: AsyncSession, project: Project | None) -> str | None:
    if project is None or project.owner_id is None:
        return None
    owner = await db.get(DigitalStaff, project.owner_id)
    return owner.name if owner else None


def label(fb: Feedback) -> dict[str, str]:
    return {
        "work_type": WORK_TYPE_LABEL.get(fb.work_type or "", ""),
        "category": CATEGORY_LABEL.get(fb.category or "", ""),
        "stage": STAGE_LABEL[STAGE_OF[fb.status]],
        "status": status_text(fb),
    }
