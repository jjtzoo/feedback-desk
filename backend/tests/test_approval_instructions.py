"""Approving with instructions, priority and a due date (D93), and the one due date that moves only
with a reason the approver is told (D94)."""

from datetime import date, timedelta

import httpx
from sqlalchemy import select

from app.db import session_scope
from app.models import Notification
from app.services import email as email_service
from tests.conftest import DARLENE, MARC, submit_via_chat

BUG = "RAKE gives a blank answer about leave, it's annoying"
ANSWERS = ["I expected an answer but got an empty box"]
INSTRUCTIONS = "Check the leave index first; don't touch the prompt."


async def rows(email: str, kind: str) -> list[Notification]:
    async with session_scope() as db:
        query = select(Notification).where(Notification.recipient_email == email, Notification.type == kind)
        return list(await db.scalars(query.order_by(Notification.created_at)))


async def test_approve_with_instructions_priority_and_due_date(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = str((await submit_via_chat(staff, BUG, ANSWERS))["reference"])
    due = date.today() + timedelta(days=10)
    # A priority other than the one classified, so the change is logged as a correction.
    before = (await marc.get(f"/api/console/items/{ref}")).json()["priority"]
    priority = "P1" if before != "P1" else "P2"
    r = await marc.post(
        f"/api/console/items/{ref}/approve",
        json={"instructions": f"  {INSTRUCTIONS}  ", "priority": priority, "due_date": due.isoformat()},
    )
    assert r.status_code == 200
    item = r.json()
    assert item["status"] == "approved" and item["priority"] == priority and item["expected_by"] == due.isoformat()
    pinned = [e for e in item["events"] if e["event_type"] == "instructions"]
    assert len(pinned) == 1 and pinned[0]["after"] == {"instructions": INSTRUCTIONS}
    assert not pinned[0]["is_public"] and pinned[0]["actor_name"] == "Marc"
    assert any(e["event_type"] == "correction" and e["after"] == {"priority": priority} for e in item["events"])

    # Darlene, who holds it, gets them with the approval, in the app and by email.
    told = (await rows(DARLENE, "approved"))[-1]
    assert told.body == f"Instructions from Marc: {INSTRUCTIONS}"
    _, body = email_service.render(told, "https://feedback.test")
    assert INSTRUCTIONS in body

    # The person who raised it sees the date as Expected by, and never the instructions.
    t = (await staff.get(f"/api/feedback/{ref}/tracker")).json()
    assert t["expected_by"] == due.isoformat()
    assert INSTRUCTIONS not in str(t)


async def test_approve_with_no_input_still_works_and_a_bad_priority_is_refused(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient
) -> None:
    ref = str((await submit_via_chat(staff, BUG, ANSWERS))["reference"])
    bad = await marc.post(f"/api/console/items/{ref}/approve", json={"priority": "P9"})
    assert bad.status_code == 400 and bad.json()["error"]["code"] == "bad_value"
    r = await marc.post(f"/api/console/items/{ref}/approve")
    assert r.status_code == 200 and r.json()["status"] == "approved"
    assert not any(e["event_type"] == "instructions" for e in r.json()["events"])
    assert (await rows(DARLENE, "approved"))[-1].body == ""


async def test_moving_the_due_date_after_approval_needs_a_reason_and_tells_the_approver(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = str((await submit_via_chat(staff, BUG, ANSWERS))["reference"])
    first, later = date.today() + timedelta(days=5), date.today() + timedelta(days=12)
    await marc.post(f"/api/console/items/{ref}/approve", json={"due_date": first.isoformat()})

    no_reason = await darlene.post(f"/api/console/items/{ref}/update", json={"expected_by": later.isoformat()})
    assert no_reason.status_code == 400 and no_reason.json()["error"]["code"] == "reason_required"

    r = await darlene.post(
        f"/api/console/items/{ref}/update",
        json={"expected_by": later.isoformat(), "due_reason": "Waiting on the vendor's index fix"},
    )
    assert r.status_code == 200 and r.json()["expected_by"] == later.isoformat()
    moved = next(e for e in r.json()["events"] if e["event_type"] == "expected_by")
    assert moved["after"] == {"expected_by": later.isoformat(), "reason": "Waiting on the vendor's index fix"}

    told = (await rows(MARC, "due_moved"))[-1]
    assert told.title.startswith(f"{ref}: due date moved from ")
    assert told.body == "Darlene: Waiting on the vendor's index fix"
    assert told.link == f"/console?item={ref}&tab=history"

    # Staff see the new date, never the reason.
    t = (await staff.get(f"/api/feedback/{ref}/tracker")).json()
    assert t["expected_by"] == later.isoformat() and "vendor" not in str(t)


async def test_setting_a_first_due_date_after_approval_needs_no_reason(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = str((await submit_via_chat(staff, BUG, ANSWERS))["reference"])
    await marc.post(f"/api/console/items/{ref}/approve")
    due = date.today() + timedelta(days=7)
    r = await darlene.post(f"/api/console/items/{ref}/update", json={"expected_by": due.isoformat()})
    assert r.status_code == 200 and r.json()["expected_by"] == due.isoformat()
    assert await rows(MARC, "due_moved") == []


async def test_only_an_admin_approves_with_instructions(staff: httpx.AsyncClient, darlene: httpx.AsyncClient) -> None:
    ref = str((await submit_via_chat(staff, BUG, ANSWERS))["reference"])
    r = await darlene.post(f"/api/console/items/{ref}/approve", json={"instructions": "Go"})
    assert r.status_code == 403
