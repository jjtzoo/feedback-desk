"""Project channels, Friday releases, dashboard and scheduled jobs (S3-6, S3-7, S4-1)."""

from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select, update

from app.db import session_scope
from app.models import Feedback, FeedbackEvent, Notification
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


async def test_friday_release_draft_review_and_publish(
    darlene: httpx.AsyncClient, marc: httpx.AsyncClient, staff: httpx.AsyncClient
) -> None:
    ref = await _resolved_item(staff, marc, darlene)
    # A second RAKE item still in progress, whose update the drafter offers unticked.
    other = str(
        (await submit_via_chat(staff, "RAKE shows the wrong roster times, it's annoying", ["I expected my shifts"]))[
            "reference"
        ]
    )
    await marc.post(f"/api/console/items/{other}/approve")
    await darlene.post(f"/api/console/items/{other}/start")
    await darlene.post(f"/api/console/items/{other}/update", json={"body": "Swapped the roster cache to polling"})
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
    assert by_source["progress"]["visible_to_staff"] is False  # progress updates start unticked

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

    # A Thanks counts once per person, shows only as a number, and can be taken back (D110).
    item = news[0]["items"][0]["id"]
    for _ in range(2):
        assert (await staff.put(f"/api/whats-new/items/{item}/thanks")).status_code == 204
    assert (await darlene.put(f"/api/whats-new/items/{item}/thanks")).status_code == 204
    mine = (await staff.get("/api/whats-new")).json()[0]["items"][0]
    assert (mine["thanks"], mine["thanked"]) == (2, True)
    assert (await staff.delete(f"/api/whats-new/items/{item}/thanks")).status_code == 204
    mine = (await staff.get("/api/whats-new")).json()[0]["items"][0]
    assert (mine["thanks"], mine["thanked"]) == (1, False)
    hidden = by_source["progress"]["id"]  # unticked, so staff never see it
    assert (await staff.put(f"/api/whats-new/items/{hidden}/thanks")).status_code == 404


async def test_dashboard_numbers(marc: httpx.AsyncClient, staff: httpx.AsyncClient, darlene: httpx.AsyncClient) -> None:
    ref = await _resolved_item(staff, marc, darlene)
    assert (await staff.post(f"/api/feedback/{ref}/still-an-issue", json={"body": "Still blank"})).status_code == 200
    await submit_via_chat(staff, "I need access to the Training Portal admin area")
    d = (await marc.get("/api/console/dashboard")).json()
    # The reopened item is back In progress and the access request waits for approval: both are backlog.
    assert d["weeks"] == 4 and d["backlog"]["value"] == 2 and d["backlog"]["previous"] == 0
    assert d["backlog"]["trend"][-1] == 2 and len(d["flow"]) == 4
    assert sum(w["received"] for w in d["flow"]) == 2 and sum(w["resolved"] for w in d["flow"]) == 1
    stuck = {row["stage"]: row["bands"] for row in d["stuck"]}
    assert stuck["in_progress"] == [1, 0, 0, 0] and sum(map(sum, stuck.values())) == 2
    assert d["first_response_hours"]["count"] == 1 and d["resolve_days"]["count"] == 1
    tools = {row["name"]: row for row in d["tools"]}
    assert tools["RAKE Agent"] | {"oldest_days": 0} == {
        "slug": "rake-agent",
        "name": "RAKE Agent",
        "new": 1,
        "open": 1,
        "oldest_days": 0,
        "reopened": 1,
        "resolved": 1,
        "thanks": 0,
    }
    assert tools["Training Portal"]["open"] == 1
    assert {row["name"]: row["open"] for row in d["team"]}["Darlene"] == 1
    assert d["quality"]["reopened"] == {"count": 1, "of": 1, "rate": 1.0}
    assert d["quality"]["corrections"] == {"count": 0, "of": 2, "rate": 0.0}


async def test_dashboard_is_for_admins_and_shows_4_or_12_weeks(
    marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    assert (await darlene.get("/api/console/dashboard")).status_code == 403
    assert (await marc.get("/api/console/dashboard?weeks=5")).status_code == 400
    assert len((await marc.get("/api/console/dashboard?weeks=12")).json()["flow"]) == 12


async def test_dashboard_compares_with_the_period_before(marc: httpx.AsyncClient) -> None:
    now = datetime.now(UTC)

    def ago(days: int) -> datetime:
        return now - timedelta(days=days)

    async with session_scope() as db:
        # Raised 40 days ago (before the last 4 weeks) and approved the next day, due 5 days ago: still open.
        late = Feedback(
            submitter_email=STAFF,
            submitter_name="Sam",
            title="Late",
            summary="Late",
            status="approved",
            created_at=ago(40),
            expected_by=ago(5).date(),
        )
        # Raised 20 days ago (in the last 4 weeks), resolved in 10 days, a day before it was due.
        quick = Feedback(
            submitter_email=STAFF,
            submitter_name="Sam",
            title="Quick",
            summary="Quick",
            status="resolved",
            created_at=ago(20),
            expected_by=ago(9).date(),
            resolved_at=ago(10),
        )
        db.add_all([late, quick])
        await db.flush()
        for fb, before, after, days in [(late, "new", "approved", 39), (quick, "new", "resolved", 10)]:
            db.add(
                FeedbackEvent(
                    feedback_id=fb.id,
                    actor_type="staff",
                    event_type="status",
                    created_at=ago(days),
                    before={"status": before},
                    after={"status": after},
                )
            )
    d = (await marc.get("/api/console/dashboard")).json()
    assert d["backlog"] | {"trend": None} == {"value": 1, "previous": 1, "trend": None, "count": 1}
    assert d["resolve_days"]["value"] == 10.0 and d["resolve_days"]["previous"] is None
    assert d["on_time"]["value"] == 1.0
    assert {row["stage"]: row["bands"] for row in d["stuck"]}["approved"] == [0, 0, 0, 1]
    assert {row["name"]: row["overdue"] for row in d["team"]}["Unassigned"] == 1
    assert sum(w["received"] for w in d["flow"]) == 1
    assert sum(w["received"] for w in (await marc.get("/api/console/dashboard?weeks=12")).json()["flow"]) == 2


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
