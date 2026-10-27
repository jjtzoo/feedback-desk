"""The agent's tools (spec v3 "Tools"; D22). Thin: each one calls the app's services.

None of them takes content to save: submit_feedback reads the confirmed draft and the signed-in
user from session state, which only the API writes (D12).
"""

import logging
import re
from datetime import UTC, datetime
from typing import Any

from google.adk.tools.tool_context import ToolContext

from agent.callbacks import cost_aud
from app.config import get_settings
from app.db import session_scope
from app.services import catalog, embeddings
from app.services import feedback as feedback_service
from app.services.actors import User
from app.services.drafts import CONTINUE, GENERAL, NEXT_STEPS, apply_update, missing, quick_replies

log = logging.getLogger(__name__)
UNSURE_RE = re.compile(r"\b(not sure|unsure|don'?t know|no idea|dunno)\b")


async def list_projects(tool_context: ToolContext) -> dict[str, Any]:
    """List the intranet projects (platforms and agents) staff can give feedback on.

    Returns:
        projects: slug (use it in update_draft), name, group, description, keywords and aliases.
        Use "general" when nothing fits.
        usual_tools: names of the tools this person most likely means (the page they came from,
        then what they reported before), strongest first. A guess to ask about, never to file under.
    """
    who = dict(tool_context.state.get("user") or {})
    source = str((tool_context.state.get("context") or {}).get("source") or "")
    async with session_scope() as db:
        projects = await catalog.list_projects(db)
        usual = await catalog.likely_projects(db, str(who.get("email") or ""), source, projects)
        return {
            "usual_tools": [p.name for p in usual],
            "projects": [
                {
                    "slug": p.slug,
                    "name": p.name,
                    "group": p.project_group,
                    "description": p.description,
                    "keywords": list(p.keywords),
                    "aliases": list(p.aliases),
                }
                for p in projects
            ],
        }


async def update_draft(
    tool_context: ToolContext,
    project_slug: str | None = None,
    project_confidence: float | None = None,
    target_type: str | None = None,
    area: str | None = None,
    work_type: str | None = None,
    work_type_confidence: float | None = None,
    category: str | None = None,
    category_confidence: float | None = None,
    priority: str | None = None,
    priority_confidence: float | None = None,
    impact: str | None = None,
    effort: str | None = None,
    recommendation: str | None = None,
    recommendation_reason: str | None = None,
    summary: str | None = None,
    title: str | None = None,
    sentiment: str | None = None,
    problem: str | None = None,
    steps: list[str] | None = None,
    expected: str | None = None,
    actual: str | None = None,
    who_needs_it: str | None = None,
    asking_for: str | None = None,
    done_when: list[str] | None = None,
    submitter_quote: str | None = None,
    open_gaps: list[str] | None = None,
    flag_abuse: bool | None = None,
    replies: list[str] | None = None,
    next_step: str | None = None,
) -> dict[str, Any]:
    """Save what you know into the draft, and say what your next message does. Pass only the
    fields you are setting.

    Args:
        project_slug: a slug from list_projects, or "general".
        project_confidence: 0 to 1.
        target_type: platform, agent, intranet or other.
        area: which part of the tool, e.g. "login page".
        work_type: fix, improvement, new_feature or no_change.
        work_type_confidence: 0 to 1.
        category: bug, performance, data_issue, usability, feature_request, access_request, question or praise.
        category_confidence: 0 to 1.
        priority: P1 (blocking work), P2 (major: a real problem, but work can continue), P3 (minor) or
            P4 (nice-to-have). Leave it out until the person has said how much it affects them.
        priority_confidence: 0 to 1.
        impact: one_person, team or company.
        effort: S, M or L.
        recommendation: implement, decline or needs_info. Set it again with show_card, from
            everything known by then.
        recommendation_reason: one sentence for the approver, rewritten with the recommendation.
        summary: one plain-English sentence.
        title: under 80 characters.
        sentiment: positive, neutral or negative.
        problem: developer brief, one plain sentence.
        steps: developer brief, steps to reproduce, one per item, without numbers (fixes).
        expected: developer brief, what should happen (fixes).
        actual: developer brief, what happened instead (fixes).
        who_needs_it: developer brief, the job, how often, how many people (improvements, new features).
        asking_for: developer brief, the requested behaviour in their words.
        done_when: developer brief, 1 to 3 acceptance criteria.
        submitter_quote: a short quote from their message.
        open_gaps: what you couldn't find out, each as a short plain phrase, e.g. "Which screen is slow".
        flag_abuse: true if the message is abusive about a named colleague.
        replies: up to 3 short answers the person might tap for the question you are about to ask,
            in their words (e.g. "Every time", "Since this morning"). Leave out for a question that
            needs their own words, like what happened.
        next_step: what your next message does, so the page shows the right chips or the card:
            ask_tool (which tool), ask_details (what happened or what they'd like), ask_impact (how
            much it affects their work), ask_work_type (broken or new), check_send ("Want me to send
            that to the team?"), show_card (the summary card) or chat (they don't want to send it
            after all: the card goes). Set it on every call. Leave it out only when you are just
            chatting.

    Returns:
        draft, missing (required fields still empty), errors (rejected values) and next_step.
    """
    updates = {k: v for k, v in locals().items() if k not in ("tool_context", "replies", "next_step")}
    async with session_scope() as db:
        projects = await catalog.list_projects(db)
        staff = await catalog.list_staff(db)
    if replies is not None:
        # Shown as chips under this turn's question; the API clears them each turn.
        tool_context.state["replies"] = quick_replies(replies, [s.name for s in staff])
    draft, errors = apply_update(dict(tool_context.state.get("draft") or {}), updates, {p.slug for p in projects})
    result: dict[str, Any] = {}
    slug = draft.get("project_slug")
    chosen = next((p for p in projects if p.slug == slug), None)
    said = str(tool_context.state.get("user_text") or "")
    if chosen and slug != tool_context.state.get("project_hint") and not catalog.mentions(said, chosen):
        if UNSURE_RE.search(said.lower()):
            # They were asked and don't know: the Digital team checks it (needs review), no more questions.
            draft["project_slug"] = GENERAL
            draft.setdefault("confidence", {})["project"] = 0.3
        else:
            # "The page is slow" names no tool: don't let a guess pass for an answer.
            draft.setdefault("confidence", {})["project"] = min(float(draft["confidence"].get("project", 1.0)), 0.5)
            result["note"] = (
                f"They have not named {chosen.name} or anything that identifies it. Ask "
                "'Which tool is this about?' before the summary, unless you already asked."
            )
    if next_step is not None:
        if next_step not in NEXT_STEPS:
            errors.append(f"next_step must be one of: {', '.join(NEXT_STEPS)}.")
        else:
            second_ask = next_step == "ask_details" and tool_context.state.get("details_asked")
            if second_ask and not missing(draft) and "note" not in result:
                # One answer about the problem is enough (D69, D87): the card comes now.
                next_step = "show_card"
                result["note"] = (
                    "You already asked about the problem once and the draft is complete: no second "
                    "question. Say the card line now; put whatever is still missing in open_gaps."
                )
            # The page reads it after this turn; the API clears it before the next one.
            tool_context.state["step"] = next_step
            if next_step == "show_card" and missing(draft):
                result["note"] = f"The card can't show yet: {', '.join(missing(draft))} still empty."
    tool_context.state["draft"] = draft
    # Any edit means the person has not confirmed this version (D12).
    tool_context.state["draft_confirmed"] = False
    step = tool_context.state.get("step")
    return {"draft": draft, "missing": missing(draft), "errors": errors, "next_step": step, **result}


async def find_duplicates(tool_context: ToolContext, limit: int = 3) -> dict[str, Any]:
    """Look for items in the same project that may be the same issue: open ones, and ones fixed in
    the last few months.

    Returns:
        candidates: reference, title and date of each likely duplicate (never who raised it), and
        fixed_on (the day it was fixed) for one that was fixed before and may be happening again.
    """
    draft = dict(tool_context.state.get("draft") or {})
    slug = draft.get("project_slug")
    text = f"{draft.get('title', '')}. {draft.get('summary', '')}".strip(". ")
    if not slug or slug == GENERAL or not text:
        return {"candidates": [], "note": "Set the project and summary first."}
    async with session_scope() as db:
        project = await catalog.project_by_slug(db, slug)
        found = (
            await embeddings.find_similar(
                db, project.id, text, limit=max(1, min(limit, 3)), fixed_days=get_settings().duplicate_fixed_days
            )
            if project
            else []
        )
    candidates = [
        {"reference": s.ref_no, "title": s.title, "date": s.created_at_iso[:10]}
        | ({"fixed_on": s.fixed_at_iso[:10]} if s.fixed_at_iso else {})
        for s in found
    ]
    # Open matches get "+1 and comment" on the page; a fixed one is a possible regression instead (D73):
    # the new item goes in, linked to it for the owner.
    tool_context.state["duplicates"] = [c for c in candidates if "fixed_on" not in c]
    fixed = next((c for c in candidates if "fixed_on" in c), None)
    tool_context.state["regression_of"] = (
        {"reference": fixed["reference"], "title": fixed["title"], "fixed_on": fixed["fixed_on"]} if fixed else None
    )
    return {"candidates": candidates}


async def submit_feedback(tool_context: ToolContext) -> dict[str, Any]:
    """Save the confirmed draft. Call it only after you receive "Confirmed".

    Returns:
        reference and assigned_to (who has it) to tell the person, or error.
    """
    state = tool_context.state
    if state.get("saved"):
        return {"error": "already_saved", "reference": state["saved"]["reference"]}
    if not state.get("draft_confirmed"):
        return {"error": "not_confirmed", "message": "Ask the person to press Confirm on the summary."}
    draft = dict(state.get("draft") or {})
    if missing(draft):
        return {"error": "incomplete", "missing": missing(draft)}
    who = dict(state.get("user") or {})
    user = User(email=who["email"], name=who["name"], role=who.get("role", "staff"))

    turns: list[tuple[str, str, datetime]] = []
    for event in tool_context.session.events:
        if not event.content:
            continue
        text = "".join(p.text or "" for p in event.content.parts or [] if not p.thought).strip()
        if text and text not in ("Confirmed", CONTINUE):
            role = "user" if event.author == "user" else "agent"
            turns.append((role, text, datetime.fromtimestamp(event.timestamp, UTC)))
    first_user = next((t for r, t, _ in turns if r == "user"), "")

    usage = dict(state.get("usage") or {})
    usage["cost_aud"] = cost_aud(usage)
    async with session_scope() as db:
        created = await feedback_service.submit(
            db,
            feedback_service.Submission(
                user=user,
                draft=draft,
                context=dict(state.get("context") or {}) | {"model_usage": usage},
                channel="chat",
                session_id=tool_context.session.id,
                chat_turns=turns,
                original_text=first_user,
                regression_of=state.get("regression_of"),
            ),
        )
        fb = created.feedback
        assignee = fb.assignee.name if fb.assignee else None
        project = fb.project.name if fb.project else None
        result = {
            "reference": fb.ref_no,
            "assigned_to": assignee or "the Digital team",
            "project": project,
            "status": fb.status,
        }
    state["saved"] = result
    state["draft_confirmed"] = False
    log.info(
        "feedback saved reference=%s session=%s model=%s calls=%s input_tokens=%s output_tokens=%s cost_aud=%s",
        result["reference"],
        tool_context.session.id,
        get_settings().model_name,
        usage.get("calls", 0),
        usage.get("input_tokens", 0),
        usage.get("output_tokens", 0),
        usage["cost_aud"],
    )
    return result
