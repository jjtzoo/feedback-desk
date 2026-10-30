"""Fourteen weeks of made-up feedback history, so the manager dashboard (D112) has something to show
locally: items raised by the demo staff, moved through approval, work, resolve and close (some
reopened, some duplicates, some routing corrections), and published Friday releases with 👍 Thanks.
Local only; runs once (a second run changes nothing).

    uv run python -m scripts.demo_history

Uses DATABASE_URL when set, otherwise the local database that scripts.dev_server uses.
"""

import asyncio
import os
import random
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select

DAYS = 98
MARK = "demo_history"

# (category, weight, work type, titles); {tool} becomes the project's name.
KINDS: list[tuple[str, int, str | None, list[str]]] = [
    (
        "bug",
        34,
        "fix",
        [
            "{tool} export to PDF times out",
            "{tool} shows a blank page after sign-in",
            "{tool} search returns nothing for site names",
            "{tool} saves the wrong date on reports",
            "{tool} upload fails for photos from the phone",
        ],
    ),
    ("performance", 10, "fix", ["{tool} takes a minute to load the list", "{tool} freezes when filtering by month"]),
    ("data_issue", 8, "fix", ["{tool} has last month's figures twice", "{tool} lists a site that closed"]),
    (
        "usability",
        15,
        "improvement",
        ["{tool} hides the save button on small screens", "{tool} asks for the same details twice"],
    ),
    (
        "feature_request",
        15,
        "new_feature",
        ["Export {tool} results to a spreadsheet", "Reminders before {tool} due dates", "Dark mode for {tool}"],
    ),
    ("access_request", 8, "no_change", ["Access to {tool} for the new coordinator"]),
    ("question", 5, "no_change", ["How do I change my details in {tool}?"]),
    ("praise", 5, None, ["{tool} made this week's reports much quicker"]),
]


class _Moves:
    """One item's status changes, kept only while they are in the past."""

    def __init__(self, fb: Any, now: datetime) -> None:
        self.fb, self.now = fb, now
        self.done: list[tuple[datetime, str, str, Any, bool]] = []  # (when, before, after, who, reopened)

    def to(self, at: datetime, status: str, who: Any, reopened: bool = False) -> bool:
        if at >= self.now:
            return False
        self.done.append((at, self.fb.status, status, who, reopened))
        self.fb.status = status
        return True


def _wait(rng: random.Random, mean_hours: float, stalled: bool = False) -> timedelta:
    return timedelta(hours=rng.expovariate(1 / mean_hours) * (5 if stalled else 1) + 0.5)


def _lifecycle(rng: random.Random, m: _Moves, holder: Any, admins: list[Any], earlier: list[Any]) -> datetime | None:
    """Move the item as far as its age allows. Returns when it was fixed, if it closed as fixed."""
    fb = m.fb
    created: datetime = fb.created_at
    stalled = rng.random() < 0.15
    if fb.category == "praise":
        m.to(created + timedelta(hours=2), "acknowledged", holder)
        return None
    if earlier and rng.random() < 0.06:
        if m.to(created + _wait(rng, 20), "declined", holder):
            fb.duplicate_of, fb.ending = rng.choice(earlier).id, "duplicate"
        return None
    admin = rng.choice(admins)
    # Some arrive unsure of their tool and wait for the triage lead first.
    if fb.status == "needs_review" and not m.to(created + _wait(rng, 12, stalled), "awaiting_approval", admin):
        return None
    approved = (m.done[-1][0] if m.done else created) + _wait(rng, 26, stalled)
    if not m.to(approved, "approved", admin):
        return None
    fb.first_response_at, fb.approved_at, fb.approved_by = approved, approved, admin.google_email
    fb.expected_by = (approved + timedelta(days=rng.randint(5, 14))).date()
    started = approved + _wait(rng, 48, stalled)
    resolved = started + _wait(rng, 140, stalled)
    if not (m.to(started, "in_progress", holder) and m.to(resolved, "resolved", holder)):
        return None
    if rng.random() < 0.1:
        reopened = resolved + timedelta(days=rng.uniform(1, 4))
        if not m.to(reopened, "in_progress", None, reopened=True):
            fb.resolved_at = resolved
            return None
        resolved = reopened + _wait(rng, 48)
        if not m.to(resolved, "resolved", holder):
            return None
    fb.resolved_at = resolved
    if m.to(resolved + timedelta(days=rng.uniform(0.5, 5)), "closed", None):
        fb.ending = "fixed"
        return resolved
    return None


async def add_history(db: Any, now: datetime) -> int:
    from app.models import DigitalStaff, Feedback, FeedbackEvent, Project, Release, ReleaseItem, ReleaseItemThanks
    from app.seed import demo_staff

    if await db.scalar(select(Feedback.id).where(Feedback.context.has_key(MARK)).limit(1)) is not None:
        return 0
    rng = random.Random(112)
    staff = demo_staff()
    projects = list(await db.scalars(select(Project).order_by(Project.slug)))
    team = list(await db.scalars(select(DigitalStaff).order_by(DigitalStaff.name)))
    admins = [s for s in team if s.role == "admin"]
    by_id = {s.id: s for s in team}
    weights = [6 if p.slug in ("rake-agent", "afss-portal", "training-portal") else 2 for p in projects]

    made: list[Any] = []
    fixed: list[tuple[Any, datetime]] = []
    for back in range(DAYS, -1, -1):
        day = now - timedelta(days=back)
        # More on weekdays, and a little busier lately.
        for _ in range(rng.choice([1, 1, 2, 2, 3] if day.weekday() < 5 else [0, 0, 1])):
            created = day.replace(hour=rng.randint(7, 17), minute=rng.randint(0, 59))
            if created > now - timedelta(hours=1):
                continue
            project = rng.choices(projects, weights)[0]
            category, _, work_type, titles = rng.choices(KINDS, [k[1] for k in KINDS])[0]
            person = rng.choice(staff)
            owner = by_id.get(project.owner_id) if project.owner_id else None
            holder = owner if owner and rng.random() < 0.75 else rng.choice(team)
            fb = Feedback(
                submitter_email=person["email"],
                submitter_name=person["name"],
                project_id=project.id,
                target_type="agent" if project.project_group == "agents" else "platform",
                category=category,
                work_type=work_type,
                priority=rng.choices(["P1", "P2", "P3", "P4"], [1, 4, 8, 2])[0],
                status="needs_review" if rng.random() < 0.15 else "awaiting_approval",
                title=rng.choice(titles).format(tool=project.name),
                summary=f"{person['name']} wrote: {rng.choice(titles).format(tool=project.name).lower()}.",
                assignee_id=holder.id,
                context={MARK: True},
                created_at=created,
            )
            db.add(fb)
            await db.flush()
            moves = _Moves(fb, now)
            earlier = [e for e in made if e.project_id == project.id and e.status != "declined"]
            if (fixed_at := _lifecycle(rng, moves, holder, admins, earlier)) is not None:
                fixed.append((fb, fixed_at))
            for at, before, after, who, reopened in moves.done:
                db.add(
                    FeedbackEvent(
                        feedback_id=fb.id,
                        actor_type=who.role if who else "staff",
                        actor_email=who.google_email if who else fb.submitter_email,
                        actor_name=who.name if who else fb.submitter_name,
                        event_type="status",
                        before={"status": before},
                        after={"status": after} | ({"by": "submitter", "reopened": True} if reopened else {}),
                        created_at=at,
                    )
                )
            if rng.random() < 0.07:
                other = rng.choice([p for p in projects if p.id != project.id])
                db.add(
                    FeedbackEvent(
                        feedback_id=fb.id,
                        actor_type="admin",
                        actor_email=admins[0].google_email,
                        actor_name=admins[0].name,
                        event_type="correction",
                        before={"project": other.slug},
                        after={"project": project.slug},
                        created_at=created + timedelta(hours=1),
                    )
                )
            fb.updated_at = moves.done[-1][0] if moves.done else created
            made.append(fb)

    # A published release each Friday per tool that fixed something that week, with a few thanks per item.
    weeks: dict[tuple[Any, Any], list[Any]] = {}
    for fb, fixed_at in fixed:
        friday = (fixed_at + timedelta(days=(4 - fixed_at.weekday()) % 7)).date()
        weeks.setdefault((fb.project_id, friday), []).append(fb)
    for (project_id, friday), items in weeks.items():
        published = datetime.combine(friday, datetime.min.time(), UTC) + timedelta(hours=6)
        if published >= now:
            continue
        release = Release(project_id=project_id, week_ending=friday, status="published", published_at=published)
        db.add(release)
        await db.flush()
        for order, fb in enumerate(items):
            item = ReleaseItem(
                release_id=release.id,
                title=fb.title,
                body=fb.summary,
                work_type=fb.work_type,
                source_type="feedback",
                source_id=fb.id,
                visible_to_staff=True,
                sort_order=order,
            )
            db.add(item)
            await db.flush()
            for person in rng.sample(staff, rng.randint(0, 4)):
                at = published + timedelta(hours=rng.uniform(1, 72))
                if at < now:
                    db.add(ReleaseItemThanks(release_item_id=item.id, email=person["email"], created_at=at))
    return len(made)


async def run() -> None:
    from app.config import get_settings
    from app.db import dispose_engine, session_scope

    if get_settings().app_env != "local":
        raise SystemExit("Demo history is for local development only.")
    async with session_scope() as db:
        added = await add_history(db, datetime.now(UTC))
    await dispose_engine()
    print(f"Demo history: {added} items added." if added else "Demo history is already there; nothing added.")


def main() -> None:
    if "DATABASE_URL" not in os.environ:
        from scripts.local_db import start

        os.environ["DATABASE_URL"] = start(database="feedback")
    asyncio.run(run())


if __name__ == "__main__":
    main()
