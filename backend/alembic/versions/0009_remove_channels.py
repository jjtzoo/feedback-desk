"""remove project channels (D40)

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-30 18:00:00

- release_items: items drafted from a channel message become manual items (source_type "manual",
  no source_id); their title, body and tick stay as the owner left them.
- notifications: "mention" notifications are deleted; they link to channel pages that no longer exist.
- project_messages: dropped, with its messages. Downgrade recreates it empty.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("UPDATE app.release_items SET source_type = 'manual', source_id = NULL WHERE source_type = 'channel'")
    op.execute("DELETE FROM app.notifications WHERE type = 'mention'")
    op.drop_index(op.f("ix_project_messages_project_id_created_at"), table_name="project_messages", schema="app")
    op.drop_table("project_messages", schema="app")


def downgrade() -> None:
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
        sa.ForeignKeyConstraint(["project_id"], ["app.projects.id"], name=op.f("fk_project_messages_project_id_projects")),
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
