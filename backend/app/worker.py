"""Background worker.

    python -m app.worker          # loop (local development, Docker Compose)
    python -m app.worker --once   # one pass (the Cloud Run job Cloud Scheduler runs every minute)

- Sends the email for each queued notification: up to 3 tries, waiting 1 then 5 minutes,
  then marks it failed. Notifications for one person about one item that are due together
  (written in the same step, such as assigned and needs approval) go as one email (D78).
- Runs the daily digest and the Friday release drafter when their local slot comes round.
  Cloud Scheduler may call the same jobs; job_runs makes each slot run once.
- Ends resolved items nobody answered (D92): one Is it fixed? reminder after RESOLVED_REMINDER_DAYS,
  then closes them as Fixed by System after RESOLVED_AUTO_CLOSE_DAYS.
- Embeds open items whose embedding is missing or from another model, a batch at a time,
  so duplicate search finds them.
"""

import asyncio
import contextlib
import logging
import signal
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import select

from app.config import get_settings
from app.db import dispose_engine, session_scope
from app.models import Notification
from app.services import email as email_service
from app.services import embeddings, jobs, lifecycle

log = logging.getLogger("app.worker")

MAX_ATTEMPTS = 3
BACKOFF_MINUTES = (1, 5)
POLL_SECONDS = 5
HEARTBEAT = Path("/tmp/worker-heartbeat")


async def send_batch(limit: int = 20) -> int:
    """Send what is due. Returns how many notifications were handled."""
    settings = get_settings()
    async with session_scope() as db:
        rows = list(
            await db.scalars(
                select(Notification)
                .where(Notification.email_status == "queued", Notification.email_after <= datetime.now(UTC))
                .order_by(Notification.created_at)
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
        )
        groups: dict[tuple[str, object], list[Notification]] = {}
        for n in rows:
            groups.setdefault((n.recipient_email, n.feedback_id or n.id), []).append(n)
        for group in groups.values():
            first = group[0]
            for n in group:
                n.email_attempts += 1
            try:
                subject, body = email_service.render_many(group, settings.app_base_url)
                await asyncio.to_thread(email_service.send, settings, first.recipient_email, subject, body)
            except Exception as exc:
                for n in group:
                    if n.email_attempts >= MAX_ATTEMPTS:
                        n.email_status = "failed"
                    else:
                        n.email_after = datetime.now(UTC) + timedelta(minutes=BACKOFF_MINUTES[n.email_attempts - 1])
                log.warning(
                    "email failed id=%s to=%s attempt=%s error=%s",
                    first.id,
                    email_service.redact(first.recipient_email),
                    first.email_attempts,
                    type(exc).__name__,
                )
            else:
                for n in group:
                    n.email_status = "sent"
                    n.emailed_at = datetime.now(UTC)
                log.info(
                    "email sent id=%s type=%s count=%s to=%s",
                    first.id,
                    first.type,
                    len(group),
                    email_service.redact(first.recipient_email),
                )
        return len(rows)


async def run_due_jobs() -> None:
    for name in jobs.due():
        async with session_scope() as db:
            if name == "daily_digest":
                count = await jobs.run_digest(db)
            else:
                count = await jobs.run_release_drafter(db)
            if count:
                log.info("job %s ran: %s", name, count)


async def close_resolved() -> None:
    async with session_scope() as db:
        closed, reminded = await lifecycle.run_clock(db)
    if closed or reminded:
        log.info("resolved items: %s closed as fixed, %s reminded", closed, reminded)


async def backfill_embeddings() -> None:
    async with session_scope() as db:
        count = await embeddings.backfill(db)
    if count:
        log.info("embedded %s items for duplicate search", count)


async def main() -> None:
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        with contextlib.suppress(NotImplementedError):  # Windows
            loop.add_signal_handler(sig, stop.set)
    log.info("worker started")
    last_jobs_check = 0.0
    while not stop.is_set():
        try:
            if get_settings().email_backend != "off":
                await send_batch()
            if time.monotonic() - last_jobs_check > 60:
                last_jobs_check = time.monotonic()
                await run_due_jobs()
                await close_resolved()
                await backfill_embeddings()
        except Exception:
            log.exception("worker loop error")
        with contextlib.suppress(OSError):
            await asyncio.to_thread(HEARTBEAT.write_text, str(time.time()))
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), POLL_SECONDS)
    await dispose_engine()


async def once() -> None:
    """One pass, then exit: what the Cloud Run job does (D33)."""
    if get_settings().email_backend != "off":
        await send_batch(limit=100)
    await run_due_jobs()
    await close_resolved()
    await backfill_embeddings()
    await dispose_engine()


if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    asyncio.run(once() if "--once" in sys.argv else main())
