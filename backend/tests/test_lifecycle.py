"""Sprint 3: approvals, the console and the staff tracker, walked end to end (S3-1 to S3-5)."""

import asyncio

import httpx
import pytest
from sqlalchemy import delete, select, update

from app import agent_runtime, worker
from app.config import get_settings
from app.db import session_scope
from app.models import Feedback, FeedbackEmbedding, FeedbackEvent, Notification
from app.services import email as email_service
from app.services import embeddings
from tests.conftest import CHRIS, DARLENE, MARIO, STAFF, STAFF2, signed_in, submit_via_chat

BUG = "RAKE gives a blank answer about leave, it's annoying"
BUG_ANSWERS = ["I expected an answer but got an empty box"]


async def raise_bug(staff: httpx.AsyncClient) -> str:
    return str((await submit_via_chat(staff, BUG, BUG_ANSWERS))["reference"])


async def notes_for(email: str) -> list[str]:
    async with session_scope() as db:
        return list(
            await db.scalars(
                select(Notification.type).where(Notification.recipient_email == email).order_by(Notification.created_at)
            )
        )


async def test_full_lifecycle_end_to_end(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await raise_bug(staff)

    # Darlene sees it on her board, in Approved only after an Admin approves.
    board = (await darlene.get("/api/console/board")).json()
    assert [c["key"] for c in board["columns"]] == ["approved", "in_progress", "resolved"]  # no admin columns
    assert board["view"] == "board"
    assert (await darlene.post(f"/api/console/items/{ref}/start")).status_code == 409  # not approved yet

    # Marc sees the approvals column and approves.
    marc_board = (await marc.get("/api/console/board", params={"inbox": "open"})).json()
    awaiting = next(c for c in marc_board["columns"] if c["key"] == "awaiting_approval")
    assert awaiting["items"][0]["reference"] == ref
    assert (await darlene.post(f"/api/console/items/{ref}/approve")).status_code == 403
    r = await marc.post(f"/api/console/items/{ref}/approve")
    assert r.status_code == 200 and r.json()["status"] == "approved"
    # Staff see stage 2 as Planned (D43).
    planned = (await staff.get(f"/api/feedback/{ref}/tracker")).json()
    assert planned["status_text"] == "Planned, not started yet" and planned["stages"][1]["label"] == "Planned"

    # Darlene opens it (first-open event), starts work, posts an update with Expected by.
    detail = (await darlene.get(f"/api/console/items/{ref}")).json()
    assert detail["dev_brief"]["problem"] and detail["ai_confidence"]["project"] == 0.9
    assert (await darlene.post(f"/api/console/items/{ref}/move", json={"column": "in_progress"})).json()[
        "status"
    ] == "in_progress"
    r = await darlene.post(
        f"/api/console/items/{ref}/update",
        json={"body": "Found the cause; the fix is in testing.", "expected_by": "2026-10-23"},
    )
    assert r.json()["expected_by"] == "2026-10-23"
    await darlene.post(f"/api/console/items/{ref}/note", json={"body": "Internal: cache key bug"})

    # Staff tracker: stepper, who has it, latest update, public history only.
    t = (await staff.get(f"/api/feedback/{ref}/tracker")).json()
    assert t["status_text"] == "Being worked on" and t["stage"] == "in_progress"
    assert [s["state"] for s in t["stages"]] == ["done", "done", "current", "todo", "todo"]
    assert t["assignee"]["name"] == "Darlene" and t["assignee"]["role"] == "Digital Staff · RAKE Agent owner"
    assert t["latest_update"]["body"] == "Found the cause; the fix is in testing."
    history = [h["text"] for h in t["history"]]
    # An update shows once: who it's from, then its words (D80).
    assert history[-1] == "Update from Darlene"
    assert t["history"][-1]["detail"] == "Found the cause; the fix is in testing."
    for line in (
        "Expected by Fri 23 Oct",
        "Darlene started work",
        "Planned (Marc accepted it)",
        "Darlene opened your feedback",
        "Assigned to Darlene",
        "Received via chat",
    ):
        assert line in history, line
    assert not any("cache key" in h for h in history)  # internal notes never show

    # Resolve needs a note; a reply leaves it Resolved, and I still have an issue reopens it (D92).
    overdue = {"inbox": "overdue"}
    assert [i["reference"] for i in (await darlene.get("/api/console/items", params=overdue)).json()["items"]] == [ref]
    assert (await darlene.post(f"/api/console/items/{ref}/resolve", json={"body": ""})).status_code == 400
    assert (await darlene.post(f"/api/console/items/{ref}/resolve", json={"body": "Fix deployed"})).json()[
        "status"
    ] == "resolved"
    # A resolved item has met its Expected by date: no longer overdue.
    assert (await darlene.get("/api/console/items", params=overdue)).json()["items"] == []
    assert (await darlene.get("/api/console/counts")).json()["overdue"] == 0
    resolved = (await staff.get(f"/api/feedback/{ref}/tracker")).json()["history"]
    # The Resolve note and the status change are one entry, so the words show once (D80).
    assert resolved[-1] == {
        "at": resolved[-1]["at"],
        "text": "Resolved by Darlene",
        "detail": "Fix deployed",
        "said_by": None,
        "update": False,
    }
    assert resolved[-2]["text"] != "Update from Darlene" or resolved[-2]["detail"] != "Fix deployed"
    # The Windows clock ticks every ~16 ms; the reply must land after the assignee last read it.
    await asyncio.sleep(0.05)
    t = (await staff.post(f"/api/feedback/{ref}/replies", json={"body": "Is it on the app too?"})).json()
    assert t["status"] == "resolved" and t["is_it_fixed"]["state"] == "resolved"
    t = (await staff.post(f"/api/feedback/{ref}/still-an-issue", json={"body": "Still blank on my phone"})).json()
    assert t["status"] == "in_progress" and "Reopened: Sam Lee still has an issue" in [h["text"] for h in t["history"]]
    card = next(
        c
        for col in (await darlene.get("/api/console/board")).json()["columns"]
        for c in col["items"]
        if c["reference"] == ref
    )
    assert card["unread"] is True

    await darlene.post(f"/api/console/items/{ref}/resolve", json={"body": "Fixed for mobile too"})
    # A resolved item closes as fixed, never as won't fix (D45).
    wont = await darlene.post(f"/api/console/items/{ref}/close", json={"reason": "x", "ending": "wont_fix"})
    assert wont.status_code == 409
    # Only the person who raised it, the clock or an Admin closes it (D92).
    assert (await darlene.post(f"/api/console/items/{ref}/close", json={"reason": ""})).status_code == 409
    t = (await staff.post(f"/api/feedback/{ref}/fixed")).json()
    assert t["status"] == "closed" and t["ending"] == "fixed"
    assert t["can_reply"] is False and t["status_text"] == "Fixed" and t["stages"][4]["label"] == "Fixed"
    assert t["close_reason"] is None and "Sam Lee confirmed it's fixed" in [h["text"] for h in t["history"]]

    # The submitter heard about every stage, in the app and (queued) by email.
    assert await notes_for(STAFF) == ["stage", "stage", "progress", "is_it_fixed", "is_it_fixed"]
    async with session_scope() as db:
        statuses = set(await db.scalars(select(Notification.email_status)))
        assert statuses == {"queued"}
        changes = list(
            await db.scalars(select(FeedbackEvent.event_type).where(FeedbackEvent.actor_type.in_(("digital", "admin"))))
        )
        assert {"status", "expected_by", "opened"} <= set(changes)


async def test_decline_needs_a_reason_and_tells_the_submitter(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient
) -> None:
    ref = await raise_bug(staff)
    assert (await marc.post(f"/api/console/items/{ref}/decline", json={"reason": ""})).status_code == 422
    r = await marc.post(f"/api/console/items/{ref}/decline", json={"reason": "RAKE is being replaced next month"})
    assert r.json()["status"] == "declined"
    t = (await staff.get(f"/api/feedback/{ref}/tracker")).json()
    assert t["stage"] == "closed" and t["close_reason"] == "RAKE is being replaced next month"
    assert r.json()["ending"] == "declined" and t["status_text"] == "Declined"
    assert "Declined: RAKE is being replaced next month" in [h["text"] for h in t["history"]]


async def test_close_follows_the_state_and_endings_go_to_the_archive(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    dropped, done = await raise_bug(staff), await raise_bug(staff)
    for ref in (dropped, done):
        await marc.post(f"/api/console/items/{ref}/approve")

    # An open item can't close as fixed, and needs a reason for the other endings (D45).
    close = f"/api/console/items/{dropped}/close"
    assert (await darlene.post(close, json={"reason": "", "ending": "fixed"})).status_code == 409
    assert (await darlene.post(close, json={"reason": " ", "ending": "wont_fix"})).status_code == 400
    r = await darlene.post(close, json={"reason": "The HR bot replaces it", "ending": "wont_fix"})
    assert r.json()["status"] == "declined" and r.json()["ending"] == "wont_fix"
    t = (await staff.get(f"/api/feedback/{dropped}/tracker")).json()
    assert t["status_text"] == "Won't fix" and t["close_reason"] == "The HR bot replaces it"
    mine = {i["reference"]: i for i in (await staff.get("/api/my/feedback")).json()}
    assert mine[dropped]["status_text"] == "Won't fix" and mine[dropped]["ending"] == "wont_fix"
    async with session_scope() as db:
        titles = list(await db.scalars(select(Notification.title).where(Notification.recipient_email == STAFF)))
    assert f"{dropped} won't be fixed" in titles and f"{dropped} is planned" in titles

    await darlene.post(f"/api/console/items/{done}/start")
    await darlene.post(f"/api/console/items/{done}/resolve", json={"body": "Deployed"})
    # Digital Staff can't close a resolved item; an Admin can, with a reason (D92).
    assert (await darlene.post(f"/api/console/items/{done}/close", json={"reason": "Works"})).status_code == 409
    assert (await marc.post(f"/api/console/items/{done}/close", json={"reason": " "})).status_code == 400
    r = await marc.post(f"/api/console/items/{done}/close", json={"reason": "Confirmed by phone"})
    assert r.json()["ending"] == "fixed"

    # The board ends at Resolved; every ended item waits in the Archive (D47, D52).
    board = (await darlene.get("/api/console/board")).json()
    everywhere = [c["reference"] for col in board["columns"] for c in col["items"]]
    assert done not in everywhere and dropped not in everywhere
    archived = (await darlene.get("/api/console/board", params={"inbox": "archive"})).json()["columns"]
    by_ending = {c["key"]: [i["reference"] for i in c["items"]] for c in archived}
    assert by_ending["fixed"] == [done] and by_ending["wont_fix"] == [dropped] and by_ending["acknowledged"] == []
    archive = (await darlene.get("/api/console/items", params={"inbox": "archive", "ending": "wont_fix"})).json()
    assert [i["reference"] for i in archive["items"]] == [dropped]
    found = (await darlene.get("/api/console/items", params={"inbox": "archive", "q": done})).json()
    assert [i["reference"] for i in found["items"]] == [done]
    assert (await darlene.get("/api/console/items", params={"inbox": "archive", "ending": "x"})).status_code == 400


async def test_asking_for_info_is_a_reply_and_keeps_the_item_waiting(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient
) -> None:
    ref = await raise_bug(staff)
    r = await marc.post(f"/api/console/items/{ref}/reply", json={"body": "Which browser were you using?"})
    assert r.json()["status"] == "awaiting_approval"
    t = (await staff.get(f"/api/feedback/{ref}/tracker")).json()
    assert t["latest_update"]["body"] == "Which browser were you using?"
    assert "reply" in await notes_for(STAFF)


async def test_corrections_are_logged_and_reassignment_notifies(
    staff: httpx.AsyncClient, darlene: httpx.AsyncClient, marc: httpx.AsyncClient
) -> None:
    ref = await raise_bug(staff)
    mario_id = next(s["id"] for s in (await marc.get("/api/admin/digital-staff")).json() if s["google_email"] == MARIO)
    r = await darlene.patch(
        f"/api/console/items/{ref}",
        json={"project_slug": "cpd-tracker", "work_type": "improvement", "priority": "P3", "assignee_id": mario_id},
    )
    body = r.json()
    assert (body["project"]["slug"], body["work_type"], body["priority"], body["assignee"]["name"]) == (
        "cpd-tracker",
        "improvement",
        "P3",
        "Mario",
    )
    async with session_scope() as db:
        corrections = list(await db.scalars(select(FeedbackEvent).where(FeedbackEvent.event_type == "correction")))
        assert {next(iter(c.after)) for c in corrections} == {"project", "work_type", "priority"}
    assert "assigned" in await notes_for(MARIO)
    t = (await staff.get(f"/api/feedback/{ref}/tracker")).json()
    assert "Now with Mario" in [h["text"] for h in t["history"]]  # a change of hands, named (D53)


async def test_merge_moves_the_submitter_to_the_original(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    original = await raise_bug(staff)
    other = await signed_in(STAFF2)
    dup = str(
        (
            await submit_via_chat(
                other,
                "RAKE gives a blank answer about leave, really annoying",
                ["I expected an answer but got nothing"],
            )
        )["reference"]
    )
    detail = (await darlene.get(f"/api/console/items/{dup}")).json()
    assert detail["duplicates"] and detail["duplicates"][0]["reference"] == original
    r = await darlene.post(f"/api/console/items/{dup}/merge", json={"into": original})
    assert r.json()["status"] == "declined" and r.json()["merged_into"] == original
    t = (await other.get(f"/api/feedback/{dup}/tracker")).json()
    assert t["status_text"] == f"Duplicate of {original}" and t["ending"] == "duplicate"
    # Now follows the original, which they see as general information like any colleague (D97).
    assert (await other.get(f"/api/feedback/{original}/tracker")).status_code == 404
    assert (await other.get(f"/api/feedback/{original}/general")).json()["following"] is True
    await other.aclose()


async def test_a_merge_always_goes_into_the_earlier_report(
    staff: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    original = await raise_bug(staff)
    reply = await submit_via_chat(
        staff, "RAKE gives a blank answer about leave, really annoying", ["Nothing comes back"]
    )
    newer = str(reply["reference"])
    # Asked from the first report: the newer one still closes into it.
    r = await darlene.post(f"/api/console/items/{original}/merge", json={"into": newer})
    assert r.is_success and r.json()["status"] != "declined" and newer in r.json()["linked"]
    assert (await darlene.get(f"/api/console/items/{newer}")).json()["merged_into"] == original


async def test_notifications_are_masked_before_they_are_stored(
    staff: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await raise_bug(staff)
    r = await staff.post(
        f"/api/feedback/{ref}/replies",
        json={"body": "My password is Hunter2, card 4111 1111 1111 1111, TFN 123 456 782"},
    )
    assert r.status_code == 200
    # The card number straddles the 300-character cut: masked first, so no part of it survives.
    r = await darlene.post(f"/api/console/items/{ref}/reply", json={"body": "x" * 285 + " card 4111 1111 1111 1111"})
    assert r.status_code == 200
    async with session_scope() as db:
        rows = await db.execute(
            select(Notification.type, Notification.body).where(Notification.type.in_(["submitter_reply", "reply"]))
        )
        bodies = dict(rows.all())
    tracker = bodies["submitter_reply"]
    assert not any(s in tracker for s in ("Hunter2", "4111", "123 456 782"))
    assert all(m in tracker for m in ("[password removed]", "[card number removed]", "[TFN removed]"))
    assert "4111" not in bodies["reply"] and len(bodies["reply"]) <= 300


async def test_panel_opens_when_duplicate_search_fails(
    staff: httpx.AsyncClient, darlene: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    ref = await raise_bug(staff)

    async def broken(text: str) -> tuple[list[float], str]:
        raise RuntimeError("embedding model unavailable")

    monkeypatch.setattr(embeddings, "embed", broken)
    r = await darlene.get(f"/api/console/items/{ref}")
    assert r.status_code == 200 and r.json()["duplicates"] == []


async def test_backfill_embeds_items_duplicate_search_is_missing(
    staff: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    ref = await raise_bug(staff)

    async def stored_model() -> str | None:
        async with session_scope() as db:
            return await db.scalar(
                select(FeedbackEmbedding.model)
                .join(Feedback, Feedback.id == FeedbackEmbedding.feedback_id)
                .where(Feedback.ref_no == ref)
            )

    async def backfill() -> int:
        async with session_scope() as db:
            return await embeddings.backfill(db)

    async with session_scope() as db:
        await db.execute(delete(FeedbackEmbedding))  # the call failed when the item was saved
    assert await backfill() == 1 and await stored_model() == embeddings.STUB_MODEL
    async with session_scope() as db:
        await db.execute(update(FeedbackEmbedding).values(model="retired-model"))  # the model changed
    assert await backfill() == 1 and await stored_model() == embeddings.STUB_MODEL
    assert await backfill() == 0

    # Gemini chosen but unreachable here: its embeddings stay rather than be overwritten by the stub.
    async with session_scope() as db:
        await db.execute(update(FeedbackEmbedding).values(model="gemini-embedding-001"))
    monkeypatch.setenv("MODEL_PROVIDER", "gemini")
    get_settings.cache_clear()
    agent_runtime.reset()
    assert await backfill() == 0 and await stored_model() == "gemini-embedding-001"


async def test_staff_only_see_their_own_items(staff: httpx.AsyncClient) -> None:
    ref = await raise_bug(staff)
    other = await signed_in(STAFF2)
    assert (await other.get(f"/api/feedback/{ref}/tracker")).status_code == 404
    assert (await other.get("/api/my/feedback")).json() == []
    assert (await other.post(f"/api/feedback/{ref}/replies", json={"body": "x"})).status_code == 404
    await other.aclose()


async def test_list_filters_search_and_bulk(staff: httpx.AsyncClient, marc: httpx.AsyncClient) -> None:
    a = await raise_bug(staff)
    b = str(
        (
            await submit_via_chat(
                staff,
                "CPD Tracker certificate upload fails, it's annoying",
                ["I expected it to save but got error 500"],
            )
        )["reference"]
    )
    lst = (await marc.get("/api/console/items", params={"inbox": "all", "project": "cpd-tracker"})).json()
    assert [i["reference"] for i in lst["items"]] == [b] and lst["total"] == 1
    assert (await marc.get("/api/console/items", params={"inbox": "all", "q": "certificate"})).json()["total"] == 1
    assert (await marc.get("/api/console/items", params={"inbox": "all", "priority": "P2"})).json()["total"] == 2
    await marc.put("/api/console/view", json={"view": "list"})
    assert (await marc.get("/api/console/items", params={"inbox": "all"})).json()["view"] == "list"
    r = await marc.post("/api/console/bulk", json={"references": [a, b], "action": "close", "reason": "Test cleanup"})
    assert r.json() == {"done": 2}
    archive = (await marc.get("/api/console/items", params={"inbox": "archive", "ending": "no_longer_needed"})).json()
    assert archive["total"] == 2 and {i["ending"] for i in archive["items"]} == {"no_longer_needed"}


async def test_needs_review_column_is_for_the_triage_lead(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    await submit_via_chat(staff, "The login page is clunky and confusing", ["Not sure", "It's annoying"])
    keys = [
        c["key"] for c in (await marc.get("/api/console/board", params={"inbox": "needs_review"})).json()["columns"]
    ]
    assert keys[:2] == ["needs_review", "awaiting_approval"]
    col = (await marc.get("/api/console/board", params={"inbox": "needs_review"})).json()["columns"][0]
    assert col["count"] == 1
    # Darlene has no Needs review column, so her Triage neither counts nor lists the item.
    assert (await darlene.get("/api/console/counts")).json()["needs_review"] == 0
    assert (await darlene.get("/api/console/items", params={"inbox": "needs_review"})).json()["total"] == 0


async def test_mute_stops_notifications_for_one_item(staff: httpx.AsyncClient, marc: httpx.AsyncClient) -> None:
    ref = await raise_bug(staff)
    assert (await staff.post(f"/api/feedback/{ref}/mute", json={"muted": True})).status_code == 204
    await marc.post(f"/api/console/items/{ref}/approve")
    assert "stage" not in await notes_for(STAFF)


async def test_bell_lists_and_marks_read(staff: httpx.AsyncClient, marc: httpx.AsyncClient) -> None:
    ref = await raise_bug(staff)
    await marc.post(f"/api/console/items/{ref}/approve")
    bell = (await staff.get("/api/notifications")).json()
    assert bell["unread"] == 1 and bell["items"][0]["link"] == f"/track/{ref}"
    await staff.post("/api/notifications/read", json={})
    assert (await staff.get("/api/notifications")).json()["unread"] == 0


async def test_clear_empties_the_bell_and_the_page_keeps_it(staff: httpx.AsyncClient, marc: httpx.AsyncClient) -> None:
    ref = await raise_bug(staff)
    await marc.post(f"/api/console/items/{ref}/approve")
    assert (await staff.post("/api/notifications/clear")).status_code == 204
    assert (await staff.get("/api/notifications")).json() == {"items": [], "unread": 0}
    kept = (await staff.get("/api/notifications/history")).json()
    assert kept["more"] is False and kept["items"][0]["link"] == f"/track/{ref}" and kept["items"][0]["read_at"]


async def test_worker_sends_and_retries_then_fails(staff: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[str] = []
    monkeypatch.setattr(email_service, "send", lambda settings, to, subject, body: sent.append(to))
    await raise_bug(staff)  # notifies Darlene (assigned)
    assert await worker.send_batch() == 1 and sent == [DARLENE]

    def fail(*args: object) -> None:
        raise OSError("smtp down")

    monkeypatch.setattr(email_service, "send", fail)
    marc = await signed_in("marc@redadair.example")
    async with session_scope() as db:
        ref = await db.scalar(select(Feedback.ref_no))
    await marc.post(f"/api/console/items/{ref}/approve")
    for _ in range(3):
        await worker.send_batch()
        async with session_scope() as db:
            await db.execute(
                update(Notification)
                .where(Notification.email_status == "queued")
                .values(email_after=Notification.created_at)
            )
    async with session_scope() as db:
        statuses = {
            n.recipient_email: (n.email_status, n.email_attempts)
            for n in await db.scalars(select(Notification).where(Notification.type != "assigned"))
        }
    assert set(statuses.values()) == {("failed", 3)}
    await marc.aclose()


async def test_access_request_goes_to_chris(staff: httpx.AsyncClient) -> None:
    await submit_via_chat(staff, "I need access to the Training Portal admin area")
    assert "assigned" in await notes_for(CHRIS)


async def test_console_counts_follow_the_inboxes_and_approvals(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    before = (await marc.get("/api/console/counts")).json()
    mine_before = (await darlene.get("/api/console/counts")).json()["mine"]
    ref = await raise_bug(staff)

    after = (await marc.get("/api/console/counts")).json()
    assert after["approvals"] == before["approvals"] + 1
    assert after["open"] == before["open"] + 1
    assert (await darlene.get("/api/console/counts")).json()["mine"] == mine_before + 1  # routed to the RAKE owner

    assert (await marc.post(f"/api/console/items/{ref}/approve")).status_code == 200
    approved = (await marc.get("/api/console/counts")).json()
    assert approved["approvals"] == before["approvals"]

    # Approvals are an Admin's number: the Digital team sees zero, staff cannot ask at all.
    assert (await darlene.get("/api/console/counts")).json()["approvals"] == 0
    assert (await staff.get("/api/console/counts")).status_code == 403
