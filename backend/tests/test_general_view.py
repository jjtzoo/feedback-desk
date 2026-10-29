"""Other staff see general information about an item (D97): no names, transcript, replies, files or anything
internal; followers too. This affects me too follows it without opening the rest."""

import httpx
from sqlalchemy import select

from app.db import session_scope
from app.models import Attachment, DigitalStaff, Feedback, Notification
from app.services import embeddings
from app.services.privacy import hide_names
from tests.conftest import STAFF2, signed_in, submit_via_chat

BUG = "RAKE gives a blank answer about leave, it's annoying"
ANSWERS = ["I expected an answer but got an empty box"]
GENERAL_FIELDS = {
    "reference",
    "title",
    "summary",
    "project",
    "status_text",
    "stage",
    "stages",
    "expected_by",
    "updates",
    "merged_into",
    "following",
    "muted",
    "can_plus_one",
}


async def worked_item(staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient) -> str:
    """An approved item with a public update that names the reporter, a reply, a follow-up and an internal note."""
    ref = str((await submit_via_chat(staff, BUG, ANSWERS))["reference"])
    assert (await marc.post(f"/api/console/items/{ref}/approve", json={"instructions": "Check the index"})).is_success
    assert (await darlene.post(f"/api/console/items/{ref}/start")).is_success
    async with session_scope() as db:
        fb = await db.scalar(select(Feedback).where(Feedback.ref_no == ref))
        assert fb is not None
        first = fb.submitter_name.split()[0]
    update = f"Hi {first}, we reproduced it. Write to darlene@redadair.example if it gets worse."
    assert (await darlene.post(f"/api/console/items/{ref}/update", json={"body": update})).is_success
    assert (await darlene.post(f"/api/console/items/{ref}/reply", json={"body": "Which leave type?"})).is_success
    assert (await darlene.post(f"/api/console/items/{ref}/note", json={"body": "Probably the index"})).is_success
    assert (await staff.post(f"/api/feedback/{ref}/replies", json={"body": "Annual leave"})).is_success
    return ref


async def test_a_colleague_sees_general_information_and_no_names(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await worked_item(staff, marc, darlene)
    other = await signed_in(STAFF2)
    g = (await other.get(f"/api/feedback/{ref}/general")).json()
    assert set(g) == GENERAL_FIELDS
    assert g["reference"] == ref and g["project"] == "RAKE Agent" and g["stage"] == "in_progress"
    assert g["following"] is False and g["can_plus_one"] is True and g["merged_into"] is None
    assert [u["text"] for u in g["updates"]] == ["Hi someone, we reproduced it. Write to someone if it gets worse."]
    async with session_scope() as db:
        fb = await db.scalar(select(Feedback).where(Feedback.ref_no == ref))
        assert fb is not None
        people = [fb.submitter_name, *(await db.scalars(select(DigitalStaff.name)))]
    shown = str(g)
    for name in people:
        assert all(part not in shown for part in name.split()), name
    for hidden in ("@", "Which leave type", "Probably the index", "Annual leave", "Check the index"):
        assert hidden not in shown

    # Nothing beyond it: not the tracker, files, replies or mute.
    assert (await other.get(f"/api/feedback/{ref}/tracker")).status_code == 404
    assert (await other.post(f"/api/feedback/{ref}/replies", json={"body": "x"})).status_code == 404
    assert (await other.post(f"/api/feedback/{ref}/mute", json={"muted": True})).status_code == 404
    await other.aclose()


async def test_unknown_and_flagged_items_are_not_found(staff: httpx.AsyncClient) -> None:
    ref = str((await submit_via_chat(staff, BUG, ANSWERS))["reference"])
    other = await signed_in(STAFF2)
    assert (await other.get("/api/feedback/FB-9999/general")).status_code == 404
    async with session_scope() as db:
        fb = await db.scalar(select(Feedback).where(Feedback.ref_no == ref))
        assert fb is not None
        fb.flagged = True  # abusive about a colleague: for the Admins only
    assert (await other.get(f"/api/feedback/{ref}/general")).status_code == 404
    assert (await other.post(f"/api/feedback/{ref}/plus-one")).status_code == 404
    await other.aclose()


async def test_this_affects_me_too_follows_it_but_opens_nothing_more(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = await worked_item(staff, marc, darlene)
    async with session_scope() as db:
        fb = await db.scalar(select(Feedback).where(Feedback.ref_no == ref))
        assert fb is not None
        db.add(
            Attachment(
                feedback_id=fb.id,
                uploaded_by=fb.submitter_email,
                file_name="a.png",
                mime_type="image/png",
                size_bytes=3,
                storage_path="test/a.png",
            )
        )
    other = await signed_in(STAFF2)
    r = await other.post(f"/api/feedback/{ref}/plus-one")
    assert r.status_code == 200 and r.json()["following"] is True and r.json()["can_plus_one"] is False
    mine = (await other.get("/api/my/feedback")).json()
    assert [(i["reference"], i["following"]) for i in mine] == [(ref, True)]
    # A follower still gets general information only (D97), and may mute it.
    assert (await other.get(f"/api/feedback/{ref}/tracker")).status_code == 404
    async with session_scope() as db:
        file_id = await db.scalar(select(Attachment.id))
    assert (await other.get(f"/api/files/{file_id}", follow_redirects=False)).status_code == 404
    assert (await other.post(f"/api/feedback/{ref}/mute", json={"muted": True})).status_code == 204
    assert (await other.get(f"/api/feedback/{ref}/general")).json()["muted"] is True
    # The owner hears about it, without a comment.
    history = (await darlene.get(f"/api/console/items/{ref}")).json()["events"]
    assert any(e["event_type"] == "plus_one" for e in history)
    # The person who raised it and the Digital team have the tracker instead.
    assert (await staff.post(f"/api/feedback/{ref}/plus-one")).status_code == 409
    assert (await darlene.post(f"/api/feedback/{ref}/plus-one")).status_code == 409
    assert (await darlene.get(f"/api/feedback/{ref}/tracker")).status_code == 200
    await other.aclose()


async def test_a_merged_item_points_to_the_original(staff: httpx.AsyncClient, darlene: httpx.AsyncClient) -> None:
    original = str((await submit_via_chat(staff, BUG, ANSWERS))["reference"])
    dup = str(
        (await submit_via_chat(staff, "RAKE gives a blank answer about leave, really annoying", ANSWERS))["reference"]
    )
    assert (await darlene.post(f"/api/console/items/{dup}/merge", json={"into": original})).is_success
    other = await signed_in(STAFF2)
    g = (await other.get(f"/api/feedback/{dup}/general")).json()
    assert g["merged_into"] == original and g["status_text"] == f"Duplicate of {original}"
    assert g["can_plus_one"] is False  # closed: +1 goes on the original
    await other.aclose()


def test_hide_names_replaces_people_and_emails_as_written() -> None:
    names = ["Mei Lin", "Will Carter"]
    assert hide_names("Hi Mei Lin, Mei says will do. Ask Will (will.carter@x.com).", names) == (
        "Hi someone, someone says will do. Ask someone (someone)."
    )
    assert hide_names("Nothing to hide", []) == "Nothing to hide"


async def follower_rows(feedback_ref: str) -> list[Notification]:
    async with session_scope() as db:
        fb = await db.scalar(select(Feedback).where(Feedback.ref_no == feedback_ref))
        assert fb is not None
        query = select(Notification).where(Notification.recipient_email == STAFF2, Notification.feedback_id == fb.id)
        return list(await db.scalars(query.order_by(Notification.created_at)))


async def test_a_follower_hears_the_stages_and_updates_without_names_or_messages(
    staff: httpx.AsyncClient, marc: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = str((await submit_via_chat(staff, BUG, ANSWERS))["reference"])
    other = await signed_in(STAFF2)
    assert (await other.post(f"/api/feedback/{ref}/plus-one")).is_success
    assert (await marc.post(f"/api/console/items/{ref}/approve")).is_success
    async with session_scope() as db:
        fb = await db.scalar(select(Feedback).where(Feedback.ref_no == ref))
        assert fb is not None
        first = fb.submitter_name.split()[0]
    check = {"body": f"Hi {first}, please try it now."}
    assert (await darlene.post(f"/api/console/items/{ref}/start")).is_success
    assert (await darlene.post(f"/api/console/items/{ref}/update", json=check)).is_success
    assert (await darlene.post(f"/api/console/items/{ref}/reply", json={"body": "Which leave type?"})).is_success
    wont_fix = {"reason": "Budget not approved", "ending": "wont_fix"}
    assert (await darlene.post(f"/api/console/items/{ref}/close", json=wont_fix)).is_success

    told = [(n.type, n.title, n.body) for n in await follower_rows(ref)]
    # The update, as the general view shows it; the reply was for the person who raised it (D96).
    assert ("progress", f"Update on {ref}", "Hi someone, please try it now.") in told
    assert all(kind != "reply" for kind, _, _ in told)
    # The ending, without its reason; and nobody named anywhere.
    assert ("stage", f"{ref} won't be fixed", "") in told
    shown = str(told)
    async with session_scope() as db:
        people = [first, *(await db.scalars(select(DigitalStaff.name)))]
    assert all(name.split()[0] not in shown for name in people)
    await other.aclose()


async def test_flagged_items_are_never_offered_as_a_match(staff: httpx.AsyncClient) -> None:
    ref = str((await submit_via_chat(staff, BUG, ANSWERS))["reference"])
    async with session_scope() as db:
        fb = await db.scalar(select(Feedback).where(Feedback.ref_no == ref))
        assert fb is not None and fb.project_id is not None
        assert [s.ref_no for s in await embeddings.find_similar(db, fb.project_id, fb.summary)] == [ref]
        fb.flagged = True
        await db.flush()
        assert await embeddings.find_similar(db, fb.project_id, fb.summary) == []


async def test_a_followed_item_in_my_feedback_hides_names_in_its_title(
    staff: httpx.AsyncClient, darlene: httpx.AsyncClient
) -> None:
    ref = str((await submit_via_chat(staff, BUG, ANSWERS))["reference"])
    async with session_scope() as db:
        fb = await db.scalar(select(Feedback).where(Feedback.ref_no == ref))
        assert fb is not None
        fb.title = f"RAKE fails for {fb.submitter_name}"
    other = await signed_in(STAFF2)
    assert (await other.post(f"/api/feedback/{ref}/plus-one")).is_success
    assert [i["title"] for i in (await other.get("/api/my/feedback")).json()] == ["RAKE fails for someone"]
    assert (await staff.get("/api/my/feedback")).json()[0]["title"] != "RAKE fails for someone"
    await other.aclose()
