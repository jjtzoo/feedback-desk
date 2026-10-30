"""Dashboard numbers and the daily digests (brief §4.4.6, §4.5.7, §4.6). Computed from feedback,
feedback_events and release_item_thanks; no separate metrics store."""

import statistics
import uuid
from bisect import bisect_right
from collections import defaultdict
from collections.abc import Callable
from datetime import UTC, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.errors import Forbidden, ServiceError
from app.models import DigitalStaff, Feedback, FeedbackEvent, Project, Release, ReleaseItem, ReleaseItemThanks
from app.models.enums import DUE_STATUSES
from app.services import notifications
from app.services.actors import User

PERIODS = (4, 12)
# Where it's stuck: how long an item has sat in its stage. Under 2 days, 2 to 7 days, 1 to 4 weeks, over 4 weeks.
AGE_BANDS = (timedelta(days=2), timedelta(days=7), timedelta(days=28))


def business_days_between(start: datetime, end: datetime) -> int:
    days, current = 0, start.date()
    while current < end.date():
        current += timedelta(days=1)
        if current.weekday() < 5:
            days += 1
    return days


async def dashboard(db: AsyncSession, user: User, weeks: int = 4) -> dict[str, Any]:
    """The manager dashboard (D112, Admins only): the last `weeks` weeks against the weeks before them.
    The backlog is every item not yet resolved (New to In progress); a Resolved item waits on its reporter.
    Counted in Python from one read of each table: the backlog on a past day needs each item's status
    history anyway, and a few thousand items take milliseconds."""
    if not user.is_admin:
        raise Forbidden("The dashboard is for Admins.")
    if weeks not in PERIODS:
        raise ServiceError("bad_value", "Show the last 4 or 12 weeks.")
    tz = ZoneInfo(get_settings().timezone)
    now = datetime.now(UTC)
    local = now.astimezone(tz)
    monday = datetime.combine(local.date() - timedelta(days=local.weekday()), time(), tz)
    # The weeks before this period, then this period's, each from a Monday; this week runs to now.
    starts = [monday - timedelta(weeks=i) for i in range(2 * weeks - 1, -1, -1)]
    ends = [*starts[1:], now]

    def week_of(when: datetime | None) -> int | None:
        if when is None or when < starts[0] or when > now:
            return None
        return bisect_right(starts, when) - 1

    def in_period(when: datetime | None) -> bool:
        i = week_of(when)
        return i is not None and i >= weeks

    items: list[Any] = list(
        await db.execute(
            select(
                Feedback.id,
                Feedback.created_at,
                Feedback.first_response_at,
                Feedback.expected_by,
                Feedback.status,
                Feedback.project_id,
                Feedback.assignee_id,
                Feedback.duplicate_of,
                Feedback.channel,
            )
        )
    )
    moves: dict[uuid.UUID, list[tuple[datetime, dict[str, Any], dict[str, Any]]]] = defaultdict(list)
    for fid, at, before, after in await db.execute(
        select(FeedbackEvent.feedback_id, FeedbackEvent.created_at, FeedbackEvent.before, FeedbackEvent.after)
        .where(FeedbackEvent.event_type == "status")
        .order_by(FeedbackEvent.created_at)
    ):
        moves[fid].append((at, before, after))
    # Each item's stages in order, from when it arrived (its first move says where it started).
    steps = {
        fb.id: [
            (fb.created_at, (moves[fb.id][0][1].get("status") if moves[fb.id] else None) or fb.status),
            *((at, after["status"]) for at, _, after in moves[fb.id]),
        ]
        for fb in items
    }
    # Taken from the moves, since a reopen clears resolved_at: (item, when) for every resolve and every reopen.
    by_id = {fb.id: fb for fb in items}
    resolutions = [(by_id[f], at) for f, evs in moves.items() for at, _, after in evs if after["status"] == "resolved"]
    reopens = [(by_id[f], at) for f, evs in moves.items() for at, _, after in evs if after.get("reopened")]

    def status_at(fid: uuid.UUID, when: datetime) -> str | None:
        current = None
        for at, status in steps[fid]:
            if at > when:
                break
            current = status
        return current

    def backlog_at(when: datetime) -> int:
        return sum(1 for fb in items if status_at(fb.id, when) in DUE_STATUSES)

    Points = list[tuple[datetime | None, float]]

    def summary(points: Points, combine: Callable[[list[float]], float | None]) -> dict[str, Any]:
        by_week: list[list[float]] = [[] for _ in starts]
        for when, value in points:
            if (i := week_of(when)) is not None:
                by_week[i].append(value)
        this = [v for w in by_week[weeks:] for v in w]
        return {
            "value": combine(this),
            "previous": combine([v for w in by_week[:weeks] for v in w]),
            "trend": [combine(w) for w in by_week[weeks:]],
            "count": len(this),
        }

    def median(values: list[float]) -> float | None:
        return round(statistics.median(values), 1) if values else None

    def share(values: list[float]) -> float | None:
        return round(sum(values) / len(values), 3) if values else None

    def oldest(group: list[Any]) -> int | None:
        return max(((now - fb.created_at).days for fb in group), default=None)

    open_now = [fb for fb in items if fb.status in DUE_STATUSES]
    backlog_trend = [backlog_at(end) for end in ends[weeks:]]

    received_by_week, resolved_by_week = [0] * len(starts), [0] * len(starts)
    for fb in items:
        if (i := week_of(fb.created_at)) is not None:
            received_by_week[i] += 1
    for _, at in resolutions:
        if (i := week_of(at)) is not None:
            resolved_by_week[i] += 1

    stuck = {stage: [0] * (len(AGE_BANDS) + 1) for stage in DUE_STATUSES}
    for fb in open_now:
        stuck[fb.status][bisect_right(AGE_BANDS, now - steps[fb.id][-1][0])] += 1

    thanks: dict[uuid.UUID | None, int] = defaultdict(int)
    for project_id, at in await db.execute(
        select(Release.project_id, ReleaseItemThanks.created_at)
        .join(ReleaseItem, ReleaseItem.id == ReleaseItemThanks.release_item_id)
        .join(Release, Release.id == ReleaseItem.release_id)
    ):
        if in_period(at):
            thanks[project_id] += 1
    corrected = set(
        await db.scalars(
            select(FeedbackEvent.feedback_id).where(
                FeedbackEvent.event_type == "correction", FeedbackEvent.before.has_key("project")
            )
        )
    )

    by_project: dict[uuid.UUID | None, list[Any]] = defaultdict(list)
    for fb in items:
        by_project[fb.project_id].append(fb)
    names = {p.id: p for p in await db.scalars(select(Project))}
    tools = []
    for pid in set(by_project) | set(thanks):
        group = by_project.get(pid, [])
        mine = [fb for fb in group if fb.status in DUE_STATUSES]
        row = {
            "slug": names[pid].slug if pid else None,
            "name": names[pid].name if pid else "General",
            "new": sum(in_period(fb.created_at) for fb in group),
            "open": len(mine),
            "oldest_days": oldest(mine),
            "reopened": sum(1 for fb, at in reopens if fb.project_id == pid and in_period(at)),
            "resolved": sum(1 for fb, at in resolutions if fb.project_id == pid and in_period(at)),
            "thanks": thanks.get(pid, 0),
        }
        if any(row[k] for k in ("new", "open", "reopened", "resolved", "thanks")):
            tools.append(row)
    tools.sort(key=lambda r: (-int(r["open"] or 0), str(r["name"])))

    def workload(key: str, name: str, group: list[Any]) -> dict[str, Any]:
        # Overdue as the Overdue inbox counts it, so the row's link shows the same items.
        late = sum(1 for fb in group if fb.expected_by is not None and fb.expected_by < now.date())
        return {"id": key, "name": name, "open": len(group), "overdue": late, "oldest_days": oldest(group)}

    team = [
        workload(str(s.id), s.name, [fb for fb in open_now if fb.assignee_id == s.id])
        for s in await db.scalars(select(DigitalStaff).order_by(DigitalStaff.name))
    ]
    if nobody := [fb for fb in open_now if fb.assignee_id is None]:
        team.append(workload("none", "Unassigned", nobody))
    team.sort(key=lambda r: -int(r["open"]))

    def rate(count: int, of: int) -> dict[str, Any]:
        return {"count": count, "of": of, "rate": round(count / of, 3) if of else None}

    received = [fb for fb in items if in_period(fb.created_at)]
    reopened = sum(1 for _, at in reopens if in_period(at))
    chat = [fb for fb in received if fb.channel == "chat"]
    return {
        "weeks": weeks,
        "backlog": {
            "value": len(open_now),
            "previous": backlog_at(starts[weeks]),
            "trend": backlog_trend,
            "count": len(open_now),
        },
        "first_response_hours": summary(
            [
                (fb.first_response_at, (fb.first_response_at - fb.created_at).total_seconds() / 3600)
                for fb in items
                if fb.first_response_at
            ],
            median,
        ),
        "resolve_days": summary([(at, (at - fb.created_at).total_seconds() / 86400) for fb, at in resolutions], median),
        "on_time": summary(
            [
                (at, float(at.astimezone(tz).date() <= fb.expected_by))
                for fb, at in resolutions
                if fb.expected_by is not None
            ],
            share,
        ),
        "flow": [
            {
                "week": starts[i].date().isoformat(),
                "received": received_by_week[i],
                "resolved": resolved_by_week[i],
                "backlog": backlog_trend[i - weeks],
            }
            for i in range(weeks, 2 * weeks)
        ],
        "stuck": [{"stage": stage, "bands": stuck[stage]} for stage in DUE_STATUSES],
        "approvals_over_2_days": sum(
            1 for fb in open_now if fb.status == "awaiting_approval" and business_days_between(fb.created_at, now) > 2
        ),
        "tools": tools,
        "team": team,
        "quality": {
            "reopened": rate(reopened, sum(in_period(at) for _, at in resolutions)),
            "duplicates": rate(sum(fb.duplicate_of is not None for fb in received), len(received)),
            "corrections": rate(sum(fb.id in corrected for fb in chat), len(chat)),
            "thanks": sum(thanks.values()),
        },
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
