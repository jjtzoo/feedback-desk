"""Fixed values shared by the models, services, API and agent (spec v3, "Classification schema"
and "Feedback lifecycle")."""

PROJECT_GROUPS = ("platforms", "agents", "other")
STAFF_ROLES = ("digital", "admin")

TARGET_TYPES = ("platform", "agent", "intranet", "other")
WORK_TYPES = ("fix", "improvement", "new_feature", "no_change")
CATEGORIES = (
    "bug",
    "performance",
    "data_issue",
    "usability",
    "feature_request",
    "access_request",
    "question",
    "praise",
)
PRIORITIES = ("P1", "P2", "P3", "P4")
IMPACTS = ("one_person", "team", "company")
EFFORTS = ("S", "M", "L")
RECOMMENDATIONS = ("implement", "decline", "needs_info")
SENTIMENTS = ("positive", "neutral", "negative")

# Nine internal statuses (D4). Won't fix and merged are endings on "declined" (D21, D44).
STATUSES = (
    "new",
    "needs_review",
    "awaiting_approval",
    "approved",
    "in_progress",
    "resolved",
    "acknowledged",
    "declined",
    "closed",
)
OPEN_STATUSES = ("new", "needs_review", "awaiting_approval", "approved", "in_progress", "resolved")
CLOSED_STATUSES = ("acknowledged", "declined", "closed")
# How a closed or declined item ended (D44). Praise (acknowledged) has none.
ENDINGS = ("fixed", "wont_fix", "duplicate", "declined", "no_longer_needed")
ENDED_STATUSES = ("closed", "declined")

# Five tracker stages staff see, and the statuses behind each.
STAGES = ("received", "approved", "in_progress", "resolved", "closed")
STAGE_OF = {
    "new": "received",
    "needs_review": "received",
    "awaiting_approval": "received",
    "approved": "approved",
    "in_progress": "in_progress",
    "resolved": "resolved",
    "acknowledged": "closed",
    "declined": "closed",
    "closed": "closed",
}

CHANNELS = ("chat", "fallback")
AUTHOR_TYPES = ("staff", "digital", "agent", "system")
USAGE_KINDS = ("chat", "embedding")
MESSAGE_TYPES = ("chat", "reply", "note", "progress", "follow_up")
ACTOR_TYPES = ("system", "agent", "staff", "digital", "admin")
RELEASE_STATUSES = ("draft", "approved", "published")
CONSOLE_VIEWS = ("board", "list", "cards")

PRIORITY_RANK = {"P1": 0, "P2": 1, "P3": 2, "P4": 3}


def check_in(column: str, values: tuple[str, ...]) -> str:
    """SQL for a CHECK constraint limiting a text column to fixed values."""
    quoted = ", ".join("'" + v.replace("'", "''") + "'" for v in values)
    return f"{column} IN ({quoted})"
