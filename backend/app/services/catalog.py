"""Projects, Digital Staff and routing rules: what the admin page manages (brief §4.4.7, F2).

The project list lives in the database, never in the prompt: a new intranet tool is one form
entry away from being recognised by the agent.
"""

import re
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.errors import Conflict, NotFound, ServiceError
from app.models import DigitalStaff, Feedback, Project, RoutingRule
from app.models.enums import CATEGORIES, OPEN_STATUSES, PROJECT_GROUPS, STAFF_ROLES

# --- projects -------------------------------------------------------------------------


async def list_projects(db: AsyncSession, active_only: bool = True) -> list[Project]:
    query = select(Project).options(selectinload(Project.owner)).order_by(Project.project_group, Project.name)
    if active_only:
        query = query.where(Project.active.is_(True))
    return list(await db.scalars(query))


async def project_by_slug(db: AsyncSession, slug: str, active_only: bool = True) -> Project | None:
    query = select(Project).options(selectinload(Project.owner)).where(Project.slug == slug)
    if active_only:
        query = query.where(Project.active.is_(True))
    project: Project | None = await db.scalar(query)
    return project


UNSURE_RE = re.compile(r"\b(not sure|unsure|don'?t know|no idea|dunno)\b")


def named_in(said: str, project: Any) -> bool:
    """Whether the person's words name the project: its name, an alias or a keyword, as whole words.

    Words end at anything but a Latin letter or digit, not at \\b: in "Flipbook的页面" the Chinese
    characters count as word characters, so \\b would miss the name.
    """
    low = said.lower()
    words = [project.name, project.slug.replace("-", " "), *project.aliases, *project.keywords]
    return any(re.search(rf"(?<![a-z0-9]){re.escape(w.lower())}(?![a-z0-9])", low) for w in words if w)


def _clean_list(values: Any) -> list[str]:
    return sorted({str(v).strip().lower() for v in (values or []) if str(v).strip()})


async def save_project(db: AsyncSession, data: dict[str, Any], project_id: uuid.UUID | None = None) -> Project:
    if project_id is None:
        if await db.scalar(select(Project.id).where(Project.slug == data["slug"])) is not None:
            raise Conflict("slug_taken", "Another project already uses that short name.")
        project = Project(slug=data["slug"], name=data["name"], project_group=data["project_group"])
        db.add(project)
    else:
        found = await db.get(Project, project_id)
        if found is None:
            raise NotFound("No such project.")
        project = found
    if "project_group" in data and data["project_group"] not in PROJECT_GROUPS:
        raise ServiceError("bad_value", "Group must be platforms, agents or other.")
    for field in ("name", "project_group", "description", "active"):
        if field in data and data[field] is not None:
            setattr(project, field, data[field])
    for field in ("keywords", "aliases"):
        if field in data and data[field] is not None:
            setattr(project, field, _clean_list(data[field]))
    if "owner_id" in data:
        if data["owner_id"] is not None and await db.get(DigitalStaff, data["owner_id"]) is None:
            raise ServiceError("bad_value", "Unknown owner.")
        project.owner_id = data["owner_id"]
    await db.flush()
    loaded = await project_by_slug(db, project.slug, active_only=False)
    assert loaded is not None
    return loaded


# --- Digital Staff ----------------------------------------------------------------------


async def list_staff(db: AsyncSession, active_only: bool = False) -> list[DigitalStaff]:
    query = select(DigitalStaff).order_by(DigitalStaff.name)
    if active_only:
        query = query.where(DigitalStaff.active.is_(True))
    return list(await db.scalars(query))


async def open_counts(db: AsyncSession) -> dict[uuid.UUID, int]:
    rows = await db.execute(
        select(Feedback.assignee_id, func.count())
        .where(Feedback.assignee_id.is_not(None), Feedback.status.in_(OPEN_STATUSES))
        .group_by(Feedback.assignee_id)
    )
    return {aid: int(n) for aid, n in rows if aid is not None}


async def save_staff(db: AsyncSession, data: dict[str, Any], staff_id: uuid.UUID | None = None) -> DigitalStaff:
    if staff_id is None:
        email = str(data["google_email"]).strip().lower()
        if await db.scalar(select(DigitalStaff.id).where(DigitalStaff.google_email == email)) is not None:
            raise Conflict("email_taken", "That person is already on the list.")
        staff = DigitalStaff(google_email=email, name=data["name"], role=data.get("role") or "digital")
        db.add(staff)
    else:
        found = await db.get(DigitalStaff, staff_id)
        if found is None:
            raise NotFound("No such person.")
        staff = found
    if "role" in data and data["role"] is not None and data["role"] not in STAFF_ROLES:
        raise ServiceError("bad_value", "Role must be digital or admin.")
    for field in ("name", "role", "is_away", "is_triage_lead", "active"):
        if field in data and data[field] is not None:
            setattr(staff, field, data[field])
    if "skills" in data and data["skills"] is not None:
        staff.skills = _clean_list(data["skills"])
    await db.flush()
    return staff


# --- routing rules ----------------------------------------------------------------------


async def list_rules(db: AsyncSession) -> list[RoutingRule]:
    return list(await db.scalars(select(RoutingRule).order_by(RoutingRule.priority_order, RoutingRule.created_at)))


async def save_rule(db: AsyncSession, data: dict[str, Any], rule_id: uuid.UUID | None = None) -> RoutingRule:
    if data.get("category") is not None and data["category"] not in CATEGORIES:
        raise ServiceError("bad_value", "Unknown category.")
    if rule_id is None:
        rule = RoutingRule(assignee_id=data["assignee_id"])
        db.add(rule)
    else:
        found = await db.get(RoutingRule, rule_id)
        if found is None:
            raise NotFound("No such rule.")
        rule = found
    for field in ("project_id", "category", "assignee_id", "priority_order", "active"):
        if field in data:
            setattr(rule, field, data[field])
    if rule.assignee_id is None or await db.get(DigitalStaff, rule.assignee_id) is None:
        raise ServiceError("bad_value", "Pick who the rule assigns to.")
    await db.flush()
    return rule


async def delete_rule(db: AsyncSession, rule_id: uuid.UUID) -> None:
    rule = await db.get(RoutingRule, rule_id)
    if rule is None:
        raise NotFound("No such rule.")
    await db.delete(rule)
