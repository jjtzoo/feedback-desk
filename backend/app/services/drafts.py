"""The agent's draft: classification fields and developer-brief sections collected before the
user confirms (spec v3 "Classification schema", "Developer brief"; D12).

Pure functions, so the guards are easy to unit test.
"""

import hashlib
import json
import re
from typing import Any

from app.models.enums import (
    CATEGORIES,
    EFFORTS,
    IMPACTS,
    PRIORITIES,
    RECOMMENDATIONS,
    SENTIMENTS,
    TARGET_TYPES,
    WORK_TYPES,
)

GENERAL = "general"
REQUIRED = ("project_slug", "work_type", "category", "priority", "summary", "title")
ENUMS: dict[str, tuple[str, ...]] = {
    "target_type": TARGET_TYPES,
    "work_type": WORK_TYPES,
    "category": CATEGORIES,
    "priority": PRIORITIES,
    "impact": IMPACTS,
    "effort": EFFORTS,
    "recommendation": RECOMMENDATIONS,
    "sentiment": SENTIMENTS,
}
TEXT_LIMITS = {
    "area": 200,
    "summary": 400,
    "title": 80,
    "recommendation_reason": 300,
}
BRIEF_TEXT = ("problem", "expected", "actual", "who_needs_it", "asking_for", "submitter_quote")
BRIEF_LISTS = ("steps", "done_when", "open_gaps")
CONFIDENCE = ("project", "work_type", "category", "priority")

WORK_TYPE_LABEL = {"fix": "Fix", "improvement": "Improvement", "new_feature": "New feature", "no_change": "No change"}
CATEGORY_LABEL = {
    "bug": "Bug",
    "performance": "Performance",
    "data_issue": "Data issue",
    "usability": "Usability",
    "feature_request": "Feature request",
    "access_request": "Access request",
    "question": "Question",
    "praise": "Praise",
}

Draft = dict[str, Any]


def apply_update(draft: Draft, updates: dict[str, Any], valid_slugs: set[str]) -> tuple[Draft, list[str]]:
    """Return the new draft and a list of errors. Fields with errors are left unchanged."""
    new: Draft = json.loads(json.dumps(draft or {}))
    new.setdefault("brief", {})
    new.setdefault("confidence", {})
    errors: list[str] = []
    for field, value in updates.items():
        if value is None:
            continue
        if field == "project_slug":
            slug = str(value).strip()
            if slug != GENERAL and slug not in valid_slugs:
                errors.append(f"Unknown project {slug!r}. Use a slug from list_projects, or 'general'.")
            else:
                new[field] = slug
        elif field in ENUMS:
            v = str(value).strip()
            if v not in ENUMS[field]:
                errors.append(f"{field} must be one of: {', '.join(ENUMS[field])}.")
            else:
                new[field] = v
        elif field in TEXT_LIMITS:
            v = str(value).strip()
            if field in ("summary", "title") and not v:
                errors.append(f"{field} can't be empty.")
            elif field in ("summary", "title") and v.lower().startswith(("the user", "user ")):
                errors.append(
                    f"Write the {field} in their terms, about the tool and what happens (for example "
                    "'IT Asset: asset search takes about a minute'), never 'The user ...'."
                )
            else:
                new[field] = v[: TEXT_LIMITS[field]]
        elif field in BRIEF_TEXT:
            new["brief"][field] = str(value).strip()[:2000]
        elif field in BRIEF_LISTS:
            items = value if isinstance(value, list) else [value]
            new["brief"][field] = [str(i).strip()[:500] for i in items if str(i).strip()][:10]
        elif field.endswith("_confidence") and field.removesuffix("_confidence") in CONFIDENCE:
            try:
                new["confidence"][field.removesuffix("_confidence")] = max(0.0, min(1.0, float(value)))
            except (TypeError, ValueError):
                errors.append(f"{field} must be a number from 0 to 1.")
        elif field == "flag_abuse":
            new["flag_abuse"] = bool(value)
        else:
            errors.append(f"Unknown field {field}.")
    # Praise has no impact to ask about, so it never waits on a priority: without one the confirm
    # card would never show.
    if new.get("category") == "praise" and not new.get("priority"):
        new["priority"] = "P4"
    return new, errors


def with_tool(draft: Draft, slug: str) -> Draft:
    """The draft with a tool the person chose on the page (`?project=` or an app card, D99): certain,
    so Sig never asks which tool."""
    new: Draft = json.loads(json.dumps(draft or {}))
    new["project_slug"] = slug
    new.setdefault("confidence", {})["project"] = 1.0
    return new


def missing(draft: Draft) -> list[str]:
    return [f for f in REQUIRED if not draft.get(f)]


def is_complete(draft: Draft) -> bool:
    return not missing(draft)


def draft_hash(draft: Draft) -> str:
    """Stable hash of the draft the confirm card shows. Confirm must send it back (D12)."""
    canonical = json.dumps(draft, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()


def card(draft: Draft, project_name: str | None) -> dict[str, Any]:
    """What the confirm card shows: project, type, summary, priority (brief §4.1 step 6), and for a
    fix what happened, plus what is still unknown so the person can add it (D63).

    Praise is thanks, not a request (D50): staff see "Praise" alone, with no work type or priority.
    """
    praise = draft.get("category") == "praise"
    brief = draft.get("brief") or {}
    happened = str(brief.get("actual") or brief.get("problem") or "") if draft.get("work_type") == "fix" else ""
    return {
        "project": project_name or "Not sure yet (the Digital team will check)",
        "work_type": "" if praise else WORK_TYPE_LABEL.get(draft.get("work_type", ""), ""),
        "category": CATEGORY_LABEL.get(draft.get("category", ""), ""),
        "priority": "" if praise else draft.get("priority", ""),
        "title": draft.get("title", ""),
        "summary": draft.get("summary", ""),
        "what_happened": happened,
        "gaps": [] if praise else list(brief.get("open_gaps") or []),
    }


# Impact answers that fit the situation (D62): a fault is about getting work done, an idea about time
# saved. "Annoying" stays off the chips (checklist S04.02, brief §5.1).
IMPACT_FAULT = [
    {"label": "Can't work at all", "value": "I can't work at all"},
    {"label": "Slower, but I get there", "value": "It slows me down, but I get there"},
    {"label": "Minor, I can live with it", "value": "It's minor, I can live with it"},
]
IMPACT_IDEA = [
    {"label": "Would save me time daily", "value": "It would save me time every day"},
    {"label": "Nice to have", "value": "It's a nice-to-have"},
]

# What Sig's next message does, signalled through update_draft's next_step (review item 20): the page
# shows the card and the chips for that step only, never because the draft happens to be complete.
# Chat with no step (a question about Sig, small talk) gets neither; a card already up stays while its
# draft is unchanged, until a step replaces it ("chat" when they don't want to send it after all).
NEXT_STEPS = ("ask_tool", "ask_details", "ask_impact", "ask_work_type", "check_send", "show_card", "chat")
# "Want me to send that to the team?" before the card for a question or praise (review item 18).
CHECK_SEND_CHIPS = [
    {"label": "Yes, send it", "value": "Yes, send it to the team"},
    {"label": "No thanks", "value": "No thanks"},
]


def impact_chips(draft: Draft) -> list[dict[str, str]]:
    idea = draft.get("work_type") in ("improvement", "new_feature") or draft.get("category") == "feature_request"
    return IMPACT_IDEA if idea else IMPACT_FAULT


REPLIES_MAX = 3
REPLY_CHARS = 40
PROMISE = re.compile(r"\b(we'll|we will|will be (fixed|sorted|done)|fixed by|guarantee\w*|promise\w*)\b", re.IGNORECASE)


def quick_replies(values: list[str] | None, names: list[str]) -> list[str]:
    """Answers the model suggests for its question (D62), kept only when short, in the person's
    voice, promising nothing and naming nobody on the team (D2)."""
    people = [re.compile(rf"\b{re.escape(n.lower())}\b") for name in names for n in {name, name.split()[0]} if n]
    kept: list[str] = []
    for value in values or []:
        text = " ".join(str(value).split())
        low = text.lower()
        if (
            not text
            or len(text) > REPLY_CHARS
            or text.endswith("?")
            or PROMISE.search(text)
            or any(p.search(low) for p in people)
            or low in (k.lower() for k in kept)
        ):
            continue
        kept.append(text)
    return kept[:REPLIES_MAX]


def first_sentence(text: str, limit: int = 120) -> str:
    """A summary from free text: its first sentence, cut at a word boundary."""
    first = re.split(r"(?<=[.!?])\s+|\n", text.strip(), maxsplit=1)[0].strip()
    if len(first) > limit:
        first = first[: limit - 3].rsplit(" ", 1)[0] + "..."
    return first[:1].upper() + first[1:] if first else "Feedback"
