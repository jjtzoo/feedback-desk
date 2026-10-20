"""Project channels, Friday releases, dashboard and scheduled jobs (S3-6, S3-7, S4-1)."""

from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select, update

from app.db import session_scope
from app.models import Feedback, Notification
from app.services import releases
from tests.conftest import DARLENE, STAFF, signed_in, submit_via_chat


async def _resolved_item(staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient) -> str:
    ref = str(
        (
            await submit_via_chat(
                staff,
                "RAKE gives a blank answer about leave, it's annoying",
                ["I expected an answer but got an empty box"],
            )
        )["reference"]
    )
    await marc.post(f"/api/console/items/{ref}/approve")
    await darlene.post(f"/api/console/items/{ref}/start")
    await darlene.post(f"/api/console/items/{ref}/resolve", json={"body": "Fixed the empty answer bug"})
    return ref


async def test_channel_mentions_and_fb_chips(
    darlene: httpx.AsyncClient, marc: httpx.AsyncClient, staff: httpx.AsyncClient
) -> None:
    ref = await _resolved_item(staff, marc, darlene)
    r = await darlene.post(
        "/api/console/channels/rake-agent", json={"body": f"@Marc can you check #{ref} before Friday?"}
    )
    assert r.status_code == 201
    assert r.json()["mentions"] == ["marc@redadair.example"] and r.json()["feedback_refs"] == [ref]
    channel = (await marc.get("/api/console/channels/rake-agent")).json()
    assert channel["chips"][ref]["status"] == "resolved"
    async with session_scope() as db:
        assert "mention" in set(
            await db.scalars(select(Notification.type).where(Notification.recipient_email == "marc@redadair.example"))
        )
    assert (await staff.get("/api/console/channels/rake-agent")).status_code == 403  # staff never see channels
    msg_id = r.json()["id"]
    assert (await darlene.post(f"/api/console/channels/messages/{msg_id}/pin", json={"pinned": True})).json()[
        "pinned"
    ] is True


async def test_friday_release_draft_review_and_publish(
    darlene: httpx.AsyncClient, marc: httpx.AsyncClient, staff: httpx.AsyncClient
) -> None:
    ref = await _resolved_item(staff, marc, darlene)
    await darlene.post(
        "/api/console/channels/rake-agent", json={"body": "Internal: swapped the answer cache to Redis-free polling"}
    )
    async with session_scope() as db:
        drafts = await releases.draft_week(db, releases.this_friday())
        assert len(drafts) == 1  # only RAKE had activity
        again = await releases.draft_week(db, releases.this_friday())
        assert again == []
    listed = (await darlene.get("/api/console/releases")).json()
    rid = listed[0]["id"]
    assert listed[0]["can_publish"] is True  # Darlene owns RAKE Agent
    release = (await darlene.get(f"/api/console/releases/{rid}")).json()
    by_source = {i["source_type"]: i for i in release["items"]}
    assert by_source["feedback"]["visible_to_staff"] is True and by_source["feedback"]["work_type"] == "fix"
    assert by_source["channel"]["visible_to_staff"] is False  # channel items start unticked

    mario = await signed_in("mario@redadair.example")
    assert (await mario.post(f"/api/console/releases/{rid}/publish")).status_code == 403  # not the owner
    await mario.aclose()

    items = [
        {**i, "title": "RAKE now answers leave questions"} if i["source_type"] == "feedback" else i
        for i in release["items"]
    ]
    assert (await darlene.put(f"/api/console/releases/{rid}/items", json={"items": items})).status_code == 200
    published = (await darlene.post(f"/api/console/releases/{rid}/publish")).json()
    assert published["status"] == "published"

    news = (await staff.get("/api/whats-new")).json()
    assert news[0]["project"]["slug"] == "rake-agent"
    assert [(i["title"], i["yours"]) for i in news[0]["items"]] == [("RAKE now answers leave questions", True)]
    async with session_scope() as db:
        assert "release" in set(
            await db.scalars(select(Notification.type).where(Notification.recipient_email == STAFF))
        )
    t = (await staff.get(f"/api/feedback/{ref}/tracker")).json()
    assert any(h["text"].startswith("Included in the RAKE Agent release") for h in t["history"])


async def test_dashboard_numbers(marc: httpx.AsyncClient, staff: httpx.AsyncClient, darlene: httpx.AsyncClient) -> None:
    await _resolved_item(staff, marc, darlene)
    await submit_via_chat(staff, "I need access to the Training Portal admin area")
    d = (await marc.get("/api/console/dashboard")).json()
    assert {"label": "Training Portal", "count": 1} in d["open_by_project"]
    assert d["approvals_waiting"] == 1 and d["avg_first_response_hours"] is not None
    assert sum(w["received"] for w in d["weekly"]) == 2


async def test_daily_digest_job_runs_once_per_day(staff: httpx.AsyncClient, anon: httpx.AsyncClient) -> None:
    await submit_via_chat(staff, "The login page is clunky and confusing", ["Not sure", "It's annoying"])
    await submit_via_chat(staff, "It would be nice to export CPD points to a spreadsheet", project="cpd-tracker")
    async with session_scope() as db:
        await db.execute(update(Feedback).values(created_at=datetime.now(UTC) - timedelta(days=4)))
    assert (await anon.post("/api/jobs/daily-digest")).status_code == 403
    r = await anon.post("/api/jobs/daily-digest", headers={"X-Job-Token": "test-job-token"})
    assert r.json()["notifications"] >= 1
    again = await anon.post("/api/jobs/daily-digest", headers={"X-Job-Token": "test-job-token"})
    assert again.json() == {"notifications": 0}
    async with session_scope() as db:
        kinds = set(
            await db.scalars(select(Notification.type).where(Notification.type.in_(("digest", "approvals_summary"))))
        )
    assert kinds == {"digest", "approvals_summary"}


async def test_release_job_endpoint(
    anon: httpx.AsyncClient, staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    await _resolved_item(staff, marc, darlene)
    r = await anon.post("/api/jobs/release-drafts", headers={"X-Job-Token": "test-job-token"})
    assert r.json() == {"drafts": 1}
    async with session_scope() as db:
        assert "release_draft" in set(
            await db.scalars(select(Notification.type).where(Notification.recipient_email == DARLENE))
        )
