"""Friday releases (brief §4.8). The drafter writes a release for each project with activity
that week; the owner ticks, edits and publishes. Nothing publishes automatically.

Drafter guardrails: it only summarises the sources, never invents changes, never names the
staff who reported issues, and never copies internal notes. Items from progress updates start
unticked, so internal detail is never published by accident.
"""

import uuid
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.errors import Conflict, Forbidden, NotFound, ServiceError
from app.models import (
    Feedback,
    FeedbackFollower,
    FeedbackMessage,
    Project,
    Release,
    ReleaseItem,
    ReleaseItemThanks,
)
from app.services import events, notifications, sig_updates
from app.services.actors import SYSTEM, User
from app.services.console import require_digital
from app.services.drafts import first_sentence

SECTION = {"new_feature": "New", "improvement": "Improved", "fix": "Fixed"}


def week_bounds(week_ending: date) -> tuple[datetime, datetime]:
    """Saturday 00:00 to the next Saturday 00:00 (local time) for the week ending on Friday."""
    tz = ZoneInfo(get_settings().timezone)
    end = datetime.combine(week_ending + timedelta(days=1), time.min, tz)
    return end - timedelta(days=7), end


def this_friday(today: date | None = None) -> date:
    today = today or datetime.now(ZoneInfo(get_settings().timezone)).date()
    return today + timedelta(days=(4 - today.weekday()) % 7)


async def draft_week(db: AsyncSession, week_ending: date) -> list[Release]:
    """Create drafts for every active project with activity in the week. Idempotent."""
    start, end = week_bounds(week_ending)
    created: list[Release] = []
    for project in await db.scalars(select(Project).where(Project.active.is_(True))):
        exists = await db.scalar(
            select(Release.id).where(Release.project_id == project.id, Release.week_ending == week_ending)
        )
        if exists is not None:
            continue
        items = await _sources(db, project, start, end)
        if not items:
            continue  # nothing to report: no draft
        release = Release(project_id=project.id, week_ending=week_ending, status="draft")
        db.add(release)
        await db.flush()
        for order, item in enumerate(items):
            db.add(ReleaseItem(release_id=release.id, sort_order=order, **item))
        created.append(release)
        if project.owner_id:
            from app.models import DigitalStaff

            owner = await db.get(DigitalStaff, project.owner_id)
            if owner:
                await notifications.notify(
                    db,
                    [owner.google_email],
                    type="release_draft",
                    title=f"This week's {project.name} release is ready to review",
                    link=f"/console/releases/{release.id}",
                )
    return created


async def _sources(db: AsyncSession, project: Project, start: datetime, end: datetime) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    resolved = await db.scalars(
        select(Feedback).where(
            Feedback.project_id == project.id,
            Feedback.resolved_at >= start,
            Feedback.resolved_at < end,
            Feedback.work_type.in_(tuple(SECTION)),
        )
    )
    for fb in resolved:
        # Sig words it for staff ("Big PDFs no longer time out"); the item's own words when the model is off (D111).
        facts = f"Tool: {project.name}\nWork type: {fb.work_type}\nTitle: {fb.title}\nSummary: {fb.summary}"
        out.append(
            {
                "title": (await sig_updates.say(db, fb.title, facts, sig_updates.RELEASE_TITLE))[:200],
                "body": await sig_updates.say(db, first_sentence(fb.summary, 200), facts, sig_updates.RELEASE_BODY),
                "work_type": fb.work_type,
                "source_type": "feedback",
                "source_id": fb.id,
                "visible_to_staff": True,
            }
        )
    progress = await db.execute(
        select(FeedbackMessage, Feedback)
        .join(Feedback, Feedback.id == FeedbackMessage.feedback_id)
        .where(
            Feedback.project_id == project.id,
            FeedbackMessage.message_type == "progress",
            FeedbackMessage.is_internal.is_(False),
            FeedbackMessage.created_at >= start,
            FeedbackMessage.created_at < end,
            Feedback.status == "in_progress",
        )
    )
    seen: set[uuid.UUID] = set()
    for msg, fb in progress:
        if fb.id in seen:
            continue
        seen.add(fb.id)
        out.append(
            {
                "title": fb.title,
                "body": first_sentence(msg.body, 200),
                "work_type": fb.work_type if fb.work_type in SECTION else None,
                "source_type": "progress",
                "source_id": msg.id,
                "visible_to_staff": False,
            }
        )
    return out


async def _release(db: AsyncSession, release_id: uuid.UUID) -> Release:
    release = await db.get(Release, release_id)
    if release is None:
        raise NotFound("No such release.")
    return release


async def can_publish(db: AsyncSession, user: User, release: Release) -> bool:
    project = await db.get(Project, release.project_id)
    return user.is_admin or (project is not None and project.owner_id == user.staff_id)


async def get(db: AsyncSession, user: User, release_id: uuid.UUID) -> tuple[Release, Project, list[ReleaseItem]]:
    require_digital(user)
    release = await _release(db, release_id)
    project = await db.get(Project, release.project_id)
    assert project is not None
    items = list(
        await db.scalars(
            select(ReleaseItem).where(ReleaseItem.release_id == release.id).order_by(ReleaseItem.sort_order)
        )
    )
    return release, project, items


async def list_releases(db: AsyncSession, user: User) -> list[tuple[Release, Project, int, int]]:
    """Newest weeks first, each with how many items it holds and how many staff can see."""
    require_digital(user)
    rows = await db.execute(
        select(Release, Project)
        .join(Project, Project.id == Release.project_id)
        .order_by(Release.week_ending.desc(), Project.name)
        .limit(100)
    )
    counts = {
        release_id: (int(total), int(shown))
        for release_id, total, shown in await db.execute(
            select(ReleaseItem.release_id, func.count(), func.count().filter(ReleaseItem.visible_to_staff)).group_by(
                ReleaseItem.release_id
            )
        )
    }
    return [(r, p, *counts.get(r.id, (0, 0))) for r, p in rows]


async def save_items(db: AsyncSession, user: User, release_id: uuid.UUID, items: list[dict[str, Any]]) -> None:
    """The owner's edits: tick, reword, add or remove items. Only drafts can change."""
    release = await _release(db, release_id)
    if not await can_publish(db, user, release):
        raise Forbidden("Only the project owner or an Admin can edit this release.")
    if release.status != "draft":
        raise Conflict("published", "This release is already published.")
    existing = {i.id: i for i in await db.scalars(select(ReleaseItem).where(ReleaseItem.release_id == release.id))}
    keep: set[uuid.UUID] = set()
    for order, data in enumerate(items):
        title = str(data.get("title", "")).strip()
        if not title:
            raise ServiceError("empty", "Every item needs a title.")
        item_id = uuid.UUID(data["id"]) if data.get("id") else None
        if item_id and item_id in existing:
            item = existing[item_id]
        else:
            item = ReleaseItem(release_id=release.id, source_type="manual")
            db.add(item)
        item.title = title[:200]
        item.body = str(data.get("body", ""))[:2000]
        item.work_type = data.get("work_type") if data.get("work_type") in SECTION else None
        item.visible_to_staff = bool(data.get("visible_to_staff"))
        item.sort_order = order
        if item_id:
            keep.add(item_id)
    for item_id, item in existing.items():
        if item_id not in keep:
            await db.delete(item)


async def publish(db: AsyncSession, user: User, release_id: uuid.UUID) -> Release:
    release = await _release(db, release_id)
    if not await can_publish(db, user, release):
        raise Forbidden("Only the project owner or an Admin can publish.")
    if release.status == "published":
        raise Conflict("published", "This release is already published.")
    items = list(
        await db.scalars(
            select(ReleaseItem).where(ReleaseItem.release_id == release.id, ReleaseItem.visible_to_staff.is_(True))
        )
    )
    if not items:
        raise ServiceError("empty", "Tick at least one item for staff to see.")
    project = await db.get(Project, release.project_id)
    release.status = "published"
    release.approved_by = user.email
    release.published_at = datetime.now(UTC)
    for item in items:
        if item.source_type != "feedback" or item.source_id is None:
            continue
        fb = await db.get(Feedback, item.source_id)
        if fb is None:
            continue
        name = project.name if project else "this"
        events.log(
            db,
            fb.id,
            SYSTEM,
            "released",
            after={"release": str(release.id)},
            public_text=f"Included in the {name} release for the week ending {release.week_ending:%d %b}",
        )
        recipients = [
            fb.submitter_email,
            *await db.scalars(select(FeedbackFollower.email).where(FeedbackFollower.feedback_id == fb.id)),
        ]
        await notifications.notify(
            db,
            recipients,
            type="release",
            title=f"Your feedback made it into this week's {name} fixes and updates",
            body=item.title,
            link="/whats-new",
            feedback_id=fb.id,
        )
    return release


async def whats_new(db: AsyncSession) -> list[tuple[Release, Project, list[ReleaseItem]]]:
    rows = await db.execute(
        select(Release, Project)
        .join(Project, Project.id == Release.project_id)
        .where(Release.status == "published")
        .order_by(Release.published_at.desc())
        .limit(60)
    )
    out = []
    for release, project in rows:
        items = list(
            await db.scalars(
                select(ReleaseItem)
                .where(ReleaseItem.release_id == release.id, ReleaseItem.visible_to_staff.is_(True))
                .order_by(ReleaseItem.sort_order)
            )
        )
        out.append((release, project, items))
    return out


async def thanks_for(db: AsyncSession, ids: list[uuid.UUID], email: str) -> tuple[dict[uuid.UUID, int], set[uuid.UUID]]:
    """Each item's 👍 Thanks count, and the items this person thanked (D110)."""
    if not ids:
        return {}, set()
    rows = await db.execute(
        select(ReleaseItemThanks.release_item_id, func.count())
        .where(ReleaseItemThanks.release_item_id.in_(ids))
        .group_by(ReleaseItemThanks.release_item_id)
    )
    mine = await db.scalars(
        select(ReleaseItemThanks.release_item_id).where(
            ReleaseItemThanks.release_item_id.in_(ids), ReleaseItemThanks.email == email
        )
    )
    return {i: int(n) for i, n in rows.all()}, set(mine)


async def set_thanks(db: AsyncSession, item_id: uuid.UUID, email: str, on: bool) -> None:
    """Give or take back a 👍 Thanks, only on an item staff can see in a published release (D110)."""
    item = await db.get(ReleaseItem, item_id)
    release = await db.get(Release, item.release_id) if item else None
    if item is None or release is None or release.status != "published" or not item.visible_to_staff:
        raise NotFound("We can't find that update.")
    if on:
        await db.execute(
            insert(ReleaseItemThanks).values(release_item_id=item_id, email=email).on_conflict_do_nothing()
        )
    else:
        await db.execute(
            delete(ReleaseItemThanks).where(
                ReleaseItemThanks.release_item_id == item_id, ReleaseItemThanks.email == email
            )
        )
