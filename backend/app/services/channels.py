"""Private project channels for Digital Staff (brief §4.7). Staff never see them."""

import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import Forbidden, NotFound, ServiceError
from app.models import DigitalStaff, Feedback, Project, ProjectMessage
from app.services import notifications
from app.services.actors import User
from app.services.catalog import project_by_slug
from app.services.console import require_digital

MENTION = re.compile(r"@([A-Za-z][\w.-]*)")
FB_REF = re.compile(r"#(FB-\d{4,})", re.IGNORECASE)


async def _project(db: AsyncSession, slug: str) -> Project:
    project = await project_by_slug(db, slug, active_only=False)
    if project is None:
        raise NotFound("No such project.")
    return project


async def messages(
    db: AsyncSession, user: User, slug: str
) -> tuple[Project, list[ProjectMessage], dict[str, dict[str, str]]]:
    """The channel, pinned first, plus the live stage of every #FB chip in it."""
    require_digital(user)
    project = await _project(db, slug)
    rows = list(
        await db.scalars(
            select(ProjectMessage)
            .where(ProjectMessage.project_id == project.id)
            .order_by(ProjectMessage.pinned.desc(), ProjectMessage.created_at.desc())
            .limit(200)
        )
    )
    refs = {r for m in rows for r in m.feedback_refs}
    chips: dict[str, dict[str, str]] = {}
    if refs:
        for fb in await db.scalars(select(Feedback).where(Feedback.ref_no.in_(refs))):
            chips[fb.ref_no] = {"title": fb.title, "status": fb.status}
    return project, rows, chips


async def post(db: AsyncSession, user: User, slug: str, body: str) -> ProjectMessage:
    require_digital(user)
    text = body.strip()
    if not text:
        raise ServiceError("empty", "Write a message first.")
    project = await _project(db, slug)
    staff = list(await db.scalars(select(DigitalStaff).where(DigitalStaff.active.is_(True))))
    by_first = {s.name.split()[0].lower(): s for s in staff}
    mentioned = [by_first[m.lower()] for m in MENTION.findall(text) if m.lower() in by_first]
    refs = sorted({r.upper() for r in FB_REF.findall(text)})
    known = set(await db.scalars(select(Feedback.ref_no).where(Feedback.ref_no.in_(refs)))) if refs else set()
    msg = ProjectMessage(
        project_id=project.id,
        author_email=user.email,
        author_name=user.name,
        body=text[:8000],
        mentions=sorted({s.google_email for s in mentioned}),
        feedback_refs=sorted(known),
    )
    db.add(msg)
    await db.flush()
    if mentioned:
        await notifications.notify(
            db,
            [s.google_email for s in mentioned],
            type="mention",
            title=f"{user.name} mentioned you in #{project.slug}",
            body=text[:300],
            link=f"/console/channels/{project.slug}",
            actor_email=user.email,
        )
    return msg


async def pin(db: AsyncSession, user: User, message_id: str, pinned: bool) -> ProjectMessage:
    require_digital(user)
    import uuid

    msg = await db.get(ProjectMessage, uuid.UUID(message_id))
    if msg is None:
        raise NotFound("No such message.")
    project = await db.get(Project, msg.project_id)
    if not (user.is_admin or (project and project.owner_id == user.staff_id) or msg.author_email == user.email):
        raise Forbidden("The project owner keeps the channel tidy.")
    msg.pinned = pinned
    return msg
