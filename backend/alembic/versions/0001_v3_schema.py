"""v3 schema

Revision ID: 0001
Revises:
Create Date: 2026-10-20 07:23:03.330064
"""

from collections.abc import Sequence

import pgvector.sqlalchemy
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Schemas `app` and `adk` and the `vector` extension come from db/init/01-schemas.sql.
    op.execute("CREATE SEQUENCE app.feedback_ref_seq START 1")
    op.create_table(
        "digital_staff",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("google_email", sa.String(length=320), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("role", sa.String(length=10), nullable=False),
        sa.Column("skills", sa.ARRAY(sa.Text()), server_default="{}", nullable=False),
        sa.Column("is_away", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("is_triage_lead", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("role IN ('digital', 'admin')", name=op.f("ck_digital_staff_role")),
        sa.CheckConstraint("google_email = lower(google_email)", name=op.f("ck_digital_staff_email_lower")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_digital_staff")),
        sa.UniqueConstraint("google_email", name=op.f("uq_digital_staff_google_email")),
        schema="app",
    )
    op.create_table(
        "job_runs",
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("last_slot", sa.String(length=40), nullable=False),
        sa.Column("ran_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("name", name=op.f("pk_job_runs")),
        schema="app",
    )
    op.create_table(
        "user_preferences",
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("console_view", sa.String(length=10), nullable=False),
        sa.CheckConstraint("console_view IN ('board', 'list', 'cards')", name=op.f("ck_user_preferences_console_view")),
        sa.PrimaryKeyConstraint("email", name=op.f("pk_user_preferences")),
        schema="app",
    )
    op.create_table(
        "user_sessions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("hosted_domain", sa.String(length=200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_sessions")),
        schema="app",
    )
    op.create_index(op.f("ix_user_sessions_email"), "user_sessions", ["email"], unique=False, schema="app")
    op.create_table(
        "projects",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("project_group", sa.String(length=20), nullable=False),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column("keywords", sa.ARRAY(sa.Text()), server_default="{}", nullable=False),
        sa.Column("aliases", sa.ARRAY(sa.Text()), server_default="{}", nullable=False),
        sa.Column("owner_id", sa.UUID(), nullable=True),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("project_group IN ('platforms', 'agents', 'other')", name=op.f("ck_projects_project_group")),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["app.digital_staff.id"], name=op.f("fk_projects_owner_id_digital_staff")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_projects")),
        sa.UniqueConstraint("slug", name=op.f("uq_projects_slug")),
        schema="app",
    )
    op.create_table(
        "feedback",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column(
            "ref_no",
            sa.String(length=20),
            server_default=sa.text("('FB-' || lpad(nextval('app.feedback_ref_seq')::text, 4, '0'))"),
            nullable=False,
        ),
        sa.Column("submitter_email", sa.String(length=320), nullable=False),
        sa.Column("submitter_name", sa.String(length=200), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=True),
        sa.Column("target_type", sa.String(length=20), nullable=True),
        sa.Column("area", sa.String(length=200), nullable=True),
        sa.Column("work_type", sa.String(length=20), nullable=True),
        sa.Column("category", sa.String(length=30), nullable=True),
        sa.Column("priority", sa.String(length=2), nullable=True),
        sa.Column("impact", sa.String(length=20), nullable=True),
        sa.Column("effort", sa.String(length=1), nullable=True),
        sa.Column("ai_recommendation", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        sa.Column("sentiment", sa.String(length=10), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("assignee_id", sa.UUID(), nullable=True),
        sa.Column("duplicate_of", sa.UUID(), nullable=True),
        sa.Column("ai_confidence", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        sa.Column("dev_brief", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        sa.Column("context", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        sa.Column("channel", sa.String(length=10), nullable=False),
        sa.Column("flagged", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("expected_by", sa.Date(), nullable=True),
        sa.Column("close_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("first_response_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by", sa.String(length=320), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("assignee_opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submitter_replied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("assignee_read_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "category IS NULL OR category IN ('bug', 'performance', 'data_issue', 'usability', 'feature_request', 'access_request', 'question', 'praise')",
            name=op.f("ck_feedback_category"),
        ),
        sa.CheckConstraint("channel IN ('chat', 'fallback')", name=op.f("ck_feedback_channel")),
        sa.CheckConstraint("effort IS NULL OR effort IN ('S', 'M', 'L')", name=op.f("ck_feedback_effort")),
        sa.CheckConstraint(
            "impact IS NULL OR impact IN ('one_person', 'team', 'company')", name=op.f("ck_feedback_impact")
        ),
        sa.CheckConstraint(
            "priority IS NULL OR priority IN ('P1', 'P2', 'P3', 'P4')", name=op.f("ck_feedback_priority")
        ),
        sa.CheckConstraint(
            "sentiment IS NULL OR sentiment IN ('positive', 'neutral', 'negative')", name=op.f("ck_feedback_sentiment")
        ),
        sa.CheckConstraint(
            "status IN ('new', 'needs_review', 'awaiting_approval', 'approved', 'in_progress', 'resolved', 'acknowledged', 'declined', 'closed')",
            name=op.f("ck_feedback_status"),
        ),
        sa.CheckConstraint(
            "target_type IS NULL OR target_type IN ('platform', 'agent', 'intranet', 'other')",
            name=op.f("ck_feedback_target_type"),
        ),
        sa.CheckConstraint(
            "work_type IS NULL OR work_type IN ('fix', 'improvement', 'new_feature', 'no_change')",
            name=op.f("ck_feedback_work_type"),
        ),
        sa.ForeignKeyConstraint(
            ["assignee_id"], ["app.digital_staff.id"], name=op.f("fk_feedback_assignee_id_digital_staff")
        ),
        sa.ForeignKeyConstraint(["duplicate_of"], ["app.feedback.id"], name=op.f("fk_feedback_duplicate_of_feedback")),
        sa.ForeignKeyConstraint(["project_id"], ["app.projects.id"], name=op.f("fk_feedback_project_id_projects")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_feedback")),
        sa.UniqueConstraint("ref_no", name=op.f("uq_feedback_ref_no")),
        schema="app",
    )
    op.create_index(
        op.f("ix_feedback_assignee_id_status"), "feedback", ["assignee_id", "status"], unique=False, schema="app"
    )
    op.create_index(
        op.f("ix_feedback_project_id_status"), "feedback", ["project_id", "status"], unique=False, schema="app"
    )
    op.create_index(
        op.f("ix_feedback_status_created_at"), "feedback", ["status", "created_at"], unique=False, schema="app"
    )
    op.create_index(op.f("ix_feedback_submitter_email"), "feedback", ["submitter_email"], unique=False, schema="app")
    op.create_table(
        "project_messages",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("author_email", sa.String(length=320), nullable=False),
        sa.Column("author_name", sa.String(length=200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("mentions", sa.ARRAY(sa.Text()), server_default="{}", nullable=False),
        sa.Column("feedback_refs", sa.ARRAY(sa.Text()), server_default="{}", nullable=False),
        sa.Column("pinned", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id"], ["app.projects.id"], name=op.f("fk_project_messages_project_id_projects")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_project_messages")),
        schema="app",
    )
    op.create_index(
        op.f("ix_project_messages_project_id_created_at"),
        "project_messages",
        ["project_id", "created_at"],
        unique=False,
        schema="app",
    )
    op.create_table(
        "releases",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("week_ending", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("approved_by", sa.String(length=320), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("status IN ('draft', 'approved', 'published')", name=op.f("ck_releases_status")),
        sa.ForeignKeyConstraint(["project_id"], ["app.projects.id"], name=op.f("fk_releases_project_id_projects")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_releases")),
        schema="app",
    )
    op.create_table(
        "routing_rules",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=True),
        sa.Column("category", sa.String(length=30), nullable=True),
        sa.Column("assignee_id", sa.UUID(), nullable=False),
        sa.Column("priority_order", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "category IS NULL OR category IN ('bug', 'performance', 'data_issue', 'usability', 'feature_request', 'access_request', 'question', 'praise')",
            name=op.f("ck_routing_rules_category"),
        ),
        sa.ForeignKeyConstraint(
            ["assignee_id"], ["app.digital_staff.id"], name=op.f("fk_routing_rules_assignee_id_digital_staff")
        ),
        sa.ForeignKeyConstraint(["project_id"], ["app.projects.id"], name=op.f("fk_routing_rules_project_id_projects")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_routing_rules")),
        schema="app",
    )
    op.create_table(
        "attachments",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("feedback_id", sa.UUID(), nullable=True),
        sa.Column("session_id", sa.String(length=100), nullable=True),
        sa.Column("uploaded_by", sa.String(length=320), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("storage_path", sa.String(length=500), nullable=False),
        sa.Column("mime_type", sa.String(length=100), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("extracted_text", sa.Text(), nullable=True),
        sa.Column("description", sa.String(length=300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["feedback_id"], ["app.feedback.id"], name=op.f("fk_attachments_feedback_id_feedback")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_attachments")),
        schema="app",
    )
    op.create_index(op.f("ix_attachments_feedback_id"), "attachments", ["feedback_id"], unique=False, schema="app")
    op.create_index(op.f("ix_attachments_session_id"), "attachments", ["session_id"], unique=False, schema="app")
    op.create_table(
        "feedback_embeddings",
        sa.Column("feedback_id", sa.UUID(), nullable=False),
        sa.Column("embedding", pgvector.sqlalchemy.vector.VECTOR(dim=768), nullable=False),
        sa.Column("model", sa.String(length=100), nullable=False),
        sa.ForeignKeyConstraint(
            ["feedback_id"], ["app.feedback.id"], name=op.f("fk_feedback_embeddings_feedback_id_feedback")
        ),
        sa.PrimaryKeyConstraint("feedback_id", name=op.f("pk_feedback_embeddings")),
        schema="app",
    )
    op.create_table(
        "feedback_events",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("feedback_id", sa.UUID(), nullable=False),
        sa.Column("actor_type", sa.String(length=10), nullable=False),
        sa.Column("actor_email", sa.String(length=320), nullable=True),
        sa.Column("actor_name", sa.String(length=200), nullable=True),
        sa.Column("event_type", sa.String(length=40), nullable=False),
        sa.Column("before", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        sa.Column("after", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        sa.Column("is_public", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("public_text", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["feedback_id"], ["app.feedback.id"], name=op.f("fk_feedback_events_feedback_id_feedback")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_feedback_events")),
        schema="app",
    )
    op.create_index(
        op.f("ix_feedback_events_feedback_id_created_at"),
        "feedback_events",
        ["feedback_id", "created_at"],
        unique=False,
        schema="app",
    )
    op.create_table(
        "feedback_followers",
        sa.Column("feedback_id", sa.UUID(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["feedback_id"], ["app.feedback.id"], name=op.f("fk_feedback_followers_feedback_id_feedback")
        ),
        sa.PrimaryKeyConstraint("feedback_id", "email", name=op.f("pk_feedback_followers")),
        schema="app",
    )
    op.create_table(
        "feedback_messages",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("feedback_id", sa.UUID(), nullable=False),
        sa.Column("author_type", sa.String(length=10), nullable=False),
        sa.Column("author_email", sa.String(length=320), nullable=True),
        sa.Column("author_name", sa.String(length=200), nullable=True),
        sa.Column("message_type", sa.String(length=10), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("is_internal", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("expected_by", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "author_type IN ('staff', 'digital', 'agent', 'system')", name=op.f("ck_feedback_messages_author_type")
        ),
        sa.CheckConstraint(
            "message_type IN ('chat', 'reply', 'note', 'progress', 'follow_up')",
            name=op.f("ck_feedback_messages_message_type"),
        ),
        sa.ForeignKeyConstraint(
            ["feedback_id"], ["app.feedback.id"], name=op.f("fk_feedback_messages_feedback_id_feedback")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_feedback_messages")),
        schema="app",
    )
    op.create_index(
        op.f("ix_feedback_messages_feedback_id_created_at"),
        "feedback_messages",
        ["feedback_id", "created_at"],
        unique=False,
        schema="app",
    )
    op.create_table(
        "notification_mutes",
        sa.Column("recipient_email", sa.String(length=320), nullable=False),
        sa.Column("feedback_id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["feedback_id"], ["app.feedback.id"], name=op.f("fk_notification_mutes_feedback_id_feedback")
        ),
        sa.PrimaryKeyConstraint("recipient_email", "feedback_id", name=op.f("pk_notification_mutes")),
        schema="app",
    )
    op.create_table(
        "notifications",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("recipient_email", sa.String(length=320), nullable=False),
        sa.Column("feedback_id", sa.UUID(), nullable=True),
        sa.Column("type", sa.String(length=40), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("body", sa.Text(), server_default="", nullable=False),
        sa.Column("link", sa.String(length=500), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("email_status", sa.String(length=10), server_default="queued", nullable=False),
        sa.Column("email_attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("email_after", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("emailed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["feedback_id"], ["app.feedback.id"], name=op.f("fk_notifications_feedback_id_feedback")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notifications")),
        schema="app",
    )
    op.create_index(
        op.f("ix_notifications_email_status"), "notifications", ["email_status"], unique=False, schema="app"
    )
    op.create_index(
        op.f("ix_notifications_recipient_email_created_at"),
        "notifications",
        ["recipient_email", "created_at"],
        unique=False,
        schema="app",
    )
    op.create_table(
        "release_items",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("release_id", sa.UUID(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("body", sa.Text(), server_default="", nullable=False),
        sa.Column("work_type", sa.String(length=20), nullable=True),
        sa.Column("source_type", sa.String(length=20), nullable=False),
        sa.Column("source_id", sa.UUID(), nullable=True),
        sa.Column("visible_to_staff", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.CheckConstraint(
            "work_type IS NULL OR work_type IN ('fix', 'improvement', 'new_feature', 'no_change')",
            name=op.f("ck_release_items_work_type"),
        ),
        sa.ForeignKeyConstraint(["release_id"], ["app.releases.id"], name=op.f("fk_release_items_release_id_releases")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_release_items")),
        schema="app",
    )
    op.create_index(op.f("ix_release_items_release_id"), "release_items", ["release_id"], unique=False, schema="app")


def downgrade() -> None:
    op.drop_index(op.f("ix_release_items_release_id"), table_name="release_items", schema="app")
    op.drop_table("release_items", schema="app")
    op.drop_index(op.f("ix_notifications_recipient_email_created_at"), table_name="notifications", schema="app")
    op.drop_index(op.f("ix_notifications_email_status"), table_name="notifications", schema="app")
    op.drop_table("notifications", schema="app")
    op.drop_table("notification_mutes", schema="app")
    op.drop_index(op.f("ix_feedback_messages_feedback_id_created_at"), table_name="feedback_messages", schema="app")
    op.drop_table("feedback_messages", schema="app")
    op.drop_table("feedback_followers", schema="app")
    op.drop_index(op.f("ix_feedback_events_feedback_id_created_at"), table_name="feedback_events", schema="app")
    op.drop_table("feedback_events", schema="app")
    op.drop_table("feedback_embeddings", schema="app")
    op.drop_index(op.f("ix_attachments_session_id"), table_name="attachments", schema="app")
    op.drop_index(op.f("ix_attachments_feedback_id"), table_name="attachments", schema="app")
    op.drop_table("attachments", schema="app")
    op.drop_table("routing_rules", schema="app")
    op.drop_table("releases", schema="app")
    op.drop_index(op.f("ix_project_messages_project_id_created_at"), table_name="project_messages", schema="app")
    op.drop_table("project_messages", schema="app")
    op.drop_index(op.f("ix_feedback_submitter_email"), table_name="feedback", schema="app")
    op.drop_index(op.f("ix_feedback_status_created_at"), table_name="feedback", schema="app")
    op.drop_index(op.f("ix_feedback_project_id_status"), table_name="feedback", schema="app")
    op.drop_index(op.f("ix_feedback_assignee_id_status"), table_name="feedback", schema="app")
    op.drop_table("feedback", schema="app")
    op.drop_table("projects", schema="app")
    op.drop_index(op.f("ix_user_sessions_email"), table_name="user_sessions", schema="app")
    op.drop_table("user_sessions", schema="app")
    op.drop_table("user_preferences", schema="app")
    op.drop_table("job_runs", schema="app")
    op.drop_table("digital_staff", schema="app")
    op.execute("DROP SEQUENCE app.feedback_ref_seq")
