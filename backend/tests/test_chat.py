"""Sprint 2: the staff chat on the stub model (S2-1 to S2-8)."""

from typing import Any

import httpx
import pytest
from sqlalchemy import func, select

from agent.stub import ASK_EXPECTED, ASK_IMPACT, ASK_PROJECT, EXISTING, NOISE, SHOW_SUMMARY
from app import agent_runtime
from app.api.chat import _without_card_fields
from app.config import get_settings
from app.db import session_scope
from app.models import Attachment, Feedback, FeedbackEvent, FeedbackMessage, Notification
from app.services import auth
from app.services import feedback as feedback_service
from tests.conftest import STAFF, STAFF2, first, parse_sse, say, signed_in, start_chat, submit_via_chat, texts
from tests.test_units import PNG, _docx


async def count() -> int:
    async with session_scope() as db:
        return int(await db.scalar(select(func.count()).select_from(Feedback)) or 0)


async def test_bug_conversation_routes_to_the_owner_and_waits_for_approval(staff: httpx.AsyncClient) -> None:
    sid = await start_chat(staff, browser="Safari 17", device="iPhone", screen="390x844", source="intranet tile")
    events = await say(staff, sid, "RAKE gives a blank answer when I ask about leave.")
    assert texts(events)[-1] == ASK_IMPACT
    assert first(events, "chips")["kind"] == "impact"  # type: ignore[index]
    assert first(events, "draft") is None

    events = await say(staff, sid, "It's blocking my work")
    assert texts(events)[-1] == ASK_EXPECTED
    assert first(events, "draft") is None  # no card while a question is open

    events = await say(staff, sid, "I expected an answer about leave, but got an empty box")
    assert texts(events)[-1] == SHOW_SUMMARY
    card = first(events, "draft")
    assert card is not None
    assert card["card"] == {
        "project": "RAKE Agent",
        "work_type": "Fix",
        "category": "Bug",
        "priority": "P1",
        "title": "RAKE gives a blank answer when I ask about leave.",
        "summary": "RAKE gives a blank answer when I ask about leave.",
    }
    assert await count() == 0  # nothing saved before Confirm

    r = await staff.post(f"/api/chat/sessions/{sid}/confirm", json={"draft_hash": card["hash"]})
    events = parse_sse(r.text)
    done = first(events, "done")
    assert done == {"reference": "FB-0001", "assigned_to": "Darlene", "status": "awaiting_approval"}
    assert "it's with Darlene, who looks after RAKE Agent" in texts(events)[-1]

    async with session_scope() as db:
        fb = await db.scalar(select(Feedback))
        assert fb is not None
        assert (fb.work_type, fb.category, fb.priority, fb.channel) == ("fix", "bug", "P1", "chat")
        assert fb.context["device"] == "iPhone" and fb.context["source"] == "intranet tile"
        assert fb.dev_brief["expected"] == "an answer about leave" and fb.dev_brief["actual"] == "got an empty box"
        assert fb.dev_brief["submitter_quote"].startswith("RAKE gives a blank answer")
        assert "Steps to reproduce" in fb.dev_brief["open_gaps"]
        public = list(
            await db.scalars(
                select(FeedbackEvent.public_text).where(
                    FeedbackEvent.feedback_id == fb.id, FeedbackEvent.is_public.is_(True)
                )
            )
        )
        assert public == ["Received via chat", "Classified: Bug, P1, RAKE Agent", "Assigned to Darlene"]
        turns = list(await db.scalars(select(FeedbackMessage).where(FeedbackMessage.feedback_id == fb.id)))
        assert turns[0].author_type == "agent" and any("blank answer" in t.body for t in turns)
        kinds = {n.type for n in await db.scalars(select(Notification))}
        assert kinds == {"assigned", "approval_p1"}  # owner told; P1 goes to the Admins at once

    assert (await staff.post(f"/api/chat/sessions/{sid}/messages", json={"text": "one more"})).status_code == 409


async def test_project_link_skips_the_tool_question(staff: httpx.AsyncClient) -> None:
    sid = await start_chat(staff, project="cpd-tracker")
    events = await say(staff, sid, "It would be nice to export my points to a spreadsheet")
    assert ASK_PROJECT not in " ".join(texts(events))
    card = first(events, "draft")
    assert card is not None and card["card"]["project"] == "CPD Tracker" and card["card"]["work_type"] == "New feature"


async def test_unclear_tool_gets_project_chips_and_at_most_three_questions(staff: httpx.AsyncClient) -> None:
    sid = await start_chat(staff)
    events = await say(staff, sid, "The export button throws an error every single time")
    assert texts(events)[-1] == ASK_PROJECT
    chips = first(events, "chips")
    assert (
        chips
        and chips["kind"] == "project"
        and {"label": "Financial Platform", "value": "Financial Platform"} in chips["options"]
    )
    questions = 1
    for answer in ["Financial Platform", "It's annoying", "I expected a CSV but got error 500"]:
        events = await say(staff, sid, answer)
        if first(events, "draft"):
            break
        questions += 1
    assert first(events, "draft") is not None
    assert questions <= 3


async def test_not_sure_goes_to_needs_review(staff: httpx.AsyncClient) -> None:
    done = await submit_via_chat(staff, "The login page is clunky and confusing", ["Not sure", "It's annoying"])
    assert done["status"] == "needs_review" and done["assigned_to"] == "the Digital team"


async def test_access_requests_route_by_rule(staff: httpx.AsyncClient) -> None:
    done = await submit_via_chat(staff, "I need access to the Financial Platform to approve invoices")
    assert done["assigned_to"] == "Chris"


async def test_praise_is_acknowledged_without_approval(staff: httpx.AsyncClient) -> None:
    done = await submit_via_chat(staff, "Thanks for the new RAKE search, awesome work")
    assert done["status"] == "acknowledged" and done["assigned_to"] == "Darlene"


async def test_noise_and_off_topic_save_nothing(staff: httpx.AsyncClient) -> None:
    sid = await start_chat(staff)
    for text in ["asdf", "hello", "check out http://spam.example cheap"]:
        assert texts(await say(staff, sid, text)) == [NOISE]
    assert await count() == 0


@pytest.mark.parametrize(
    "message",
    [
        "I already raised this as FB-0001, can you add that it's still happening?",
        "Any update on my ticket about the RAKE export?",
        "Can you look up the status of FB-0042 for me?",
        "I've already reported this, I just want to follow up on my existing report",
    ],
)
async def test_a_request_about_existing_feedback_is_pointed_to_it_not_turned_into_a_new_report(
    staff: httpx.AsyncClient, message: str
) -> None:
    sid = await start_chat(staff)
    events = await say(staff, sid, message)
    reply = texts(events)[-1]
    assert reply == EXISTING
    assert "My feedback" in reply and "Reply or add details" in reply
    assert first(events, "draft") is None  # no card, no intake questions
    assert await count() == 0

    # Someone who then says it is a new problem is not stuck: the normal conversation carries on.
    events = await say(staff, sid, "Actually, this is a different problem: Flipbook crashes when I open the brochure")
    assert texts(events)[-1] in (ASK_IMPACT, ASK_EXPECTED, ASK_PROJECT)


async def test_typing_yes_does_not_save(staff: httpx.AsyncClient) -> None:
    sid = await start_chat(staff, project="flipbook")
    events = await say(staff, sid, "Flipbook pages are blank, it's annoying, I expected pages but got white screens")
    assert first(events, "draft") is not None
    events = await say(staff, sid, "yes send it")
    assert first(events, "done") is None and await count() == 0


async def test_confirm_needs_the_hash_of_the_current_draft(staff: httpx.AsyncClient) -> None:
    sid = await start_chat(staff, project="flipbook")
    events = await say(staff, sid, "Flipbook pages are blank, it's annoying, I expected pages but got white screens")
    old = first(events, "draft")
    events = await say(staff, sid, "Actually make it P1")
    new = first(events, "draft")
    assert old and new and new["card"]["priority"] == "P1"
    assert (await staff.post(f"/api/chat/sessions/{sid}/confirm", json={"draft_hash": old["hash"]})).status_code == 409
    r = await staff.post(f"/api/chat/sessions/{sid}/confirm", json={"draft_hash": new["hash"]})
    assert first(parse_sse(r.text), "done") is not None


async def test_chat_belongs_to_the_person_who_started_it(staff: httpx.AsyncClient) -> None:
    sid = await start_chat(staff)
    other = await signed_in(STAFF2)
    r = await other.post(f"/api/chat/sessions/{sid}/messages", json={"text": "hijack"})
    assert r.status_code == 404
    await other.aclose()


async def test_passwords_are_masked_before_storage(staff: httpx.AsyncClient) -> None:
    await submit_via_chat(
        staff, "Rake rejects my password: Hunter2 every time, it's annoying", ["I expected to get in but got an error"]
    )
    async with session_scope() as db:
        bodies = " ".join(await db.scalars(select(FeedbackMessage.body)))
        fb = await db.scalar(select(Feedback))
        assert "Hunter2" not in bodies and "Hunter2" not in str(fb.dev_brief) and "Hunter2" not in fb.summary  # type: ignore[union-attr]


async def test_attachments_upload_and_join_the_item(staff: httpx.AsyncClient) -> None:
    sid = await start_chat(staff, project="staff-admin-portal")
    up = await staff.post(f"/api/chat/sessions/{sid}/attachments", files={"file": ("error.png", PNG, "image/png")})
    assert up.status_code == 201, up.text
    doc = await staff.post(
        f"/api/chat/sessions/{sid}/attachments", files={"file": ("notes.docx", _docx(), "application/octet-stream")}
    )
    bad = await staff.post(
        f"/api/chat/sessions/{sid}/attachments",
        files={"file": ("macro.docx", _docx(macro=True), "application/octet-stream")},
    )
    assert doc.status_code == 201 and bad.status_code == 415
    events = await say(
        staff,
        sid,
        "Login loops on my phone, it's blocking, I expected the dashboard but got the sign-in page",
        [up.json()["id"], doc.json()["id"]],
    )
    card = first(events, "draft")
    assert card is not None
    r = await staff.post(f"/api/chat/sessions/{sid}/confirm", json={"draft_hash": card["hash"]})
    ref = first(parse_sse(r.text), "done")["reference"]  # type: ignore[index]
    async with session_scope() as db:
        atts = list(await db.scalars(select(Attachment).where(Attachment.feedback_id.is_not(None))))
        assert {a.file_name for a in atts} == {"error.png", "notes.docx"}
        assert "Received via chat, 2 files" in list(await db.scalars(select(FeedbackEvent.public_text)))
    tracker = (await staff.get(f"/api/feedback/{ref}/tracker")).json()
    file_id = tracker["attachments"][0]["id"]
    link = await staff.get(f"/api/files/{file_id}", follow_redirects=False)
    assert link.status_code == 303
    content = await staff.get(link.headers["location"])
    assert content.status_code == 200 and content.content.startswith(b"\x89PNG")
    other = await signed_in(STAFF2)
    assert (await other.get(f"/api/files/{file_id}", follow_redirects=False)).status_code == 404
    await other.aclose()


async def test_duplicate_is_offered_and_plus_one_adds_the_comment(staff: httpx.AsyncClient) -> None:
    first_ref = (
        await submit_via_chat(
            staff,
            "Flipbook pages are blank on the safety brochure, it's annoying",
            ["I expected pages but got white screens"],
            project="flipbook",
        )
    )["reference"]
    other = await signed_in(STAFF2)
    sid = await start_chat(other, project="flipbook")
    events = await say(
        other, sid, "Flipbook pages are blank on the brochure, it's annoying, I expected pages but got white"
    )
    dup = first(events, "duplicates")
    assert dup and dup["candidates"][0]["reference"] == first_ref
    assert "Looks like someone may have raised this already" in texts(events)[-1]
    assert (await other.post(f"/api/chat/sessions/{sid}/plus-one", json={"reference": "FB-9999"})).status_code == 409
    r = await other.post(
        f"/api/chat/sessions/{sid}/plus-one",
        json={"reference": first_ref, "comment": "Same here on the induction booklet"},
    )
    assert r.status_code == 200 and r.json()["reference"] == first_ref
    assert await count() == 1
    mine = (await other.get("/api/my/feedback")).json()
    assert mine[0]["reference"] == first_ref and mine[0]["following"] is True
    async with session_scope() as db:
        fb = await db.scalar(select(Feedback))
        assert fb is not None and fb.impact == "team"
    await other.aclose()


async def test_the_console_tallies_reporters_and_suggests_a_priority_review_without_changing_it(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient
) -> None:
    ref = (
        await submit_via_chat(
            staff,
            "Flipbook pages are blank on the safety brochure, it's annoying",
            ["I expected pages but got white screens"],
            project="flipbook",
        )
    )["reference"]

    async def plus_one(email: str, name: str) -> None:
        async with session_scope() as db:
            await feedback_service.plus_one(db, await auth.user_for_email(db, email, name), ref, "Same here")

    async def card() -> dict[str, Any]:
        return dict((await marc.get(f"/api/console/items/{ref}")).json())

    assert (await card())["reporters"] == 1 and (await card())["priority_review"] is False
    await plus_one(STAFF, "Sam Lee")  # the submitter adding to their own item is not a second report
    await plus_one(STAFF2, "Priya Nair")
    await plus_one(STAFF2, "Priya Nair")  # nor is the same colleague twice
    assert (await card())["reporters"] == 2 and (await card())["priority_review"] is False

    await plus_one("tom.nguyen@redadair.example", "Tom Nguyen")
    detail = await card()
    assert detail["reporters"] == 3 and detail["priority_review"] is True
    assert detail["priority"] == "P2"  # a suggestion only: the priority is never raised by itself
    board = (await marc.get("/api/console/board", params={"inbox": "all"})).json()
    on_board = next(c for col in board["columns"] for c in col["items"] if c["reference"] == ref)
    assert on_board["reporters"] == 3 and on_board["priority_review"] is True

    # Staff never see the count, so asking colleagues to +1 has nothing to aim at.
    tracker = (await staff.get(f"/api/feedback/{ref}/tracker")).json()
    assert "reporters" not in tracker and "priority_review" not in tracker


async def test_backup_form_when_the_model_is_off(staff: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MODEL_PROVIDER", "gemini")  # chosen, but no key
    get_settings.cache_clear()
    agent_runtime.reset()
    r = await staff.post("/api/chat/sessions", json={"project_slug": "rake-agent"})
    assert (
        r.json()["mode"] == "fallback"
        and r.json()["project"]["slug"] == "rake-agent"
        and len(r.json()["projects"]) == 15
    )
    r = await staff.post(
        "/api/feedback/fallback",
        json={"project_slug": "rake-agent", "details": "RAKE times out. Since this morning.", "how_much": "blocking"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "needs_review"
    async with session_scope() as db:
        fb = await db.scalar(select(Feedback))
        assert fb is not None and (fb.channel, fb.priority, fb.title) == ("fallback", "P1", "RAKE times out.")
        assert fb.dev_brief["open_gaps"]


async def test_model_error_switches_to_the_backup_form(
    staff: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    sid = await start_chat(staff)

    async def broken(*args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("model down")
        yield  # pragma: no cover

    monkeypatch.setattr(agent_runtime, "run_turn", broken)
    assert first(await say(staff, sid, "RAKE is broken"), "fallback") == {"reason": "error"}


async def test_sessions_survive_an_api_restart(staff: httpx.AsyncClient) -> None:
    sid = await start_chat(staff, project="flipbook")
    await say(staff, sid, "Flipbook crashes when I open the brochure")
    agent_runtime.reset(sessions=True)
    events = await say(staff, sid, "It's annoying")
    assert texts(events)[-1] == ASK_EXPECTED


def test_a_guessed_tool_holds_the_card_until_the_person_names_it() -> None:
    # Found by the conversation checks: "the system keeps crashing" got a card while Sig was still
    # asking which tool, because its question didn't end with "?".
    from types import SimpleNamespace

    from app.api.chat import _tool_unconfirmed as held

    rake = SimpleNamespace(name="RAKE Agent", slug="rake-agent", aliases=["rake"], keywords=[])
    assert held({"user_text": "the system keeps crashing\nBlocking my work"}, "rake-agent", rake)
    assert not held({"user_text": "the system keeps crashing\nRAKE Agent"}, "rake-agent", rake)  # the chip
    assert not held({"user_text": "it keeps crashing", "project_hint": "rake-agent"}, "rake-agent", rake)  # page link
    flipbook = SimpleNamespace(name="Flipbook", slug="flipbook", aliases=[], keywords=[])
    assert not held({"user_text": "Flipbook的页面是空白的"}, "flipbook", flipbook)  # no space before Chinese text
    # "general" is for someone who doesn't know the tool, or ran out of questions; earlier it is a guess.
    assert held({"user_text": "the system keeps crashing\nBlocking my work", "questions": 1}, "general", None)
    assert not held({"user_text": "the system keeps crashing\nNot sure", "questions": 1}, "general", None)
    assert not held({"user_text": "rake\nrake\nrake", "questions": 3}, "general", None)


def test_a_message_that_lists_the_card_fields_is_cut_back_to_the_lead_in() -> None:
    listed = f"Looks like someone raised this.\n\n{SHOW_SUMMARY}\n\n**Title:** Blank answer\n**Priority:** P2"
    assert _without_card_fields(listed) == f"Looks like someone raised this.\n\n{SHOW_SUMMARY}"
    assert _without_card_fields(ASK_IMPACT) == ASK_IMPACT
