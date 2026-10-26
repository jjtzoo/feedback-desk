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


def missing(draft: Draft) -> list[str]:
    return [f for f in REQUIRED if not draft.get(f)]


def is_complete(draft: Draft) -> bool:
    return not missing(draft)


def draft_hash(draft: Draft) -> str:
    """Stable hash of the draft the confirm card shows. Confirm must send it back (D12)."""
    canonical = json.dumps(draft, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()


def card(draft: Draft, project_name: str | None) -> dict[str, Any]:
    """What the confirm card shows: project, type, summary, priority (brief §4.1 step 6).

    Praise is thanks, not a request (D50): staff see "Praise" alone, with no work type or priority.
    """
    praise = draft.get("category") == "praise"
    return {
        "project": project_name or "Not sure yet (the Digital team will check)",
        "work_type": "" if praise else WORK_TYPE_LABEL.get(draft.get("work_type", ""), ""),
        "category": CATEGORY_LABEL.get(draft.get("category", ""), ""),
        "priority": "" if praise else draft.get("priority", ""),
        "title": draft.get("title", ""),
        "summary": draft.get("summary", ""),
    }


def first_sentence(text: str, limit: int = 120) -> str:
    """A summary from free text: its first sentence, cut at a word boundary."""
    first = re.split(r"(?<=[.!?])\s+|\n", text.strip(), maxsplit=1)[0].strip()
    if len(first) > limit:
        first = first[: limit - 3].rsplit(" ", 1)[0] + "..."
    return first[:1].upper() + first[1:] if first else "Feedback"
