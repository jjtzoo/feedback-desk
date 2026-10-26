"""Changes of hands (D53), notifications that settle (D54), the standing approvals count (D55) and
routing shown until a person acts (D56)."""

import httpx
from sqlalchemy import select

from app.db import session_scope
from app.models import FeedbackEvent, Notification
from tests.conftest import CHRIS, DARLENE, MARC, MARIO, STAFF, signed_in, submit_via_chat

BUG = "RAKE gives a blank answer about leave, it's annoying"
BUG_ANSWERS = ["I expected an answer but got an empty box"]
P1 = "RAKE gives a blank answer when I ask about leave."
P1_ANSWERS = ["It's blocking my work", "I expected an answer about leave, but got an empty box"]


async def raise_bug(staff: httpx.AsyncClient, message: str = BUG, answers: list[str] = BUG_ANSWERS) -> str:
    return str((await submit_via_chat(staff, message, answers))["reference"])


async def staff_id(admin: httpx.AsyncClient, email: str) -> str:
    return str(
        next(s["id"] for s in (await admin.get("/api/admin/digital-staff")).json() if s["google_email"] == email)
    )


async def rows(email: str, kind: str) -> list[Notification]:
    async with session_scope() as db:
        return list(
            await db.scalars(
                select(Notification)
                .where(Notification.recipient_email == email, Notification.type == kind)
                .order_by(Notification.created_at)
            )
        )


async def test_only_the_holder_works_an_item(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await raise_bug(staff)  # routed to Darlene, owner of RAKE Agent
    await marc.post(f"/api/console/items/{ref}/approve")
    mario = await signed_in(MARIO)
    # Neither another Digital Staff member nor an Admin can work someone else's item (D1, D53).
    for client in (mario, marc):
        r = await client.post(f"/api/console/items/{ref}/start")
        assert r.status_code == 403 and r.json()["error"]["message"] == f"Darlene has {ref}. Take it over first."
        assert (await client.post(f"/api/console/items/{ref}/move", json={"column": "in_progress"})).status_code == 403
    assert (await darlene.post(f"/api/console/items/{ref}/start")).json()["status"] == "in_progress"
    for client in (mario, marc):
        update = await client.post(f"/api/console/items/{ref}/update", json={"body": "Looking at it"})
        assert update.status_code == 403
        assert (await client.post(f"/api/console/items/{ref}/resolve", json={"body": "Done"})).status_code == 403
    assert (
        await darlene.post(f"/api/console/items/{ref}/resolve", json={"body": "Fixed the cache"})
    ).status_code == 200


async def test_take_over_is_named_told_and_guarded(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await raise_bug(staff)
    await marc.post(f"/api/console/items/{ref}/approve")
    await darlene.post(f"/api/console/items/{ref}/update", json={"body": "Found the cause"})
    darlene_id = await staff_id(marc, DARLENE)

    mario = await signed_in(MARIO)
    detail = (await mario.get(f"/api/console/items/{ref}")).json()
    assert detail["holder_activity"]["text"] == "posted an update" and detail["assignee_away"] is False

    r = await mario.post(f"/api/console/items/{ref}/take-over", json={"holder_id": darlene_id, "reason": "I know it"})
    assert r.status_code == 200 and r.json()["assignee"]["name"] == "Mario"
    assert r.json()["status"] == "approved"  # stage and updates stay as they were

    # A second person who opened the dialog while Darlene still had it is told, and nothing changes.
    late = await signed_in(CHRIS)
    r = await late.post(f"/api/console/items/{ref}/take-over", json={"holder_id": darlene_id})
    assert r.status_code == 409 and r.json()["error"]["message"] == "Mario has just taken this over."

    told = await rows(DARLENE, "taken_over")
    assert [n.title for n in told] == [f"Mario took over {ref}"]
    assert await rows(STAFF, "taken_over") == []  # the submitter isn't notified ...
    tracker = (await staff.get(f"/api/feedback/{ref}/tracker")).json()
    assert "Now with Mario" in [h["text"] for h in tracker["history"]]  # ... their tracker shows it

    async with session_scope() as db:
        kinds = [e.event_type for e in await db.scalars(select(FeedbackEvent).order_by(FeedbackEvent.created_at))]
        # Kept apart from the routing corrections the dashboard's reassignment rate counts.
        assert "taken_over" in kinds and "correction" not in kinds
    mine = await mario.post(f"/api/console/items/{ref}/take-over", json={"holder_id": darlene_id})
    assert mine.json()["error"]["message"] == "It's already yours."


async def test_hand_over_rules(staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient) -> None:
    ref = await raise_bug(staff)
    mario_id = await staff_id(marc, MARIO)
    darlene_id = await staff_id(marc, DARLENE)
    mario = await signed_in(MARIO)
    # Someone who doesn't hold it can't give it away.
    r = await mario.post(f"/api/console/items/{ref}/hand-over", json={"to": mario_id})
    assert r.status_code == 403
    # The holder hands it on; the new holder is asked to start, the old one isn't told about their own act.
    r = await darlene.post(f"/api/console/items/{ref}/hand-over", json={"to": mario_id, "reason": "Finance data"})
    assert r.json()["assignee"]["name"] == "Mario"
    assert [n.title for n in await rows(MARIO, "assigned")][-1].startswith(f"{ref} assigned to you")
    assert await rows(DARLENE, "handed_over") == []
    # An Admin moves it back; the person it's taken from is told.
    await marc.post(f"/api/console/items/{ref}/hand-over", json={"to": darlene_id})
    assert [n.title for n in await rows(MARIO, "handed_over")] == [f"Marc handed {ref} to Darlene"]
    # Mario's "assigned to you" settled when it left him.
    settled = (await rows(MARIO, "assigned"))[-1]
    assert settled.outcome == f"{ref} is now with Darlene" and settled.read_at is not None
    async with session_scope() as db:
        kinds = [e.event_type for e in await db.scalars(select(FeedbackEvent).order_by(FeedbackEvent.created_at))]
        assert kinds.count("handed_over") == 2


async def test_assign_to_me_only_when_nobody_has_it(staff: httpx.AsyncClient, darlene: httpx.AsyncClient) -> None:
    ref = await raise_bug(staff)
    mario = await signed_in(MARIO)
    r = await mario.post(f"/api/console/items/{ref}/assign-to-me")
    assert r.status_code == 409 and r.json()["error"]["message"] == "Darlene has just taken this on."


async def test_asks_settle_for_everyone_once_anyone_acts(staff: httpx.AsyncClient, marc: httpx.AsyncClient) -> None:
    ref = await raise_bug(staff, P1, P1_ANSWERS)
    chris = await signed_in(CHRIS)
    asked = (await chris.get("/api/notifications")).json()["items"]
    p1 = next(n for n in asked if n["type"] == "approval_p1")
    assert p1["outcome"] is None and p1["item_status"] == "awaiting_approval" and p1["read_at"] is None

    await marc.post(f"/api/console/items/{ref}/approve")
    after = (await chris.get("/api/notifications")).json()["items"]
    p1 = next(n for n in after if n["type"] == "approval_p1")
    assert p1["outcome"] == f"{ref} approved by Marc" and p1["read_at"] is not None
    assert p1["item_status"] == "approved"  # the stage is read live
    darlene_rows = await rows(DARLENE, "approved")
    assert darlene_rows[-1].outcome is None  # Darlene's "ready to start" waits for her to start
    await (await signed_in(DARLENE)).post(f"/api/console/items/{ref}/start")
    assert (await rows(DARLENE, "approved"))[-1].outcome == f"{ref}: Darlene started work"


async def test_one_standing_approvals_count_per_admin(staff: httpx.AsyncClient, marc: httpx.AsyncClient) -> None:
    first = await raise_bug(staff)
    second = await raise_bug(staff, "RAKE gives a blank answer about pay, it's annoying", BUG_ANSWERS)
    for admin in (MARC, CHRIS, "mike@redadair.example"):
        standing = await rows(admin, "approvals_waiting")
        assert [n.title for n in standing] == ["2 items waiting for your approval"]
        assert standing[0].email_status == "skipped"  # bell only; the daily summary is the email
    counts = (await marc.get("/api/console/counts")).json()
    assert counts["approvals"] == 2  # the sidebar shows the same number

    chris = await signed_in(CHRIS)
    await chris.post("/api/notifications/read", json={})
    await marc.post(f"/api/console/items/{first}/approve")
    standing = (await rows(CHRIS, "approvals_waiting"))[0]
    assert standing.title == "1 item waiting for your approval" and standing.read_at is not None  # fell: stays read
    await marc.post(f"/api/console/items/{second}/decline", json={"reason": "Covered by FB-0001"})
    assert await rows(CHRIS, "approvals_waiting") == []  # clears at zero


async def test_routing_reason_shows_until_a_person_accepts_it(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient
) -> None:
    ref = await raise_bug(staff)
    detail = (await marc.get(f"/api/console/items/{ref}")).json()
    assert detail["routed"] == "project owner" and detail["assignee"]["name"] == "Darlene"
    assigned = next(e for e in detail["events"] if e["event_type"] == "assigned")
    assert assigned["actor_type"] == "system" and assigned["after"]["reason"] == "project owner"
    assert (await marc.post(f"/api/console/items/{ref}/approve")).json()["routed"] is None
