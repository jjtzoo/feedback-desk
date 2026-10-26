"""The staff chat (brief §4.1): streaming replies, quick-pick chips, attachments, the confirm
card, "+1 and comment", and the backup form when the model is down (F10).

Messages stream back as server-sent events:
  message    {"text"}                               something the agent says
  chips      {"kind", "options"}                    quick picks (project, impact, reply)
  duplicates {"candidates"}                         likely duplicates, for "+1 and comment"
  draft      {"card", "hash"}                       the confirm card, once the draft is complete
  done       {"reference", "assigned_to", "status"} saved
  fallback   {"reason"}                             switch to the backup form, keep the text
  end        {}
"""

import asyncio
import json
import logging
import uuid
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, File, UploadFile
from google.genai import types
from sqlalchemy import select
from sse_starlette.sse import EventSourceResponse

from app import agent_runtime as runtime
from app.api.deps import STREAM_HEADERS, CurrentUser, Db, StreamUser
from app.config import get_settings
from app.db import session_scope
from app.errors import Conflict, NotFound, ServiceError
from app.models import Attachment
from app.schemas import (
    AttachmentOut,
    ChatStartIn,
    ChatStartOut,
    ConfirmIn,
    FallbackIn,
    MessageIn,
    PlusOneIn,
    ProjectOut,
    SavedOut,
)
from app.services import catalog, files, usage
from app.services import feedback as feedback_service
from app.services.actors import User
from app.services.drafts import (
    GENERAL,
    IMPACT_QUESTION,
    card,
    draft_hash,
    first_sentence,
    impact_chips,
    is_complete,
)
from app.services.privacy import mask
from app.services.ratelimit import RateLimiter

log = logging.getLogger(__name__)
router = APIRouter(tags=["chat"])
session_limiter = RateLimiter(get_settings().chat_sessions_per_user_per_hour, 3600)

SHOW_SUMMARY_LEAD = "Here's what I'll send"
SHOW_SUMMARY = "Here's what I'll send. Check it and press Confirm, or tell me what to change."


@router.post("/chat/sessions", response_model=ChatStartOut)
async def start_session(body: ChatStartIn, user: CurrentUser, db: Db) -> ChatStartOut:
    if not session_limiter.allow(user.email):
        raise ServiceError("rate_limited", "That's a lot of chats in an hour. Please try again a bit later.", 429)
    projects = await catalog.list_projects(db)
    project = next((p for p in projects if p.slug == body.project_slug), None) if body.project_slug else None
    project_out = ProjectOut.model_validate(project) if project else None
    project_list = [ProjectOut.model_validate(p) for p in projects]
    choice = runtime.model_choice()
    if choice.provider == "none" or not choice.configured:
        return ChatStartOut(mode="fallback", project=project_out, projects=project_list)
    # Spend guards (D36) are checked only when a chat starts: a chat in progress always finishes
    # (it is already capped by max_messages_per_session), and over a limit the backup form takes it.
    allowance = await usage.allowance(db, user.email)
    if allowance.blocked:
        return ChatStartOut(mode="fallback", limit=allowance.blocked, project=project_out, projects=project_list)
    try:
        sid = await runtime.create_session(user, project.slug if project else None, body.context.model_dump())
    except Exception:
        log.exception("could not start an agent session")
        return ChatStartOut(mode="fallback", project=project_out, projects=project_list)
    return ChatStartOut(
        mode="chat", session_id=sid, greeting=runtime.GREETING, project=project_out, projects=project_list
    )


@router.post("/chat/sessions/{session_id}/attachments", response_model=AttachmentOut, status_code=201)
async def upload(session_id: str, user: CurrentUser, db: Db, file: UploadFile = File(...)) -> AttachmentOut:  # noqa: B008
    await _state(user, session_id)
    content = await file.read(get_settings().max_file_mb * 1024 * 1024 + 1)
    att = await files.save(db, files.Upload(file.filename or "file", content), user.email, session_id=session_id)
    return AttachmentOut.model_validate(att)


@router.post("/chat/sessions/{session_id}/messages")
async def send_message(session_id: str, body: MessageIn, user: StreamUser) -> EventSourceResponse:
    state = await _state(user, session_id)
    settings = get_settings()
    messages = int(state.get("messages") or 0)
    if messages >= settings.max_messages_per_session:
        raise ServiceError("rate_limited", "This chat has reached its message limit. Use the form instead.", 429)
    text = mask(body.text)
    parts = await _message_parts(user, session_id, text, body.attachment_ids)
    delta = {
        "messages": messages + 1,
        "user_turns": int(state.get("user_turns") or 0) + 1,
        # The person's own words (masked), so update_draft can tell whether they named the tool.
        "user_text": f"{state.get('user_text') or ''}\n{text}"[-4000:],
        # Suggested answers belong to one question: update_draft sets them again for the next one.
        "replies": [],
    }
    return EventSourceResponse(_stream(user, session_id, parts, delta), headers=STREAM_HEADERS)


@router.post("/chat/sessions/{session_id}/confirm")
async def confirm(session_id: str, body: ConfirmIn, user: StreamUser) -> EventSourceResponse:
    """The confirm card's button. Confirms only the draft the card showed (D12)."""
    state = await _state(user, session_id)
    draft = state.get("draft") or {}
    if not is_complete(draft) or draft_hash(draft) != body.draft_hash:
        raise Conflict("draft_changed", "The summary changed. Please check it again.")
    return EventSourceResponse(
        _stream(user, session_id, [types.Part(text="Confirmed")], {"draft_confirmed": True}), headers=STREAM_HEADERS
    )


@router.post("/chat/sessions/{session_id}/plus-one", response_model=SavedOut)
async def plus_one(session_id: str, body: PlusOneIn, user: CurrentUser, db: Db) -> SavedOut:
    """Add the user's comment to the likely duplicate instead of opening a new item."""
    state = await _state(user, session_id)
    offered = {c["reference"] for c in state.get("duplicates") or []}
    if body.reference not in offered:
        raise Conflict("not_offered", "That item wasn't offered as a match in this chat.")
    comment = body.comment.strip() or _user_words(state)
    fb = await feedback_service.plus_one(db, user, body.reference, mask(comment))
    saved = {
        "reference": fb.ref_no,
        "assigned_to": fb.assignee.name if fb.assignee else "the Digital team",
        "status": fb.status,
        "plus_one": True,
    }
    await runtime.update_state(user, session_id, {"saved": saved})
    return SavedOut(reference=fb.ref_no, assigned_to=saved["assigned_to"], status=fb.status)


@router.post("/feedback/fallback", response_model=SavedOut, status_code=201)
async def save_fallback(body: FallbackIn, user: CurrentUser, db: Db) -> SavedOut:
    """The backup form: nothing is lost when the model is down (brief §8). Lands in Needs review."""
    if not session_limiter.allow(user.email):
        raise ServiceError("rate_limited", "That's a lot of feedback in an hour. Please try again a bit later.", 429)
    project = await catalog.project_by_slug(db, body.project_slug) if body.project_slug else None
    details = mask(body.details.strip())
    priority = {"blocking": "P1", "annoying": "P2", "nice_to_have": "P4"}.get(body.how_much or "")
    draft: dict[str, Any] = {
        "project_slug": project.slug if project else GENERAL,
        "confidence": {"project": 0.0},
        "summary": first_sentence(details, 200),
        "title": first_sentence(details, 80),
        "priority": priority,
        "brief": {"problem": first_sentence(details, 200), "submitter_quote": first_sentence(details, 200)},
    }
    created = await feedback_service.submit(
        db,
        feedback_service.Submission(
            user=user,
            draft=draft,
            context=body.context.model_dump(),
            channel="fallback",
            session_id=body.session_id,
            original_text=details,
        ),
    )
    fb = created.feedback
    return SavedOut(
        reference=fb.ref_no, assigned_to=fb.assignee.name if fb.assignee else "the Digital team", status=fb.status
    )


# --- helpers ------------------------------------------------------------------------------


async def _state(user: User, session_id: str) -> dict[str, Any]:
    try:
        state = await runtime.get_state(user, session_id)
    except Exception as exc:
        log.exception("could not read session %s", session_id)
        raise ServiceError("unavailable", "The chat isn't available right now.", 503) from exc
    if state is None:
        raise NotFound("That chat has ended. Please start again.")
    if state.get("saved"):
        raise Conflict("already_saved", "This chat's feedback is already sent.")
    return state


def _user_words(state: dict[str, Any]) -> str:
    draft = state.get("draft") or {}
    return str((draft.get("brief") or {}).get("submitter_quote") or draft.get("summary") or "")


async def _message_parts(user: User, session_id: str, text: str, ids: list[uuid.UUID]) -> list[types.Part]:
    """The user's text, plus each attached file: Word and Excel as text, PDFs and images as
    bytes for Gemini (brief §4.1.4)."""
    parts = [types.Part(text=text)]
    if not ids:
        return parts
    real_model = runtime.model_choice().provider in ("gemini", "vertex")
    async with session_scope() as db:
        rows = list(
            await db.scalars(
                select(Attachment).where(
                    Attachment.id.in_(ids), Attachment.session_id == session_id, Attachment.uploaded_by == user.email
                )
            )
        )
        for att in rows:
            note = f"[Attached: {att.file_name}]"
            if att.extracted_text:
                note += f"\nText from the file:\n{mask(att.extracted_text)[:6000]}"
            parts.append(types.Part(text=note))
            if real_model and att.mime_type.startswith(("image/", "application/pdf")):
                parts.append(types.Part.from_bytes(data=await files.read(att), mime_type=att.mime_type))
    return parts


def _without_card_fields(text: str) -> str:
    """The confirm card shows the draft, so a model message that also lists it ("**Title:** …")
    is cut back to the lead-in line."""
    at = text.find(SHOW_SUMMARY_LEAD)
    return text if at < 0 else text[:at] + SHOW_SUMMARY


async def _project_chips(user: User, state: dict[str, Any]) -> list[dict[str, Any]]:
    """Every tool, the person's likely ones first and marked usual (D60), then "Not sure"."""
    async with session_scope() as db:
        projects = await catalog.list_projects(db)
        source = str((state.get("context") or {}).get("source") or "")
        usual = await catalog.likely_projects(db, user.email, source, projects)
    rest = [p for p in projects if p not in usual]
    return [
        *({"label": p.name, "value": p.name, "usual": True} for p in usual),
        *({"label": p.name, "value": p.name} for p in rest),
        {"label": "Not sure", "value": "Not sure"},
    ]


def _sse(event: str, data: dict[str, Any]) -> dict[str, str]:
    return {"event": event, "data": json.dumps(data, ensure_ascii=False, default=str)}


async def _stream(
    user: User, session_id: str, parts: list[types.Part], delta: dict[str, Any]
) -> AsyncIterator[dict[str, str]]:
    said: list[str] = []
    try:
        async with asyncio.timeout(get_settings().agent_turn_timeout_seconds):
            async for raw in runtime.run_turn(user, session_id, parts, delta):
                text = _without_card_fields(raw)
                said.append(text)
                yield _sse("message", {"text": text})
    except TimeoutError:
        log.warning("agent turn timed out session=%s", session_id)
        yield _sse("fallback", {"reason": "timeout"})
        yield _sse("end", {})
        return
    except Exception:
        log.exception("agent turn failed session=%s", session_id)
        yield _sse("fallback", {"reason": "error"})
        yield _sse("end", {})
        return

    state = await runtime.get_state(user, session_id) or {}
    saved = state.get("saved")
    if saved:
        yield _sse("done", {k: saved.get(k) for k in ("reference", "assigned_to", "status")})
        yield _sse("end", {})
        return
    if state.get("offer_fallback"):
        yield _sse("fallback", {"reason": "too_long"})
        yield _sse("end", {})
        return

    draft = state.get("draft") or {}
    asking = bool(said) and said[-1].rstrip().endswith("?")
    if state.get("duplicates"):
        yield _sse("duplicates", {"candidates": state["duplicates"]})
    if is_complete(draft) and not asking:
        async with session_scope() as db:
            slug = draft.get("project_slug")
            project = await catalog.project_by_slug(db, slug) if slug and slug != GENERAL else None
        yield _sse("draft", {"card": card(draft, project.name if project else None), "hash": draft_hash(draft)})
    else:
        replies = state.get("replies") or []
        if not draft.get("project_slug"):
            yield _sse("chips", {"kind": "project", "options": await _project_chips(user, state)})
        elif asking and replies:
            yield _sse("chips", {"kind": "reply", "options": [{"label": r, "value": r} for r in replies]})
        elif asking and not draft.get("priority") and IMPACT_QUESTION.search(said[-1]):
            yield _sse("chips", {"kind": "impact", "options": impact_chips(draft)})
    if asking:
        await runtime.update_state(user, session_id, {"questions": int(state.get("questions") or 0) + 1})
    yield _sse("end", {})
