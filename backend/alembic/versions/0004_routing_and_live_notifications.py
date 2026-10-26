"""routing shown until a person acts, and notifications that settle (D54, D56)

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-26 12:00:00

- feedback.routed: routing's reason ("project owner", "routing rule", "project unclear", ...)
  while routing's choice of person and tool still stands. Cleared once a person approves the item,
  changes hands or corrects the tool. Filled for items still waiting for a decision whose
  assignee and project nobody has changed, from the reason on the routing status event.
- notifications.updated_at: when the row last changed, so the bell's live stream sees a
  notification settle or the standing approvals count change. Filled from created_at.
- notifications.settled_at and outcome: an action-asking notification is settled once anyone
  acts ("FB-0003 approved by Chris"). Existing rows stay unsettled.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("feedback", sa.Column("routed", sa.String(length=40), nullable=True), schema="app")
    op.execute(
        """
        UPDATE app.feedback f SET routed = (
            SELECT e.after ->> 'reason' FROM app.feedback_events e
            WHERE e.feedback_id = f.id AND e.event_type = 'status' AND e.actor_type = 'system'
                AND e.before ->> 'status' = 'new'
            ORDER BY e.created_at LIMIT 1
        )
        WHERE f.status IN ('awaiting_approval', 'needs_review')
            AND NOT EXISTS (
                SELECT 1 FROM app.feedback_events h
                WHERE h.feedback_id = f.id AND h.actor_type IN ('digital', 'admin')
                    AND (h.event_type = 'assigned' OR (h.event_type = 'correction' AND h.before ? 'project'))
            )
        """
    )
    op.add_column(
        "notifications",
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        schema="app",
    )
    op.execute("UPDATE app.notifications SET updated_at = created_at")
    op.add_column("notifications", sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True), schema="app")
    op.add_column("notifications", sa.Column("outcome", sa.String(length=300), nullable=True), schema="app")


def downgrade() -> None:
    op.drop_column("notifications", "outcome", schema="app")
    op.drop_column("notifications", "settled_at", schema="app")
    op.drop_column("notifications", "updated_at", schema="app")
    op.drop_column("feedback", "routed", schema="app")
