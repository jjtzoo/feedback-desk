"""Moves back (D113): an Admin un-approves an item before work starts, its holder stops work, and an Admin
reopens a declined or closed item. Board drags make the same moves, and an ended item takes no reply."""

from datetime import date, timedelta
from typing import Any

import httpx
from sqlalchemy import select

from app.db import session_scope
from app.models import Feedback, FeedbackEvent, Notification
from app.services.feedback import day_text
from tests.conftest import CHRIS, DARLENE, MARC, MARIO, STAFF, STAFF2, signed_in, submit_via_chat

BUG = "RAKE gives a blank answer about leave, it's annoying"
BUG_ANSWERS = ["I expected an answer but got an empty box"]
P1 = "RAKE gives a blank answer when I ask about leave."
P1_ANSWERS = ["It's blocking my work", "I expected an answer about leave, but got an empty box"]
UNSURE = "The login page is clunky and confusing"
UNSURE_ANSWERS = ["Not sure", "It's annoying"]
PRAISE = "Thanks for the new RAKE search, awesome work"


async def raise_item(staff: httpx.AsyncClient, message: str = BUG, answers: list[str] = BUG_ANSWERS) -> str:
    return str((await submit_via_chat(staff, message, answers))["reference"])


async def rows(email: str, kind: str) -> list[Notification]:
    async with session_scope() as db:
        query = select(Notification).where(Notification.recipient_email == email, Notification.type == kind)
        return list(await db.scalars(query.order_by(Notification.created_at)))


async def last_event(ref: str, kind: str) -> FeedbackEvent:
    async with session_scope() as db:
        fb = await db.scalar(select(Feedback).where(Feedback.ref_no == ref))
        assert fb is not None
        query = select(FeedbackEvent).where(FeedbackEvent.feedback_id == fb.id, FeedbackEvent.event_type == kind)
        found = (await db.scalars(query.order_by(FeedbackEvent.created_at.desc()))).first()
        assert found is not None
        return found


async def item(ref: str) -> Feedback:
    async with session_scope() as db:
        fb = await db.scalar(select(Feedback).where(Feedback.ref_no == ref))
        assert fb is not None
        return fb


async def tracker(staff: httpx.AsyncClient, ref: str) -> dict[str, Any]:
    r = await staff.get(f"/api/feedback/{ref}/tracker")
    assert r.status_code == 200, r.text
    return dict(r.json())


async def approvals(admin: httpx.AsyncClient) -> int:
    return int((await admin.get("/api/console/counts")).json()["approvals"])


async def test_unapprove_sends_it_back_to_the_admins_with_an_internal_reason(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await raise_item(staff)  # Awaiting approval, with Darlene
    due = date.today() + timedelta(days=10)
    await marc.post(f"/api/console/items/{ref}/approve", json={"due_date": due.isoformat()})
    assert await approvals(marc) == 0

    # Only an Admin un-approves, with a reason, by the button or the board.
    reason = {"reason": "Budget moved to next quarter"}
    assert (await darlene.post(f"/api/console/items/{ref}/unapprove", json=reason)).status_code == 403
    drag = {"column": "awaiting_approval", "note": reason["reason"]}
    assert (await darlene.post(f"/api/console/items/{ref}/move", json=drag)).status_code == 403
    assert (await marc.post(f"/api/console/items/{ref}/unapprove", json={"reason": ""})).status_code == 422
    blank = await marc.post(f"/api/console/items/{ref}/unapprove", json={"reason": "   "})
    assert blank.status_code == 400 and blank.json()["error"]["code"] == "reason_required"

    chris = await signed_in(CHRIS)
    r = await chris.post(f"/api/console/items/{ref}/unapprove", json=reason)  # any Admin, not only the approver
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "awaiting_approval" and out["assignee"]["name"] == "Darlene"
    assert out["approved_by"] is None and out["approved_at"] is None and out["expected_by"] is None
    moved = await last_event(ref, "status")
    assert moved.before == {"status": "approved"}
    assert moved.after == {"status": "awaiting_approval", "reason": "Budget moved to next quarter"}
    due_event = await last_event(ref, "expected_by")
    assert due_event.after == {"expected_by": ""} and not due_event.is_public

    # Darlene's "ready to start" settles; the item counts for the Admins again.
    assert (await rows(DARLENE, "approved"))[-1].outcome == f"{ref} un-approved"
    assert await approvals(marc) == 1
    assert [n.title for n in await rows(MARC, "approvals_waiting")] == ["1 item waiting for your approval"]

    # The person who raised it reads that it's gone back, never why.
    t = await tracker(staff, ref)
    assert t["status"] == "awaiting_approval" and t["stage"] == "received"
    assert "Not planned yet: it's gone back to the Admins to decide" in [h["text"] for h in t["history"]]
    assert "Budget moved" not in str(t)
    told = (await rows(STAFF, "stage"))[-1]
    assert told.step == "Under review" and told.title == f"{ref} is waiting for a decision again"
    assert "Budget moved" not in told.body

    again = await marc.post(f"/api/console/items/{ref}/unapprove", json=reason)
    assert again.status_code == 409 and again.json()["error"]["code"] == "not_approved"
    await chris.aclose()


async def test_unapprove_returns_to_needs_review_and_asks_for_a_p1_again(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient
) -> None:
    unsure = await raise_item(staff, UNSURE, UNSURE_ANSWERS)
    await marc.post(f"/api/console/items/{unsure}/approve")
    r = await marc.post(f"/api/console/items/{unsure}/unapprove", json={"reason": "Needs a closer look"})
    assert r.json()["status"] == "needs_review"

    p1 = await raise_item(staff, P1, P1_ANSWERS)
    await marc.post(f"/api/console/items/{p1}/approve")
    assert all(n.settled_at is not None for n in await rows(CHRIS, "approval_p1"))
    await marc.post(f"/api/console/items/{p1}/unapprove", json={"reason": "Wrong priority"})
    asked = [n for n in await rows(CHRIS, "approval_p1") if n.title.startswith(f"P1 needs approval: {p1}")]
    assert len(asked) == 2 and asked[-1].settled_at is None
    # The Admin who sent it back isn't asked about their own move.
    assert len([n for n in await rows(MARC, "approval_p1") if p1 in n.title]) == 1


async def test_unapprove_needs_work_stopped_first(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await raise_item(staff)
    await marc.post(f"/api/console/items/{ref}/approve")
    await darlene.post(f"/api/console/items/{ref}/start")
    r = await marc.post(f"/api/console/items/{ref}/unapprove", json={"reason": "Not now"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "started"
    waiting = await raise_item(staff, "RAKE gives a blank answer about pay, it's annoying")
    early = await marc.post(f"/api/console/items/{waiting}/unapprove", json={"reason": "Not now"})
    assert early.status_code == 409


async def test_only_the_holder_stops_work_and_it_stays_planned(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await raise_item(staff)
    due = date.today() + timedelta(days=10)
    await marc.post(f"/api/console/items/{ref}/approve", json={"due_date": due.isoformat()})
    reason = {"reason": "Waiting on the vendor's fix"}
    early = await darlene.post(f"/api/console/items/{ref}/stop", json=reason)
    assert early.status_code == 409 and early.json()["error"]["code"] == "not_started"
    await darlene.post(f"/api/console/items/{ref}/start")
    started = (await item(ref)).first_response_at

    # Neither another Digital Staff member nor an Admin who doesn't hold it can stop it (D53).
    mario = await signed_in(MARIO)
    for client in (mario, marc):
        assert (await client.post(f"/api/console/items/{ref}/stop", json=reason)).status_code == 403
        drag = {"column": "approved", "note": reason["reason"]}
        assert (await client.post(f"/api/console/items/{ref}/move", json=drag)).status_code == 403
    await mario.aclose()
    blank = await darlene.post(f"/api/console/items/{ref}/stop", json={"reason": "  "})
    assert blank.status_code == 400 and blank.json()["error"]["code"] == "reason_required"

    r = await darlene.post(f"/api/console/items/{ref}/stop", json=reason)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "approved" and out["assignee"]["name"] == "Darlene"
    assert out["approved_by"] == MARC and out["expected_by"] == due.isoformat()
    assert (await item(ref)).first_response_at == started
    moved = await last_event(ref, "status")
    assert moved.before == {"status": "in_progress"}
    assert moved.after == {"status": "approved", "reason": "Waiting on the vendor's fix"}

    t = await tracker(staff, ref)
    assert t["status"] == "approved" and t["stage"] == "approved"
    assert f"Work on it has paused; it's still planned. Expected by {day_text(due)}" in [
        h["text"] for h in t["history"]
    ]
    assert "vendor" not in str(t)
    told = (await rows(STAFF, "stage"))[-1]
    assert told.step == "Planned" and told.title == f"Work on {ref} has paused"

    again = await darlene.post(f"/api/console/items/{ref}/stop", json=reason)
    assert again.status_code == 409


async def test_board_drags_stop_work_and_unapprove(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await raise_item(staff)
    early = await marc.post(f"/api/console/items/{ref}/move", json={"column": "awaiting_approval", "note": "x"})
    assert early.status_code == 409 and early.json()["error"]["code"] == "bad_move"
    await marc.post(f"/api/console/items/{ref}/move", json={"column": "approved"})
    await darlene.post(f"/api/console/items/{ref}/move", json={"column": "in_progress"})
    no_reason = await darlene.post(f"/api/console/items/{ref}/move", json={"column": "approved"})
    assert no_reason.status_code == 400 and no_reason.json()["error"]["code"] == "reason_required"
    r = await darlene.post(f"/api/console/items/{ref}/move", json={"column": "approved", "note": "Blocked"})
    assert r.json()["status"] == "approved"

    # Back past a stop, the approval it withdraws is the one from Awaiting approval.
    r = await marc.post(f"/api/console/items/{ref}/move", json={"column": "awaiting_approval", "note": "Rethink"})
    assert r.json()["status"] == "awaiting_approval"
    assert (await last_event(ref, "status")).after == {"status": "awaiting_approval", "reason": "Rethink"}
    assert await approvals(marc) == 1


async def test_an_admin_reopens_a_declined_item_with_a_public_reason(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await raise_item(staff)
    await marc.post(f"/api/console/items/{ref}/decline", json={"reason": "Not this quarter"})
    assert await approvals(marc) == 0
    reason = {"reason": "The budget came through"}
    assert (await darlene.post(f"/api/console/items/{ref}/reopen", json=reason)).status_code == 403
    assert (await marc.post(f"/api/console/items/{ref}/reopen", json={"reason": ""})).status_code == 422

    r = await marc.post(f"/api/console/items/{ref}/reopen", json=reason)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "awaiting_approval" and out["ending"] is None and out["close_reason"] is None
    moved = await last_event(ref, "status")
    assert moved.before == {"status": "declined", "ending": "declined"}
    assert moved.after == {
        "status": "awaiting_approval",
        "by": "admin",
        "reopened": True,
        "reason": "The budget came through",
    }
    assert await approvals(marc) == 1

    t = await tracker(staff, ref)
    assert t["status"] == "awaiting_approval" and t["can_reply"] is True
    assert t["history"][-1]["text"] == "Reopened by Marc: The budget came through"
    told = (await rows(STAFF, "stage"))[-1]
    assert told.step == "Reopened" and told.body == "The budget came through"
    open_again = await marc.post(f"/api/console/items/{ref}/reopen", json=reason)
    assert open_again.status_code == 409 and open_again.json()["error"]["code"] == "not_ended"


async def test_reopen_goes_back_to_where_it_ended_and_asks_again(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    # Won't fix while in progress: back to In progress, and Darlene is told.
    wont = await raise_item(staff)
    await marc.post(f"/api/console/items/{wont}/approve")
    await darlene.post(f"/api/console/items/{wont}/start")
    await darlene.post(f"/api/console/items/{wont}/close", json={"reason": "Vendor bug", "ending": "wont_fix"})
    r = await marc.post(f"/api/console/items/{wont}/reopen", json={"reason": "The vendor shipped a fix"})
    assert r.json()["status"] == "in_progress" and r.json()["ending"] is None
    reopened = (await rows(DARLENE, "reopened"))[-1]
    assert reopened.title == f"{wont} reopened by Marc" and reopened.step == "Reopened"

    # No longer needed while approved: back to Approved, with a new "ready to start" for Darlene.
    dropped = await raise_item(staff, "RAKE gives a blank answer about pay, it's annoying")
    await marc.post(f"/api/console/items/{dropped}/approve")
    await darlene.post(f"/api/console/items/{dropped}/close", json={"reason": "Moved to payroll"})
    assert (await rows(DARLENE, "approved"))[-1].settled_at is not None
    r = await marc.post(f"/api/console/items/{dropped}/reopen", json={"reason": "Still needed after all"})
    assert r.json()["status"] == "approved" and r.json()["approved_by"] == MARC
    ask = (await rows(DARLENE, "approved"))[-1]
    assert ask.title.startswith(f"Reopened, ready to start: {dropped}") and ask.settled_at is None

    # Fixed, even after a resolve: started again (D45), with resolved_at cleared.
    fixed = await raise_item(staff, "RAKE gives a blank answer about rosters, it's annoying")
    await marc.post(f"/api/console/items/{fixed}/approve")
    await darlene.post(f"/api/console/items/{fixed}/start")
    await darlene.post(f"/api/console/items/{fixed}/resolve", json={"body": "Rosters answer again"})
    await staff.post(f"/api/feedback/{fixed}/fixed")
    r = await marc.post(f"/api/console/items/{fixed}/reopen", json={"reason": "It broke again on Monday"})
    assert r.json()["status"] == "in_progress"
    assert (await item(fixed)).resolved_at is None
    assert (await last_event(fixed, "status")).before == {"status": "closed", "ending": "fixed"}


async def test_a_duplicate_or_praise_cant_be_reopened(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    original = await raise_item(staff)
    other = await signed_in(STAFF2)
    dup = await raise_item(other, "RAKE gives a blank answer about leave, really annoying", ["Nothing comes back"])
    await other.aclose()
    assert (await darlene.post(f"/api/console/items/{dup}/merge", json={"into": original})).is_success
    r = await marc.post(f"/api/console/items/{dup}/reopen", json={"reason": "Not the same"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "duplicate"

    thanks = str((await submit_via_chat(staff, PRAISE, ["Yes, send it"]))["reference"])
    r = await marc.post(f"/api/console/items/{thanks}/reopen", json={"reason": "Oops"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_ended"


async def test_an_ended_item_takes_notes_but_no_reply(staff: httpx.AsyncClient, marc: httpx.AsyncClient) -> None:
    ref = await raise_item(staff)
    await marc.post(f"/api/console/items/{ref}/decline", json={"reason": "Not this quarter"})
    r = await marc.post(f"/api/console/items/{ref}/reply", json={"body": "Can you say more?"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "closed"
    assert (await marc.post(f"/api/console/items/{ref}/note", json={"body": "For the record"})).status_code == 200
