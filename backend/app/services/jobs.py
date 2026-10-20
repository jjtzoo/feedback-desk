"""Scheduled jobs: the daily digest and the Friday release drafter.

In staging and production Cloud Scheduler calls /api/jobs/<name>. Locally the worker runs them
when their slot comes round. job_runs makes each slot run once, whoever triggers it.
"""

from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import JobRun
from app.services import releases, reports


def _local_now() -> datetime:
    return datetime.now(ZoneInfo(get_settings().timezone))


async def _claim(db: AsyncSession, name: str, slot: str) -> bool:
    run = await db.get(JobRun, name, with_for_update=True)
    if run is not None and run.last_slot == slot:
        return False
    if run is None:
        db.add(JobRun(name=name, last_slot=slot))
    else:
        run.last_slot = slot
        run.ran_at = datetime.now(ZoneInfo("UTC"))
    await db.flush()
    return True


async def run_digest(db: AsyncSession, force: bool = False) -> int:
    slot = _local_now().date().isoformat()
    if not force and not await _claim(db, "daily_digest", slot):
        return 0
    return await reports.daily_digest(db)


async def run_release_drafter(db: AsyncSession, force: bool = False) -> int:
    friday = releases.this_friday(_local_now().date())
    if not force and not await _claim(db, "release_drafter", friday.isoformat()):
        return 0
    return len(await releases.draft_week(db, friday))


def due(now: datetime | None = None) -> list[str]:
    """Jobs whose local slot has started (the worker checks every minute)."""
    s = get_settings()
    now = now or _local_now()
    out = []
    if now.weekday() < 5 and now.hour >= s.digest_hour:
        out.append("daily_digest")
    if now.weekday() == s.release_weekday and now.hour >= s.release_hour:
        out.append("release_drafter")
    return out
