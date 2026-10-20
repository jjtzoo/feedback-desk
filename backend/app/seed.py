"""Load seed/*.yaml into an empty or partly seeded database. Idempotent: running it twice
changes nothing, and it never overwrites what an Admin changed on the admin page.

    python -m app.seed
"""

import asyncio
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import dispose_engine, session_scope
from app.models import DigitalStaff, Project, RoutingRule

SEED_DIR = Path(__file__).resolve().parent.parent / "seed"


def load(name: str) -> list[dict[str, Any]]:
    data = yaml.safe_load((SEED_DIR / f"{name}.yaml").read_text(encoding="utf-8"))
    return list(data[name])


async def seed_staff(db: AsyncSession, rows: list[dict[str, Any]]) -> int:
    added = 0
    for row in rows:
        email = row["google_email"].strip().lower()
        if await db.scalar(select(DigitalStaff).where(DigitalStaff.google_email == email)) is None:
            db.add(
                DigitalStaff(
                    google_email=email,
                    name=row["name"],
                    role=row.get("role", "digital"),
                    skills=row.get("skills", []),
                    is_triage_lead=row.get("is_triage_lead", False),
                )
            )
            added += 1
    await db.flush()
    return added


async def seed_projects(db: AsyncSession, rows: list[dict[str, Any]]) -> int:
    added = 0
    for row in rows:
        if await db.scalar(select(Project).where(Project.slug == row["slug"])) is not None:
            continue
        owner = await db.scalar(select(DigitalStaff).where(DigitalStaff.google_email == row["owner"].lower()))
        db.add(
            Project(
                slug=row["slug"],
                name=row["name"],
                project_group=row["group"],
                description=row.get("description", ""),
                keywords=row.get("keywords", []),
                aliases=row.get("aliases", []),
                owner_id=owner.id if owner else None,
            )
        )
        added += 1
    await db.flush()
    return added


async def seed_rules(db: AsyncSession, rows: list[dict[str, Any]]) -> int:
    if await db.scalar(select(RoutingRule.id).limit(1)) is not None:
        return 0  # rules are managed on the admin page once any exist
    added = 0
    for row in rows:
        assignee = await db.scalar(select(DigitalStaff).where(DigitalStaff.google_email == row["assignee"].lower()))
        project = await db.scalar(select(Project).where(Project.slug == row["project"])) if row.get("project") else None
        if assignee is None:
            continue
        db.add(
            RoutingRule(
                project_id=project.id if project else None,
                category=row.get("category"),
                assignee_id=assignee.id,
                priority_order=row.get("priority_order", 100),
            )
        )
        added += 1
    return added


async def seed_all(db: AsyncSession) -> tuple[int, int, int]:
    staff = await seed_staff(db, load("digital_staff"))
    projects = await seed_projects(db, load("projects"))
    rules = await seed_rules(db, load("routing_rules"))
    return staff, projects, rules


async def run() -> None:
    async with session_scope() as db:
        staff, projects, rules = await seed_all(db)
    await dispose_engine()
    print(f"Seed done: {staff} Digital Staff, {projects} projects, {rules} routing rules added.")


if __name__ == "__main__":
    asyncio.run(run())
