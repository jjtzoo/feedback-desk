"""SQLAlchemy models. Every table lives in schema `app` (spec v3, "Data model")."""

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    ARRAY,
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    Numeric,
    PrimaryKeyConstraint,
    Sequence,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.models.enums import (
    AUTHOR_TYPES,
    CATEGORIES,
    CHANNELS,
    CONSOLE_VIEWS,
    EFFORTS,
    ENDED_STATUSES,
    ENDINGS,
    IMPACTS,
    MESSAGE_TYPES,
    PRIORITIES,
    PROJECT_GROUPS,
    RELEASE_STATUSES,
    SENTIMENTS,
    STAFF_ROLES,
    STATUSES,
    TARGET_TYPES,
    USAGE_KINDS,
    WORK_TYPES,
    check_in,
)

SCHEMA = "app"
EMBEDDING_DIM = 768

metadata = MetaData(
    schema=SCHEMA,
    naming_convention={
        "ix": "ix_%(table_name)s_%(column_0_N_name)s",
        "uq": "uq_%(table_name)s_%(column_0_N_name)s",
        "ck": "ck_%(table_name)s_%(constraint_name)s",
        "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
        "pk": "pk_%(table_name)s",
    },
)

ref_seq = Sequence("feedback_ref_seq", metadata=metadata, start=1)


def _id() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def _now() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


_last_stamp = datetime.min.replace(tzinfo=UTC)


def stamp() -> datetime:
    """Now, but always after the last stamp this process gave. Windows' clock can return the same
    time for every row written together, and history must keep their order (D77)."""
    global _last_stamp
    now = datetime.now(UTC)
    _last_stamp = now if now > _last_stamp else _last_stamp + timedelta(microseconds=1)
    return _last_stamp


def _stamped() -> Mapped[datetime]:
    """Set in Python per row, so rows written in one transaction keep their order."""
    return mapped_column(DateTime(timezone=True), default=stamp, server_default=func.now(), nullable=False)


def _tags() -> Mapped[list[str]]:
    return mapped_column(ARRAY(Text), default=list, server_default="{}")


class Base(DeclarativeBase):
    metadata = metadata


class DigitalStaff(Base):
    """People who can be assigned. Anyone signing in who is not here is Staff."""

    __tablename__ = "digital_staff"
    __table_args__ = (
        CheckConstraint(check_in("role", STAFF_ROLES), name="role"),
        CheckConstraint("google_email = lower(google_email)", name="email_lower"),
    )

    id: Mapped[uuid.UUID] = _id()
    google_email: Mapped[str] = mapped_column(String(320), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(10), default="digital")
    skills: Mapped[list[str]] = _tags()
    is_away: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    is_triage_lead: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = _now()


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (CheckConstraint(check_in("project_group", PROJECT_GROUPS), name="project_group"),)

    id: Mapped[uuid.UUID] = _id()
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    project_group: Mapped[str] = mapped_column(String(20))
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    keywords: Mapped[list[str]] = _tags()
    aliases: Mapped[list[str]] = _tags()
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("digital_staff.id"))
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = _now()

    owner: Mapped[DigitalStaff | None] = relationship(lazy="raise")


class RoutingRule(Base):
    """Admin overrides, checked before owner routing. project_id null = any project."""

    __tablename__ = "routing_rules"
    __table_args__ = (CheckConstraint("category IS NULL OR " + check_in("category", CATEGORIES), name="category"),)

    id: Mapped[uuid.UUID] = _id()
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id"))
    category: Mapped[str | None] = mapped_column(String(30))
    assignee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("digital_staff.id"))
    priority_order: Mapped[int] = mapped_column(Integer, default=100)
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = _now()


class Feedback(Base):
    __tablename__ = "feedback"
    __table_args__ = (
        CheckConstraint(check_in("status", STATUSES), name="status"),
        CheckConstraint("work_type IS NULL OR " + check_in("work_type", WORK_TYPES), name="work_type"),
        CheckConstraint("category IS NULL OR " + check_in("category", CATEGORIES), name="category"),
        CheckConstraint("priority IS NULL OR " + check_in("priority", PRIORITIES), name="priority"),
        CheckConstraint("target_type IS NULL OR " + check_in("target_type", TARGET_TYPES), name="target_type"),
        CheckConstraint("impact IS NULL OR " + check_in("impact", IMPACTS), name="impact"),
        CheckConstraint("effort IS NULL OR " + check_in("effort", EFFORTS), name="effort"),
        CheckConstraint("sentiment IS NULL OR " + check_in("sentiment", SENTIMENTS), name="sentiment"),
        CheckConstraint(check_in("channel", CHANNELS), name="channel"),
        CheckConstraint("ending IS NULL OR " + check_in("ending", ENDINGS), name="ending"),
        CheckConstraint("(ending IS NOT NULL) = (" + check_in("status", ENDED_STATUSES) + ")", name="ended"),
        Index(None, "status", "created_at"),
        Index(None, "assignee_id", "status"),
        Index(None, "project_id", "status"),
        Index(None, "submitter_email"),
    )
    __mapper_args__ = {"eager_defaults": True}  # noqa: RUF012

    id: Mapped[uuid.UUID] = _id()
    ref_no: Mapped[str] = mapped_column(
        String(20),
        unique=True,
        server_default=text("('FB-' || lpad(nextval('app.feedback_ref_seq')::text, 4, '0'))"),
    )
    submitter_email: Mapped[str] = mapped_column(String(320))
    submitter_name: Mapped[str] = mapped_column(String(200))
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id"))
    target_type: Mapped[str | None] = mapped_column(String(20))
    area: Mapped[str | None] = mapped_column(String(200))
    work_type: Mapped[str | None] = mapped_column(String(20))
    category: Mapped[str | None] = mapped_column(String(30))
    priority: Mapped[str | None] = mapped_column(String(2))
    impact: Mapped[str | None] = mapped_column(String(20))
    effort: Mapped[str | None] = mapped_column(String(1))
    ai_recommendation: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    sentiment: Mapped[str | None] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(20), default="new")
    title: Mapped[str] = mapped_column(String(200))
    summary: Mapped[str] = mapped_column(Text)
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("digital_staff.id"))
    duplicate_of: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("feedback.id"))
    ai_confidence: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    dev_brief: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    context: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    channel: Mapped[str] = mapped_column(String(10), default="chat")
    flagged: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    expected_by: Mapped[date | None] = mapped_column(Date)
    ending: Mapped[str | None] = mapped_column(String(20))
    close_reason: Mapped[str | None] = mapped_column(Text)
    # Routing's reason while its choice of person and tool still stands; cleared once a person acts (D56).
    routed: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[datetime] = _now()
    updated_at: Mapped[datetime] = _now()
    first_response_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_by: Mapped[str | None] = mapped_column(String(320))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    assignee_opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submitter_replied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    project: Mapped[Project | None] = relationship(lazy="raise")
    assignee: Mapped[DigitalStaff | None] = relationship(foreign_keys=[assignee_id], lazy="raise")


class FeedbackFollower(Base):
    """Staff who added "+1 and comment" to an item; they get its notifications too."""

    __tablename__ = "feedback_followers"
    __table_args__ = (PrimaryKeyConstraint("feedback_id", "email"),)

    feedback_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("feedback.id"))
    email: Mapped[str] = mapped_column(String(320))
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = _now()


class FeedbackMessage(Base):
    __tablename__ = "feedback_messages"
    __table_args__ = (
        CheckConstraint(check_in("author_type", AUTHOR_TYPES), name="author_type"),
        CheckConstraint(check_in("message_type", MESSAGE_TYPES), name="message_type"),
        Index(None, "feedback_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = _id()
    feedback_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("feedback.id"))
    author_type: Mapped[str] = mapped_column(String(10))
    author_email: Mapped[str | None] = mapped_column(String(320))
    author_name: Mapped[str | None] = mapped_column(String(200))
    message_type: Mapped[str] = mapped_column(String(10))
    body: Mapped[str] = mapped_column(Text)
    is_internal: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    expected_by: Mapped[date | None] = mapped_column(Date)
    # An update or Resolve note that asks the person who raised it to try it (D80).
    asks_check: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    created_at: Mapped[datetime] = _stamped()


class ItemRead(Base):
    """When each Digital Staff member last opened an item, so what came after shows as New (D82)."""

    __tablename__ = "item_reads"
    __table_args__ = (PrimaryKeyConstraint("email", "feedback_id"),)

    email: Mapped[str] = mapped_column(String(320))
    feedback_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("feedback.id"))
    read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Attachment(Base):
    """A file uploaded in chat (session_id set, feedback_id set on submit) or on a reply."""

    __tablename__ = "attachments"

    id: Mapped[uuid.UUID] = _id()
    feedback_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("feedback.id"), index=True)
    session_id: Mapped[str | None] = mapped_column(String(100), index=True)
    uploaded_by: Mapped[str] = mapped_column(String(320))
    file_name: Mapped[str] = mapped_column(String(255))
    storage_path: Mapped[str] = mapped_column(String(500))
    mime_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    extracted_text: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(String(300))
    # Added with an internal note: the Digital team only, never on the tracker (D107).
    is_internal: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    created_at: Mapped[datetime] = _now()


class FeedbackEvent(Base):
    """Append-only audit and training signal. is_public decides what the tracker shows."""

    __tablename__ = "feedback_events"
    __table_args__ = (Index(None, "feedback_id", "created_at"),)

    id: Mapped[uuid.UUID] = _id()
    feedback_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("feedback.id"))
    actor_type: Mapped[str] = mapped_column(String(10))
    actor_email: Mapped[str | None] = mapped_column(String(320))
    actor_name: Mapped[str | None] = mapped_column(String(200))
    event_type: Mapped[str] = mapped_column(String(40))
    before: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    after: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    is_public: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    public_text: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _stamped()


class FeedbackEmbedding(Base):
    __tablename__ = "feedback_embeddings"

    feedback_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("feedback.id"), primary_key=True)
    embedding: Mapped[Any] = mapped_column(Vector(EMBEDDING_DIM))
    model: Mapped[str] = mapped_column(String(100))


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (Index(None, "recipient_email", "created_at"), Index(None, "email_status"))

    id: Mapped[uuid.UUID] = _id()
    recipient_email: Mapped[str] = mapped_column(String(320))
    feedback_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("feedback.id"))
    type: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text, default="", server_default="")
    link: Mapped[str] = mapped_column(String(500))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    email_status: Mapped[str] = mapped_column(String(10), default="queued", server_default="queued")
    email_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    email_after: Mapped[datetime] = _now()
    emailed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Set once anyone acts on what the notification asked for; outcome says what happened (D54).
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    outcome: Mapped[str | None] = mapped_column(String(300))
    # The stage in a word or two ("Approved", "Fixed"), for the item's trail in the bell (D78).
    step: Mapped[str | None] = mapped_column(String(40))
    # Cleared from the bell; the notifications page keeps it until the 90-day purge (D108).
    cleared_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _stamped()
    updated_at: Mapped[datetime] = _now()

    # Read with the notification, so the bell shows the item's stage as it is now (D54).
    feedback: Mapped[Feedback | None] = relationship(lazy="raise")


class NotificationMute(Base):
    __tablename__ = "notification_mutes"
    __table_args__ = (PrimaryKeyConstraint("recipient_email", "feedback_id"),)

    recipient_email: Mapped[str] = mapped_column(String(320))
    feedback_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("feedback.id"))
    created_at: Mapped[datetime] = _now()


class ProjectMessage(Base):
    __tablename__ = "project_messages"
    __table_args__ = (Index(None, "project_id", "created_at"),)

    id: Mapped[uuid.UUID] = _id()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    author_email: Mapped[str] = mapped_column(String(320))
    author_name: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    mentions: Mapped[list[str]] = _tags()
    feedback_refs: Mapped[list[str]] = _tags()
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    created_at: Mapped[datetime] = _now()


class Release(Base):
    __tablename__ = "releases"
    __table_args__ = (CheckConstraint(check_in("status", RELEASE_STATUSES), name="status"),)

    id: Mapped[uuid.UUID] = _id()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    week_ending: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(10), default="draft")
    approved_by: Mapped[str | None] = mapped_column(String(320))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _now()


class ReleaseItem(Base):
    __tablename__ = "release_items"
    __table_args__ = (CheckConstraint("work_type IS NULL OR " + check_in("work_type", WORK_TYPES), name="work_type"),)

    id: Mapped[uuid.UUID] = _id()
    release_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("releases.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="", server_default="")
    work_type: Mapped[str | None] = mapped_column(String(20))
    source_type: Mapped[str] = mapped_column(String(20))  # feedback | progress | channel | manual
    source_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    visible_to_staff: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class ReleaseItemThanks(Base):
    """A 👍 Thanks on a published Fixes and updates item: one per person, shown as a count only (D110)."""

    __tablename__ = "release_item_thanks"
    __table_args__ = (PrimaryKeyConstraint("release_item_id", "email"),)

    release_item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("release_items.id"))
    email: Mapped[str] = mapped_column(String(320))
    created_at: Mapped[datetime] = _now()


class UserSession(Base):
    """Sign-in session for anyone (Staff, Digital Staff, Admin). The cookie holds the id."""

    __tablename__ = "user_sessions"

    id: Mapped[uuid.UUID] = _id()
    email: Mapped[str] = mapped_column(String(320), index=True)
    name: Mapped[str] = mapped_column(String(200))
    hosted_domain: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = _now()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class UserPreference(Base):
    __tablename__ = "user_preferences"
    __table_args__ = (CheckConstraint(check_in("console_view", CONSOLE_VIEWS), name="console_view"),)

    email: Mapped[str] = mapped_column(String(320), primary_key=True)
    console_view: Mapped[str] = mapped_column(String(10), default="board")


class JobRun(Base):
    """Last run of scheduled jobs (daily digest, Friday drafter), so a job runs once per slot."""

    __tablename__ = "job_runs"

    name: Mapped[str] = mapped_column(String(50), primary_key=True)
    last_slot: Mapped[str] = mapped_column(String(40))
    ran_at: Mapped[datetime] = _now()


class ModelUsage(Base):
    """One row per model call (chat turn, embedding): tokens and estimated cost, for the daily
    limits and the console's AI usage panel. Holds no message text."""

    __tablename__ = "model_usage"
    __table_args__ = (
        CheckConstraint(check_in("kind", USAGE_KINDS), name="kind"),
        Index(None, "created_at"),
        Index(None, "user_email", "created_at"),
    )

    id: Mapped[uuid.UUID] = _id()
    user_email: Mapped[str | None] = mapped_column(String(320))
    session_id: Mapped[str | None] = mapped_column(String(128))
    kind: Mapped[str] = mapped_column(String(10))
    model: Mapped[str] = mapped_column(String(100))
    calls: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"))
    input_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    output_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    estimated: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    cost_aud: Mapped[float] = mapped_column(Numeric(10, 5), default=0, server_default=text("0"))
    created_at: Mapped[datetime] = _stamped()
