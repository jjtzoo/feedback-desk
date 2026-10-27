"""How a resolved item ends (D92): the person who raised it says Is it fixed?, the worker reminds once
and then closes it, I still have an issue reopens it for REOPEN_DAYS, and only an Admin closes it for them."""

from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select, update

from app.db import session_scope
from app.models import Feedback, FeedbackEvent, FeedbackFollower, Notification
from app.services import email as email_service
from app.services import lifecycle
from tests.conftest import DARLENE, STAFF, STAFF2, signed_in, submit_via_chat

BUG = "RAKE gives a blank answer about leave, it's annoying"
ANSWERS = ["I expected an answer but got an empty box"]


async def resolved(staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient) -> str:
    ref = str((await submit_via_chat(staff, BUG, ANSWERS))["reference"])
    assert (await marc.post(f"/api/console/items/{ref}/approve")).status_code == 200
    assert (await darlene.post(f"/api/console/items/{ref}/start")).status_code == 200
    r = await darlene.post(f"/api/console/items/{ref}/resolve", json={"body": "Leave answers show again"})
    assert r.json()["status"] == "resolved"
    return ref


async def rows(email: str, kind: str) -> list[Notification]:
    async with session_scope() as db:
        query = select(Notification).where(Notification.recipient_email == email, Notification.type == kind)
        return list(await db.scalars(query.order_by(Notification.created_at)))


async def status_events(ref: str) -> list[FeedbackEvent]:
    async with session_scope() as db:
        fb = await db.scalar(select(Feedback).where(Feedback.ref_no == ref))
        assert fb is not None
        query = select(FeedbackEvent).where(FeedbackEvent.feedback_id == fb.id, FeedbackEvent.event_type == "status")
        return list(await db.scalars(query.order_by(FeedbackEvent.created_at)))


async def resolved_days_ago(ref: str, days: float) -> None:
    async with session_scope() as db:
        await db.execute(
            update(Feedback).where(Feedback.ref_no == ref).values(resolved_at=datetime.now(UTC) - timedelta(days=days))
        )


async def run_clock() -> tuple[int, int]:
    async with session_scope() as db:
        return await lifecycle.run_clock(db)


async def test_resolve_asks_the_person_who_raised_it_and_the_email_carries_both_answers(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await resolved(staff, marc, darlene)
    t = (await staff.get(f"/api/feedback/{ref}/tracker")).json()
    assert t["is_it_fixed"] == {"state": "resolved", "reopen_until": None} and t["check"] is None
    asked = (await rows(STAFF, "is_it_fixed"))[-1]
    assert asked.title == f"{ref} is resolved. Is it fixed?" and asked.link == f"/track/{ref}#is-it-fixed"
    _, body = email_service.render(asked, "https://feedback.test")
    assert f"Yes, close it: https://feedback.test/track/{ref}?fixed=yes" in body
    assert f"I still have an issue: https://feedback.test/track/{ref}?fixed=no" in body


async def test_yes_close_it_closes_as_fixed_by_the_submitter(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await resolved(staff, marc, darlene)
    t = (await staff.post(f"/api/feedback/{ref}/fixed")).json()
    assert t["status"] == "closed" and t["ending"] == "fixed" and t["status_text"] == "Fixed"
    assert t["history"][0]["text"] == "Sam Lee confirmed it's fixed"
    # The question becomes I still have an issue, for REOPEN_DAYS.
    until = datetime.fromisoformat(t["is_it_fixed"]["reopen_until"])
    assert t["is_it_fixed"]["state"] == "closed" and timedelta(days=13) < until - datetime.now(UTC) <= timedelta(
        days=14
    )
    last = (await status_events(ref))[-1]
    assert (last.actor_type, last.actor_email) == ("staff", STAFF)
    assert last.after == {"status": "closed", "ending": "fixed", "by": "submitter"}
    owner = (await rows(DARLENE, "closed"))[-1]
    assert owner.title == f"{ref}: Sam Lee confirmed it's fixed" and owner.step == "Fixed"
    assert (await staff.post(f"/api/feedback/{ref}/fixed")).status_code == 409  # already closed


async def test_only_the_person_who_raised_it_answers(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await resolved(staff, marc, darlene)
    stranger = await signed_in(STAFF2)
    assert (await stranger.post(f"/api/feedback/{ref}/fixed")).status_code == 404
    assert (await stranger.post(f"/api/feedback/{ref}/still-an-issue", json={"body": "x"})).status_code == 404
    # A colleague who added +1 follows it but can't close or reopen it.
    async with session_scope() as db:
        fb = await db.scalar(select(Feedback).where(Feedback.ref_no == ref))
        assert fb is not None
        db.add(FeedbackFollower(feedback_id=fb.id, email=STAFF2, name="Colleague"))
    assert (await stranger.get(f"/api/feedback/{ref}/tracker")).json()["is_it_fixed"] is None
    assert (await stranger.post(f"/api/feedback/{ref}/fixed")).status_code == 403
    await stranger.aclose()
    assert (await darlene.post(f"/api/feedback/{ref}/fixed")).status_code == 403


async def test_a_reply_on_a_resolved_item_no_longer_reopens_it(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await resolved(staff, marc, darlene)
    t = (await staff.post(f"/api/feedback/{ref}/replies", json={"body": "Thanks, I'll try it tomorrow"})).json()
    assert t["status"] == "resolved" and t["history"][0]["text"] == "You added details"
    assert [e.after["status"] for e in await status_events(ref)][-1] == "resolved"


async def test_i_still_have_an_issue_reopens_with_the_same_owner(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await resolved(staff, marc, darlene)
    issue = f"/api/feedback/{ref}/still-an-issue"
    assert (await staff.post(issue, json={"body": ""})).status_code == 422  # what is still wrong is required
    assert (await staff.post(issue, json={"body": "  "})).status_code == 400
    t = (await staff.post(issue, json={"body": "Still blank on my phone"})).json()
    assert t["status"] == "in_progress" and t["assignee"]["name"] == "Darlene" and t["is_it_fixed"] is None
    assert [h["text"] for h in t["history"][:2]] == ["Reopened: Sam Lee still has an issue", "You added details"]
    last = (await status_events(ref))[-1]
    assert last.actor_type == "staff" and last.after == {"status": "in_progress", "by": "submitter", "reopened": True}
    told = (await rows(DARLENE, "reopened"))[-1]
    assert told.title == f"{ref} reopened: Sam Lee still has an issue" and told.body == "Still blank on my phone"
    assert "&tab=activity&msg=" in told.link and told.step == "Reopened"
    # Not resolved any more: nothing to answer, and the file goes through the usual upload.
    assert (await staff.post(issue, json={"body": "again"})).status_code == 409
    up = await staff.post(
        f"/api/feedback/{ref}/attachments", files={"file": ("phone.png", b"\x89PNG\r\n\x1a\n" + b"0" * 64)}
    )
    assert up.status_code == 201


async def test_the_worker_reminds_once_then_closes_as_fixed_by_system(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await resolved(staff, marc, darlene)
    await resolved_days_ago(ref, 2.9)
    assert await run_clock() == (0, 0)

    # A muted item still gets its reminder marked, so it is never sent twice.
    await staff.post(f"/api/feedback/{ref}/mute", json={"muted": True})
    await resolved_days_ago(ref, 3.1)
    assert await run_clock() == (0, 1)
    assert await run_clock() == (0, 0)
    await staff.post(f"/api/feedback/{ref}/mute", json={"muted": False})
    assert [n.title for n in await rows(STAFF, "is_it_fixed")] == [f"{ref} is resolved. Is it fixed?"]
    async with session_scope() as db:
        reminded = list(await db.scalars(select(FeedbackEvent).where(FeedbackEvent.event_type == "reminded")))
        assert [(e.actor_type, e.is_public) for e in reminded] == [("system", False)]

    # Unmuted, the next item's reminder reaches the person who raised it only.
    other = await resolved(staff, marc, darlene)
    await resolved_days_ago(other, 3.1)
    assert await run_clock() == (0, 1)
    reminder = (await rows(STAFF, "is_it_fixed"))[-1]
    assert reminder.title == f"Is {other} fixed?" and "closes as fixed on" in reminder.body

    await resolved_days_ago(ref, 7.1)
    assert await run_clock() == (1, 0)
    t = (await staff.get(f"/api/feedback/{ref}/tracker")).json()
    assert t["status"] == "closed" and t["ending"] == "fixed"
    assert t["history"][0]["text"] == "Closed as fixed: no reply in 7 days"
    assert t["is_it_fixed"]["state"] == "closed"
    last = (await status_events(ref))[-1]
    assert last.actor_type == "system" and last.after["by"] == "system"
    told = (await rows(STAFF, "stage"))[-1]
    assert told.title == f"{ref} is fixed" and "I still have an issue by" in told.body
    assert (await rows(DARLENE, "closed"))[-1].title == f"{ref} closed as fixed: no reply in 7 days"
    # Reopening starts the clock again from the next Resolve.
    assert (await staff.post(f"/api/feedback/{ref}/still-an-issue", json={"body": "It broke again"})).status_code == 200
    assert await run_clock() == (0, 0)


async def test_i_still_have_an_issue_stays_for_the_reopen_window(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await resolved(staff, marc, darlene)
    await staff.post(f"/api/feedback/{ref}/fixed")
    # Thirteen days later it still reopens.
    await closed_days_ago(ref, 13)
    t = (await staff.post(f"/api/feedback/{ref}/still-an-issue", json={"body": "Back again"})).json()
    assert t["status"] == "in_progress" and t["ending"] is None

    await darlene.post(f"/api/console/items/{ref}/resolve", json={"body": "Fixed the cache too"})
    await staff.post(f"/api/feedback/{ref}/fixed")
    await closed_days_ago(ref, 15)
    t = (await staff.get(f"/api/feedback/{ref}/tracker")).json()
    assert t["is_it_fixed"] is None and t["can_reply"] is False
    r = await staff.post(f"/api/feedback/{ref}/still-an-issue", json={"body": "And again"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "reopen_window"
    assert ref in r.json()["error"]["message"]


async def closed_days_ago(ref: str, days: int) -> None:
    """Move the item's closes back in time; the reopen window counts from the latest."""
    closes = [e.id for e in await status_events(ref) if e.after["status"] == "closed"]
    assert closes
    async with session_scope() as db:
        await db.execute(
            update(FeedbackEvent)
            .where(FeedbackEvent.id.in_(closes))
            .values(created_at=datetime.now(UTC) - timedelta(days=days))
        )


async def test_digital_staff_cant_close_a_resolved_item_and_an_admin_needs_a_reason(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await resolved(staff, marc, darlene)
    close = f"/api/console/items/{ref}/close"
    r = await darlene.post(close, json={"reason": "Works now", "ending": "fixed"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "resolved_admin_only"
    assert (await darlene.post("/api/console/bulk", json={"references": [ref], "action": "close"})).status_code == 409
    r = await marc.post(close, json={"reason": ""})
    assert r.status_code == 400 and r.json()["error"]["code"] == "reason_required"
    r = await marc.post(close, json={"reason": "Confirmed by phone"})
    assert r.json()["status"] == "closed" and r.json()["ending"] == "fixed"
    last = (await status_events(ref))[-1]
    assert last.actor_type == "admin" and last.after == {
        "status": "closed",
        "ending": "fixed",
        "by": "admin",
        "reason": "Confirmed by phone",
    }
    # Staff see who closed it, not the Admin's note.
    t = (await staff.get(f"/api/feedback/{ref}/tracker")).json()
    assert t["history"][0]["text"] == "Closed as fixed by Marc" and t["close_reason"] is None
    assert "Confirmed by phone" not in str(t)
    assert (await rows(DARLENE, "closed"))[-1].title == f"{ref}: Marc closed it as fixed"
