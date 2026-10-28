"""Request and response models. Every request and response is a Pydantic model."""

import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.config import get_settings

Status = Literal[
    "new",
    "needs_review",
    "awaiting_approval",
    "approved",
    "in_progress",
    "resolved",
    "acknowledged",
    "declined",
    "closed",
]
Ending = Literal["fixed", "wont_fix", "duplicate", "declined", "no_longer_needed"]
Priority = Literal["P1", "P2", "P3", "P4"]
WorkType = Literal["fix", "improvement", "new_feature", "no_change"]
Category = Literal[
    "bug", "performance", "data_issue", "usability", "feature_request", "access_request", "question", "praise"
]


class Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- people and projects ------------------------------------------------------------------


class MeOut(Out):
    email: str
    name: str
    role: Literal["staff", "digital", "admin"]
    is_triage_lead: bool
    dev_login: bool = False


class PersonOut(Out):
    id: uuid.UUID
    name: str


class ProjectOut(Out):
    slug: str
    name: str
    project_group: str


class ProjectAdminOut(ProjectOut):
    id: uuid.UUID
    description: str
    keywords: list[str]
    aliases: list[str]
    owner_id: uuid.UUID | None
    active: bool


class ProjectIn(BaseModel):
    slug: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,78}$")
    name: str = Field(min_length=1, max_length=200)
    project_group: Literal["platforms", "agents", "other"]
    description: str = ""
    keywords: list[str] = []
    aliases: list[str] = []
    owner_id: uuid.UUID | None = None
    active: bool = True


class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    project_group: Literal["platforms", "agents", "other"] | None = None
    description: str | None = None
    keywords: list[str] | None = None
    aliases: list[str] | None = None
    owner_id: uuid.UUID | None = None
    active: bool | None = None


class StaffOut(Out):
    id: uuid.UUID
    google_email: str
    name: str
    role: Literal["digital", "admin"]
    skills: list[str]
    is_away: bool
    is_triage_lead: bool
    active: bool
    open_items: int = 0


class StaffIn(BaseModel):
    google_email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    name: str = Field(min_length=1, max_length=200)
    role: Literal["digital", "admin"] = "digital"
    skills: list[str] = []
    is_away: bool = False
    is_triage_lead: bool = False


class StaffPatch(BaseModel):
    name: str | None = None
    role: Literal["digital", "admin"] | None = None
    skills: list[str] | None = None
    is_away: bool | None = None
    is_triage_lead: bool | None = None
    active: bool | None = None


class RuleOut(Out):
    id: uuid.UUID
    project_id: uuid.UUID | None
    category: str | None
    assignee_id: uuid.UUID
    priority_order: int
    active: bool


class RuleIn(BaseModel):
    project_id: uuid.UUID | None = None
    category: Category | None = None
    assignee_id: uuid.UUID
    priority_order: int = Field(default=100, ge=0, le=10000)
    active: bool = True


# --- chat ---------------------------------------------------------------------------------


class ClientContext(BaseModel):
    """Captured automatically by the page (brief §4.1.5); staff never type it."""

    browser: str = Field(default="", max_length=200)
    device: str = Field(default="", max_length=100)
    screen: str = Field(default="", max_length=40)
    source: str = Field(default="", max_length=500)
    time: str = Field(default="", max_length=60)


class UploadLimits(Out):
    """Upload limits, so a page can refuse a file before sending it (the API checks again)."""

    max_file_mb: int = Field(default_factory=lambda: get_settings().max_file_mb)
    max_files: int = Field(default_factory=lambda: get_settings().max_files_per_item)


class ChatStartIn(BaseModel):
    project_slug: str | None = None
    context: ClientContext = ClientContext()


class ChatStartOut(UploadLimits):
    mode: Literal["chat", "fallback"]
    # Set when a spend guard sent this chat to the backup form (D36).
    limit: Literal["user", "budget"] | None = None
    session_id: str | None = None
    greeting: str | None = None
    project: ProjectOut | None = None
    projects: list[ProjectOut] = []
    # Slugs of the person's usual tools, strongest first: the app cards show them first (D60, D99).
    usual: list[str] = []


class ChatTurnOut(Out):
    role: Literal["user", "agent"]
    text: str
    files: list[str] = []


class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    attachment_ids: list[uuid.UUID] = Field(default=[], max_length=5)


class ToolIn(BaseModel):
    """An app card picked at the start of a chat (D99)."""

    project_slug: str = Field(min_length=1, max_length=100)


class ConfirmIn(BaseModel):
    draft_hash: str = Field(min_length=64, max_length=64)


class PlusOneIn(BaseModel):
    reference: str = Field(pattern=r"^FB-\d{4,}$")
    comment: str = Field(default="", max_length=4000)


class AttachmentOut(Out):
    id: uuid.UUID
    file_name: str
    mime_type: str
    size_bytes: int
    created_at: datetime


class ChatResumeOut(ChatStartOut):
    """A chat picked up again after a refresh: what was said, and the card or matches still showing."""

    turns: list[ChatTurnOut] = []
    card: dict[str, Any] | None = None
    card_hash: str | None = None
    duplicates: list[dict[str, Any]] = []
    # The tool once known, so the app cards stay gone (D99), and the chat's files for thumbnails (D95).
    tool: str | None = None
    attachments: list[AttachmentOut] = []


class TrackerFileOut(AttachmentOut):
    # Added by the Digital team with a reply (D95), not part of what the person sent.
    from_team: bool = False


class FallbackIn(BaseModel):
    project_slug: str | None = None
    details: str = Field(min_length=1, max_length=4000)
    how_much: Literal["blocking", "annoying", "nice_to_have"] | None = None
    session_id: str | None = None
    context: ClientContext = ClientContext()


class SavedOut(Out):
    reference: str
    assigned_to: str
    status: Status


# --- staff side ---------------------------------------------------------------------------


class MyItemOut(Out):
    reference: str
    title: str
    project: str | None
    stage: str
    status: Status
    ending: Ending | None
    status_text: str
    updated_at: datetime
    created_at: datetime
    following: bool


class TimelineOut(Out):
    at: datetime
    text: str
    detail: str | None = None


class GeneralOut(Out):
    """Someone else's item as general information (D97): no names, transcript, replies, files or anything
    internal. updates are the public progress updates, newest first, with names hidden."""

    reference: str
    title: str
    summary: str
    project: str | None
    status_text: str
    stage: str
    stages: list[dict[str, Any]]
    expected_by: date | None
    updates: list[TimelineOut]
    merged_into: str | None
    following: bool
    muted: bool
    can_plus_one: bool


class TrackerOut(UploadLimits):
    reference: str
    title: str
    summary: str
    project: str | None
    category: str
    work_type: str
    priority: str | None
    status: Status
    ending: Ending | None
    status_text: str
    stage: str
    stages: list[dict[str, Any]]
    expected_by: date | None
    assignee: dict[str, str] | None
    latest_update: dict[str, Any] | None
    history: list[TimelineOut]
    close_reason: str | None
    merged_into: str | None
    attachments: list[TrackerFileOut]
    can_reply: bool
    muted: bool
    # An update that asked them to try an in-progress fix, not yet answered (D80).
    check: dict[str, Any] | None
    # For the person who raised it: Is it fixed? while Resolved (it closes by itself at closes_at), then
    # I still have an issue until reopen_until (D92). state is resolved or closed.
    is_it_fixed: dict[str, Any] | None


class ReplyIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class MuteIn(BaseModel):
    muted: bool


class CheckIn(BaseModel):
    fixed: bool
    comment: str = Field(default="", max_length=4000)


class StillAnIssueIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


# --- console ------------------------------------------------------------------------------


class CardOut(Out):
    id: uuid.UUID
    reference: str
    title: str
    summary: str
    project: ProjectOut | None
    work_type: WorkType | None
    category: Category | None
    priority: Priority | None
    status: Status
    ending: Ending | None
    stage: str
    submitter_name: str
    assignee: PersonOut | None
    created_at: datetime
    expected_by: date | None
    overdue: bool
    has_files: bool
    # A reply, note or update from someone else since this person last opened it (D82).
    unread: bool
    flagged: bool
    channel: str
    reporters: int
    priority_review: bool
    needs_detail: bool
    # Routing's reason while its choice still stands: the "Auto" marker and the "Auto-assigned" line (D56).
    routed: str | None


class ColumnOut(Out):
    key: str
    title: str
    count: int
    overdue: int
    items: list[CardOut]


class BoardOut(Out):
    columns: list[ColumnOut]
    view: Literal["board", "list", "cards"]


class CountsOut(Out):
    mine: int
    needs_review: int
    open: int
    overdue: int
    archive: int
    approvals: int


class ListOut(Out):
    items: list[CardOut]
    total: int
    page: int
    page_size: int
    view: Literal["board", "list", "cards"]


class MessageOut(Out):
    id: uuid.UUID
    author_type: str
    author_name: str | None
    message_type: str
    body: str
    is_internal: bool
    expected_by: date | None
    asks_check: bool
    created_at: datetime


class EventOut(Out):
    id: uuid.UUID
    actor_type: str
    actor_name: str | None
    event_type: str
    before: dict[str, Any]
    after: dict[str, Any]
    is_public: bool
    public_text: str | None
    created_at: datetime


class SimilarOut(Out):
    reference: str
    title: str
    status: str
    similarity: float


class ActivityOut(Out):
    text: str
    at: datetime


class DetailOut(CardOut, UploadLimits):
    submitter_email: str
    target_type: str | None
    area: str | None
    impact: str | None
    effort: str | None
    sentiment: str | None
    ai_recommendation: dict[str, Any]
    ai_confidence: dict[str, Any]
    dev_brief: dict[str, Any]
    context: dict[str, Any]
    close_reason: str | None
    merged_into: str | None
    approved_by: str | None
    approved_at: datetime | None
    messages: list[MessageOut]
    events: list[EventOut]
    attachments: list[AttachmentOut]
    followers: list[str]
    duplicates: list[SimilarOut]
    linked: list[str]
    # For the Take over dialog: whether the holder is away, and their latest step on the item (D53).
    assignee_away: bool
    holder_activity: ActivityOut | None
    # When this person last opened it before now; later messages show as New (D82).
    last_read_at: datetime | None


class TakeOverIn(BaseModel):
    # Who had it when the dialog opened: if that changed, nothing happens (D53).
    holder_id: uuid.UUID
    reason: str = Field(default="", max_length=500)


class HandOverIn(BaseModel):
    to: uuid.UUID
    reason: str = Field(default="", max_length=500)


class UpdateIn(BaseModel):
    body: str = Field(default="", max_length=4000)
    expected_by: date | None = None
    asks_check: bool = False
    # Moving the due date after approval: why, for the Digital team only (D94).
    due_reason: str = Field(default="", max_length=500)


class ApproveIn(BaseModel):
    """All optional, so Approve from the board or the row menu still works with no input (D93)."""

    instructions: str = Field(default="", max_length=4000)
    priority: str | None = None
    due_date: date | None = None


class NoteIn(BaseModel):
    body: str = Field(default="", max_length=4000)


class CloseIn(BaseModel):
    reason: str = Field(default="", max_length=1000)
    # None closes a resolved item as fixed and an open one as no longer needed (D45).
    ending: Literal["fixed", "wont_fix", "no_longer_needed"] | None = None


class FieldsIn(BaseModel):
    project_slug: str | None = None
    category: Category | None = None
    priority: Priority | None = None
    work_type: WorkType | None = None
    assignee_id: uuid.UUID | None = None


class MergeIn(BaseModel):
    into: str = Field(pattern=r"^FB-\d{4,}$")


class MoveIn(BaseModel):
    column: Literal["approved", "in_progress", "resolved"]
    note: str = Field(default="", max_length=1000)


class BulkIn(BaseModel):
    references: list[str] = Field(min_length=1, max_length=100)
    action: Literal["reassign", "close"]
    assignee_id: uuid.UUID | None = None
    reason: str = ""


class DeclineIn(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)


class AskInfoIn(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    ask: Literal["submitter", "owner"] = "submitter"


class ViewIn(BaseModel):
    view: Literal["board", "list", "cards"]


# --- notifications, channels, releases ---------------------------------------------------


class NotificationOut(Out):
    id: uuid.UUID
    type: str
    title: str
    body: str
    link: str
    read_at: datetime | None
    created_at: datetime
    # The item it is about and its step, so the bell shows one row per item with a trail (D78).
    feedback_id: uuid.UUID | None
    step: str | None
    # What happened once anyone acted on it, and the item's stage as it is now (D54).
    outcome: str | None
    item_status: Status | None = None
    item_stage: str | None = None  # the staff stage, for a staff member's bell
    item_ending: Ending | None = None
    reference: str | None = None


class NotificationsOut(Out):
    items: list[NotificationOut]
    unread: int


class ReadIn(BaseModel):
    ids: list[uuid.UUID] | None = None


class ChannelMessageOut(Out):
    id: uuid.UUID
    author_name: str
    author_email: str
    body: str
    mentions: list[str]
    feedback_refs: list[str]
    pinned: bool
    created_at: datetime


class ChannelOut(Out):
    project: ProjectOut
    messages: list[ChannelMessageOut]
    chips: dict[str, dict[str, str]]


class ChannelPostIn(BaseModel):
    body: str = Field(min_length=1, max_length=8000)


class PinIn(BaseModel):
    pinned: bool


class ReleaseItemOut(Out):
    id: uuid.UUID
    title: str
    body: str
    work_type: str | None
    source_type: str
    source_id: uuid.UUID | None
    visible_to_staff: bool
    yours: bool = False


class ReleaseOut(Out):
    id: uuid.UUID
    project: ProjectOut
    week_ending: date
    status: str
    published_at: datetime | None
    can_publish: bool = False
    items: list[ReleaseItemOut] = []


class ReleaseItemIn(BaseModel):
    id: str | None = None
    title: str = Field(min_length=1, max_length=200)
    body: str = ""
    work_type: WorkType | None = None
    visible_to_staff: bool = False


class ReleaseItemsIn(BaseModel):
    items: list[ReleaseItemIn]


class HealthOut(Out):
    status: Literal["ok", "degraded"]
    environment: str
    database: str
    migration: str | None
    model: dict[str, str | bool]


# --- model usage (D36) --------------------------------------------------------------------


class AllowanceOut(Out):
    used_tokens: int
    limit_tokens: int
    percent: int
    blocked: Literal["user", "budget"] | None


class UsageTotalsOut(BaseModel):
    calls: int
    tokens: int
    cost_aud: float


class UsageDayOut(UsageTotalsOut):
    day: date


class UsagePersonOut(BaseModel):
    email: str
    name: str
    tokens: int
    cost_aud: float
    limit_reached: bool


class UsageSummaryOut(BaseModel):
    today: UsageTotalsOut
    month: UsageTotalsOut
    daily_budget_aud: float
    monthly_budget_aud: float
    daily_tokens_per_user: int
    avg_cost_per_item_aud: float | None
    history: list[UsageDayOut]
    people: list[UsagePersonOut]
