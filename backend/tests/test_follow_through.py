"""The 27 Oct review: no direct contact on the tracker (D75), plain words (D76), history in a fixed
order (D77), one bell row per item and one email per step (D78), notifications that open where the
news is (D81), New since you last looked (D82) and the fix told
to everyone who can see Triage (D84)."""

import asyncio

import httpx
import pytest
from sqlalchemy import select

from app import worker
from app.db import session_scope
from app.models import FeedbackEvent, Notification
from app.services import email as email_service
from tests.conftest import CHRIS, DARLENE, MARC, STAFF, STAFF2, signed_in, submit_via_chat

BUG = "RAKE gives a blank answer about leave, it's annoying"
BUG_ANSWERS = ["I expected an answer but got an empty box"]
P1 = "RAKE gives a blank answer when I ask about leave."
P1_ANSWERS = ["It's blocking my work", "I expected an answer about leave, but got an empty box"]
MIKE = "mike@redadair.example"


async def raise_bug(staff: httpx.AsyncClient, message: str = BUG, answers: list[str] = BUG_ANSWERS) -> str:
    return str((await submit_via_chat(staff, message, answers))["reference"])


async def started(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient, p1: bool = False
) -> str:
    ref = await raise_bug(staff, P1, P1_ANSWERS) if p1 else await raise_bug(staff)
    assert (await marc.post(f"/api/console/items/{ref}/approve")).status_code == 200
    assert (await darlene.post(f"/api/console/items/{ref}/start")).status_code == 200
    return ref


async def rows(email: str, kind: str | None = None) -> list[Notification]:
    async with session_scope() as db:
        query = select(Notification).where(Notification.recipient_email == email)
        if kind:
            query = query.where(Notification.type == kind)
        return list(await db.scalars(query.order_by(Notification.created_at)))


async def test_tracker_shows_who_has_it_without_a_way_to_email_them(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient
) -> None:
    ref = await raise_bug(staff)
    t = (await staff.get(f"/api/feedback/{ref}/tracker")).json()
    assert t["assignee"] == {"name": "Darlene", "role": "Digital Staff · RAKE Agent owner"}
    assert "darlene@" not in str(t)


async def test_staff_never_see_a_bare_priority_code(staff: httpx.AsyncClient) -> None:
    ref = await raise_bug(staff, P1, P1_ANSWERS)
    history = [h["text"] for h in (await staff.get(f"/api/feedback/{ref}/tracker")).json()["history"]]
    assert "Classified: Bug, Blocking, RAKE Agent" in history
    assert not any("P1" in h for h in history)


async def test_events_written_together_keep_their_order(staff: httpx.AsyncClient, marc: httpx.AsyncClient) -> None:
    ref = await raise_bug(staff)
    events = (await marc.get(f"/api/console/items/{ref}")).json()["events"]
    # Newest first: the routing steps after Received and Classified, never shuffled by a shared timestamp.
    assert [e["event_type"] for e in events] == ["assigned", "status", "classified", "received"]
    stamps = [e["created_at"] for e in events]
    assert stamps == sorted(stamps, reverse=True) and len(set(stamps)) == len(stamps)


async def test_bell_rows_carry_the_item_and_its_step(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    await started(staff, marc, darlene, p1=True)
    # Marc is an Admin: needs approval at intake, then the count settles when he approves it himself.
    bell = (await marc.get("/api/notifications")).json()["items"]
    about = [n for n in bell if n["feedback_id"]]
    assert {n["step"] for n in about} == {"Needs approval"}
    assert all(n["reference"] for n in about)
    staff_steps = [n["step"] for n in reversed((await staff.get("/api/notifications")).json()["items"])]
    assert staff_steps == ["Planned", "In progress"]


async def test_notifications_written_together_go_as_one_email(
    staff: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    sent: list[tuple[str, str, str]] = []
    monkeypatch.setattr(email_service, "send", lambda settings, to, subject, body: sent.append((to, subject, body)))
    # Marc is an Admin and owns no tool; make him the owner so intake both assigns him and asks him to approve.
    async with session_scope() as db:
        from app.models import DigitalStaff, Project

        marc_id = await db.scalar(select(DigitalStaff.id).where(DigitalStaff.google_email == MARC))
        project = await db.scalar(select(Project).where(Project.slug == "rake-agent"))
        assert project is not None
        project.owner_id = marc_id
    await raise_bug(staff, P1, P1_ANSWERS)
    assert [n.type for n in await rows(MARC) if n.feedback_id] == ["assigned", "approval_p1"]
    await worker.send_batch()
    to_marc = [s for s in sent if s[0] == MARC]
    assert len(to_marc) == 1
    _, subject, body = to_marc[0]
    assert subject.startswith("P1 needs approval") and "New feedback assigned to you" in body
    assert {n.email_status for n in await rows(MARC) if n.feedback_id} == {"sent"}


async def test_a_reply_notification_opens_the_message(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await started(staff, marc, darlene)
    await staff.post(f"/api/feedback/{ref}/replies", json={"body": "Tested the forms, no bugs found"})
    detail = (await darlene.get(f"/api/console/items/{ref}")).json()
    reply = next(m for m in detail["messages"] if m["body"] == "Tested the forms, no bugs found")
    assert (await rows(DARLENE, "submitter_reply"))[-1].link == f"/console?item={ref}&msg={reply['id']}"
    await darlene.post(f"/api/console/items/{ref}/reply", json={"body": "Thanks"})
    assert (await rows(STAFF, "reply"))[-1].link == f"/track/{ref}#latest"


async def test_new_since_you_last_looked_is_kept_per_person(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await started(staff, marc, darlene)

    async def card(client: httpx.AsyncClient) -> dict[str, object]:
        items = (await client.get("/api/console/items", params={"inbox": "open"})).json()["items"]
        return next(i for i in items if i["reference"] == ref)

    # Starting work opened the panel, so nothing on it is new to her yet.
    assert (await darlene.get(f"/api/console/items/{ref}")).json()["last_read_at"] is not None
    assert (await card(darlene))["unread"] is False
    await asyncio.sleep(0.01)
    await marc.post(f"/api/console/items/{ref}/note", json={"body": "Please prioritise this"})
    await staff.post(f"/api/feedback/{ref}/replies", json={"body": "Still blank"})
    # New for Darlene and Marc, who opened it before (approving opens it); not for Chris, who never has.
    assert (await card(darlene))["unread"] is True
    assert (await card(marc))["unread"] is True
    chris = await signed_in(CHRIS)
    assert (await card(chris))["unread"] is False
    await chris.aclose()
    seen = (await darlene.get(f"/api/console/items/{ref}")).json()
    newer = [m["body"] for m in seen["messages"] if m["created_at"] > seen["last_read_at"]]
    assert newer == ["Please prioritise this", "Still blank"]
    assert (await card(darlene))["unread"] is False
    # Her own words never count as new for her.
    await darlene.post(f"/api/console/items/{ref}/reply", json={"body": "On it"})
    assert (await card(darlene))["unread"] is False


async def test_a_p1_fix_is_told_to_everyone_who_can_see_triage(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await started(staff, marc, darlene, p1=True)
    # A colleague's duplicate is merged in: they hear about the fix like the reporter.
    colleague = await signed_in(STAFF2)
    dup = await raise_bug(colleague, P1, P1_ANSWERS)
    await marc.post(f"/api/console/items/{dup}/merge", json={"into": ref})
    await colleague.aclose()

    await darlene.post(f"/api/console/items/{ref}/resolve", json={"body": "Fixed"})
    assert (await staff.post(f"/api/feedback/{ref}/fixed")).status_code == 200  # Yes, close it (D92)
    for admin in (MARC, CHRIS, MIKE):
        assert [(n.step, n.title) for n in await rows(admin, "fixed")] == [
            ("Resolved", f"Resolved: {ref} · {(await staff.get(f'/api/feedback/{ref}/tracker')).json()['title']}"),
            ("Fixed", f"Fixed: {ref} · {(await staff.get(f'/api/feedback/{ref}/tracker')).json()['title']}"),
        ]
    assert await rows(DARLENE, "fixed") == []  # she fixed it
    for reporter in (STAFF, STAFF2):
        assert await rows(reporter, "fixed") == []
    # The person who raised it was asked Is it fixed? and closed it; the merged-in colleague heard both.
    assert [n.step for n in await rows(STAFF, "is_it_fixed")] == ["Resolved"]
    assert [n.step for n in await rows(STAFF2, "stage")][-2:] == ["Resolved", "Fixed"]


async def test_other_fixes_wait_for_the_open_decision(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await started(staff, marc, darlene)
    await darlene.post(f"/api/console/items/{ref}/resolve", json={"body": "Fixed"})
    await staff.post(f"/api/feedback/{ref}/fixed")
    async with session_scope() as db:
        assert list(await db.scalars(select(Notification).where(Notification.type == "fixed"))) == []
        checked = list(await db.scalars(select(FeedbackEvent).where(FeedbackEvent.event_type == "checked")))
        assert checked == []


async def test_an_update_just_before_resolve_keeps_its_own_entry(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await started(staff, marc, darlene)
    await darlene.post(f"/api/console/items/{ref}/update", json={"body": "Found the cause"})
    await darlene.post(f"/api/console/items/{ref}/resolve", json={"body": "Fix deployed"})
    history = (await staff.get(f"/api/feedback/{ref}/tracker")).json()["history"]
    assert [(h["text"], h["detail"]) for h in history[-2:]] == [
        ("Update from Darlene", "Found the cause"),
        ("Resolved by Darlene", "Fix deployed"),
    ]
