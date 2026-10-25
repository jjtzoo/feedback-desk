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
from app.services.drafts import GENERAL, apply_update, missing

log = logging.getLogger(__name__)
UNSURE_RE = re.compile(r"\b(not sure|unsure|don'?t know|no idea|dunno)\b")


async def list_projects() -> dict[str, Any]:
    """List the intranet projects (platforms and agents) staff can give feedback on.

    Returns:
        projects: slug (use it in update_draft), name, group, description, keywords and aliases.
        Use "general" when nothing fits.
    """
    async with session_scope() as db:
        projects = await catalog.list_projects(db)
        return {
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
            ]
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
) -> dict[str, Any]:
    """Save what you know into the draft. Pass only the fields you are setting.

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
        recommendation: implement, decline or needs_info.
        recommendation_reason: one sentence for the approver.
        summary: one plain-English sentence.
        title: under 80 characters.
        sentiment: positive, neutral or negative.
        problem: developer brief, one plain sentence.
        steps: developer brief, numbered steps to reproduce (fixes).
        expected: developer brief, what should happen (fixes).
        actual: developer brief, what happened instead (fixes).
        who_needs_it: developer brief, the job, how often, how many people (improvements, new features).
        asking_for: developer brief, the requested behaviour in their words.
        done_when: developer brief, 1 to 3 acceptance criteria.
        submitter_quote: a short quote from their message.
        open_gaps: what you couldn't find out.
        flag_abuse: true if the message is abusive about a named colleague.

    Returns:
        draft, missing (required fields still empty) and errors (rejected values).
    """
    updates = {k: v for k, v in locals().items() if k != "tool_context"}
    async with session_scope() as db:
        projects = await catalog.list_projects(db)
    draft, errors = apply_update(dict(tool_context.state.get("draft") or {}), updates, {p.slug for p in projects})
    result: dict[str, Any] = {}
    slug = draft.get("project_slug")
    chosen = next((p for p in projects if p.slug == slug), None)
    said = str(tool_context.state.get("user_text") or "")
    if chosen and slug != tool_context.state.get("project_hint") and not _names(said, chosen):
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
    tool_context.state["draft"] = draft
    # Any edit means the person has not confirmed this version (D12).
    tool_context.state["draft_confirmed"] = False
    return {"draft": draft, "missing": missing(draft), "errors": errors, **result}


def _names(said: str, project: Any) -> bool:
    """Whether the person's words name the project: its name, an alias or a keyword, as whole words."""
    low = said.lower()
    words = [project.name, project.slug.replace("-", " "), *project.aliases, *project.keywords]
    return any(re.search(rf"\b{re.escape(w.lower())}\b", low) for w in words if w)


async def find_duplicates(tool_context: ToolContext, limit: int = 3) -> dict[str, Any]:
    """Look for open items in the same project that may be the same issue.

    Returns:
        candidates: reference, title and date of each likely duplicate (never who raised it).
    """
    draft = dict(tool_context.state.get("draft") or {})
    slug = draft.get("project_slug")
    text = f"{draft.get('title', '')}. {draft.get('summary', '')}".strip(". ")
    if not slug or slug == GENERAL or not text:
        return {"candidates": [], "note": "Set the project and summary first."}
    async with session_scope() as db:
        project = await catalog.project_by_slug(db, slug)
        found = await embeddings.find_similar(db, project.id, text, limit=max(1, min(limit, 3))) if project else []
    candidates = [{"reference": s.ref_no, "title": s.title, "date": s.created_at_iso[:10]} for s in found]
    tool_context.state["duplicates"] = candidates
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
        if text and text != "Confirmed":
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
