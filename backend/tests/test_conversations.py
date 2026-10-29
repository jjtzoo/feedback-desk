"""The two conversations on an item (D100 to D102): the tracker's, with the person who raised it, the
holder and the approver, and the team's internal one; an update asks nothing of the person who raised it."""

import httpx
import pytest
from sqlalchemy import select

from agent.model import ModelChoice
from app.db import session_scope
from app.models import ModelUsage, Notification
from app.services import sig_updates, usage
from tests.conftest import CHRIS, DARLENE, MARC, STAFF, signed_in, submit_via_chat

BUG = "RAKE gives a blank answer about leave, it's annoying"
BUG_ANSWERS = ["I expected an answer but got an empty box"]


async def started(staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient) -> str:
    ref = str((await submit_via_chat(staff, BUG, BUG_ANSWERS))["reference"])
    assert (await marc.post(f"/api/console/items/{ref}/approve")).status_code == 200
    assert (await darlene.post(f"/api/console/items/{ref}/start")).status_code == 200
    return ref


async def rows(email: str, kind: str) -> list[Notification]:
    async with session_scope() as db:
        query = select(Notification).where(Notification.recipient_email == email, Notification.type == kind)
        return list(await db.scalars(query.order_by(Notification.created_at)))


async def test_the_tracker_names_the_approver_and_who_said_each_message(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await started(staff, marc, darlene)
    await darlene.post(f"/api/console/items/{ref}/update", json={"body": "Reproducing it now"})
    await darlene.post(f"/api/console/items/{ref}/reply", json={"body": "Which leave type were you asking about?"})
    await staff.post(f"/api/feedback/{ref}/replies", json={"body": "Annual leave"})
    await darlene.post(f"/api/console/items/{ref}/note", json={"body": "Index is stale"})

    t = (await staff.get(f"/api/feedback/{ref}/tracker")).json()
    assert t["approver"] == {"name": "Marc"} and t["assignee"]["name"] == "Darlene"
    said = [(h["said_by"], h["detail"], h["update"]) for h in t["history"] if h["said_by"]]
    assert said == [
        ("Darlene", "Reproducing it now", True),
        ("Darlene", "Which leave type were you asking about?", False),
        ("You", "Annual leave", False),
    ]
    # Stage changes are not messages, and the team's note never reaches the tracker.
    assert any(h["said_by"] is None for h in t["history"]) and "Index is stale" not in str(t)


async def test_a_comment_from_the_tracker_reaches_the_holder_and_the_approver(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await started(staff, marc, darlene)
    chris = await signed_in(CHRIS)
    # Chris, an Admin who wrote to them, is in the conversation too.
    assert (await chris.post(f"/api/console/items/{ref}/reply", json={"body": "Thanks for raising it"})).is_success
    await chris.aclose()
    await staff.post(f"/api/feedback/{ref}/replies", json={"body": "Annual leave, on my phone"})
    detail = (await darlene.get(f"/api/console/items/{ref}")).json()
    message = next(m for m in detail["messages"] if m["body"] == "Annual leave, on my phone")
    for email in (DARLENE, MARC, CHRIS):
        told = (await rows(email, "submitter_reply"))[-1]
        assert told.title == f"{ref}: Sam Lee replied" and told.link == f"/console?item={ref}&msg={message['id']}"


async def test_a_team_note_reaches_the_team_side_and_never_the_person_who_raised_it(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await started(staff, marc, darlene)
    assert (await marc.post(f"/api/console/items/{ref}/note", json={"body": "Check the 3.2 release first"})).is_success
    detail = (await darlene.get(f"/api/console/items/{ref}")).json()
    note = next(m for m in detail["messages"] if m["body"] == "Check the 3.2 release first")
    told = (await rows(DARLENE, "team_note"))[-1]
    assert told.title == f"{ref}: Marc wrote to the team" and told.body == "Check the 3.2 release first"
    assert told.link == f"/console?item={ref}&msg={note['id']}" and told.step == "Team note"
    assert await rows(MARC, "team_note") == []  # never about your own note

    await darlene.post(f"/api/console/items/{ref}/note", json={"body": "On it"})
    assert (await rows(MARC, "team_note"))[-1].body == "On it"
    assert await rows(STAFF, "team_note") == []


async def test_an_update_asks_nothing_of_the_person_who_raised_it(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await started(staff, marc, darlene)
    r = await darlene.post(f"/api/console/items/{ref}/update", json={"body": "Currently reproducing"})
    assert r.status_code == 200 and r.json()["messages"][-1]["asks_check"] is False
    t = (await staff.get(f"/api/feedback/{ref}/tracker")).json()
    assert "check" not in t and t["latest_update"]["body"] == "Currently reproducing"
    told = (await rows(STAFF, "progress"))[-1]
    assert told.title == f"Update on {ref}" and told.step == "Update"
    # It's fixed and Still happening are gone; only Resolved asks Is it fixed? (D92).
    assert (await staff.post(f"/api/feedback/{ref}/check", json={"fixed": True})).status_code in (404, 405)


async def test_a_reply_to_the_person_who_raised_it_reaches_the_others_on_the_item(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await started(staff, marc, darlene)
    assert (await darlene.post(f"/api/console/items/{ref}/reply", json={"body": "Which page?"})).is_success
    detail = (await marc.get(f"/api/console/items/{ref}")).json()
    message = next(m for m in detail["messages"] if m["body"] == "Which page?")
    told = (await rows(MARC, "team_reply"))[-1]
    assert told.title == f"{ref}: Darlene replied to Sam" and told.link == f"/console?item={ref}&msg={message['id']}"
    assert await rows(DARLENE, "team_reply") == []  # never about your own reply
    assert await rows(STAFF, "team_reply") == []  # they get the reply itself


async def test_sig_writes_what_the_person_who_raised_it_reads_when_it_moves(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    facts: list[str] = []

    async def generate(model: str, text: str) -> tuple[str, int, int]:
        facts.append(text)
        return "Darlene has started on it.", 40, 8

    async def under(_db: object) -> bool:
        return False

    ref = str((await submit_via_chat(staff, BUG, BUG_ANSWERS))["reference"])
    # The model is switched on after the chat, which still runs on the stub.
    monkeypatch.setattr("app.agent_runtime.model_choice", lambda: ModelChoice("gemini", "gemini-test", True, ""))
    monkeypatch.setattr(sig_updates, "_generate", generate)
    monkeypatch.setattr(usage, "over_budget", under)
    await marc.post(f"/api/console/items/{ref}/approve")
    await darlene.post(f"/api/console/items/{ref}/start")

    t = (await staff.get(f"/api/feedback/{ref}/tracker")).json()
    assert "Darlene has started on it." in [h["text"] for h in t["history"]]
    assert "What happened: Work started on it" in facts[-1] and "Working on it: Darlene" in facts[-1]
    async with session_scope() as db:
        assert await db.scalar(select(ModelUsage).where(ModelUsage.model == "gemini-test")) is not None


async def test_a_failed_or_missing_model_leaves_the_template(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def broken(model: str, text: str) -> tuple[str, int, int]:
        raise TimeoutError

    async def under(_db: object) -> bool:
        return False

    ref = str((await submit_via_chat(staff, BUG, BUG_ANSWERS))["reference"])
    monkeypatch.setattr("app.agent_runtime.model_choice", lambda: ModelChoice("gemini", "gemini-test", True, ""))
    monkeypatch.setattr(sig_updates, "_generate", broken)
    monkeypatch.setattr(usage, "over_budget", under)
    await marc.post(f"/api/console/items/{ref}/approve")
    await darlene.post(f"/api/console/items/{ref}/start")

    t = (await staff.get(f"/api/feedback/{ref}/tracker")).json()
    assert "Darlene started work" in [h["text"] for h in t["history"]]
