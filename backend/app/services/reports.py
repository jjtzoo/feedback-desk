"""Dashboard numbers and the daily digests (brief §4.4.6, §4.5.7, §4.6). Computed from feedback
and feedback_events; no separate metrics store."""

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DigitalStaff, Feedback, FeedbackEvent, Project
from app.models.enums import OPEN_STATUSES
from app.services import notifications
from app.services.actors import User
from app.services.console import require_digital


def business_days_between(start: datetime, end: datetime) -> int:
    days, current = 0, start.date()
    while current < end.date():
        current += timedelta(days=1)
        if current.weekday() < 5:
            days += 1
    return days


async def dashboard(db: AsyncSession, user: User) -> dict[str, Any]:
    require_digital(user)
    now = datetime.now(UTC)
    open_ = Feedback.status.in_(OPEN_STATUSES)

    async def grouped(column: Any, *joins: Any) -> list[dict[str, Any]]:
        query = select(column, func.count()).select_from(Feedback)
        for j in joins:
            query = query.outerjoin(*j)
        rows = await db.execute(query.where(open_).group_by(column).order_by(func.count().desc()))
        return [{"label": label or "Unassigned", "count": int(n)} for label, n in rows]

    weeks = []
    for i in range(7, -1, -1):
        start = (now - timedelta(days=now.weekday(), weeks=i)).replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=7)
        received = await db.scalar(
            select(func.count()).select_from(Feedback).where(Feedback.created_at >= start, Feedback.created_at < end)
        )
        resolved = await db.scalar(
            select(func.count()).select_from(Feedback).where(Feedback.resolved_at >= start, Feedback.resolved_at < end)
        )
        weeks.append({"week": start.date().isoformat(), "received": int(received or 0), "resolved": int(resolved or 0)})

    response = await db.scalar(
        select(func.avg(func.extract("epoch", Feedback.first_response_at - Feedback.created_at))).where(
            Feedback.first_response_at.is_not(None)
        )
    )
    waiting = list(await db.scalars(select(Feedback.created_at).where(Feedback.status == "awaiting_approval")))
    total = int(await db.scalar(select(func.count()).select_from(Feedback).where(Feedback.channel == "chat")) or 0)
    corrected = int(
        await db.scalar(
            select(func.count(func.distinct(FeedbackEvent.feedback_id))).where(
                FeedbackEvent.event_type == "correction", FeedbackEvent.before.has_key("project")
            )
        )
        or 0
    )
    return {
        "open_by_project": await grouped(Project.name, (Project, Project.id == Feedback.project_id)),
        "open_by_assignee": await grouped(DigitalStaff.name, (DigitalStaff, DigitalStaff.id == Feedback.assignee_id)),
        "open_by_category": await grouped(Feedback.category),
        "open_by_work_type": await grouped(Feedback.work_type),
        "weekly": weeks,
        "avg_first_response_hours": round(float(response) / 3600, 1) if response else None,
        "approvals_waiting": len(waiting),
        "approvals_over_2_days": sum(1 for c in waiting if business_days_between(c, now) > 2),
        "project_reassignment_rate": round(corrected / total, 3) if total else None,
    }


async def daily_digest(db: AsyncSession) -> int:
    """Needs review older than 24 hours to the triage lead; a daily approvals summary to Admins."""
    now = datetime.now(UTC)
    sent = 0
    stale = int(
        await db.scalar(
            select(func.count())
            .select_from(Feedback)
            .where(Feedback.status.in_(("needs_review", "new")), Feedback.created_at < now - timedelta(hours=24))
        )
        or 0
    )
    if stale:
        sent += await notifications.notify(
            db,
            await notifications.triage_lead_emails(db),
            type="digest",
            title=f"{stale} item{'s' if stale != 1 else ''} in Needs review for over a day",
            link="/console?inbox=needs_review",
        )
    waiting = list(
        await db.scalars(
            select(Feedback.created_at).where(Feedback.status == "awaiting_approval", Feedback.priority != "P1")
        )
    )
    if waiting:
        overdue = sum(1 for c in waiting if business_days_between(c, now) > 2)
        extra = f", {overdue} waiting over 2 business days" if overdue else ""
        sent += await notifications.notify(
            db,
            await notifications.admin_emails(db),
            type="approvals_summary",
            title=f"{len(waiting)} item{'s' if len(waiting) != 1 else ''} waiting for approval{extra}",
            link="/console/approvals",
        )
    await notifications.prune(db)
    return sent
