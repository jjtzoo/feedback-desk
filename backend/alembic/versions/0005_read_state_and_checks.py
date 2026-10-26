"""read state per person, updates that ask the reporter to check, and steps in the bell (D78, D80, D82)

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-27 12:00:00

- item_reads (new): when each Digital Staff member last opened an item, so replies and notes
  after that show as New in the panel and on the list and board. Filled from
  feedback.assignee_read_at for the item's current assignee, the only read time kept until now.
- feedback.assignee_read_at: dropped; item_reads replaces it. Downgrade puts it back, filled from
  the current assignee's item_reads row.
- feedback_messages.asks_check: an update or Resolve note that asks the person who raised it to
  try it. Existing Resolve notes (the progress message written just before the status event that
  resolved the item) are marked, because Resolved is the step that asks them to check. Other rows
  stay false.
- notifications.step: the stage in a word or two ("Approved", "Fixed") for the item's trail in
  the bell. Existing rows are filled from their type, and stage notifications from their title.
  Rows without an item (the approvals count, digests) stay empty.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "item_reads",
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("feedback_id", sa.UUID(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["feedback_id"], ["app.feedback.id"], name="fk_item_reads_feedback_id_feedback"),
        sa.PrimaryKeyConstraint("email", "feedback_id", name="pk_item_reads"),
        schema="app",
    )
    op.execute(
        """
        INSERT INTO app.item_reads (email, feedback_id, read_at)
        SELECT s.google_email, f.id, f.assignee_read_at
        FROM app.feedback f JOIN app.digital_staff s ON s.id = f.assignee_id
        WHERE f.assignee_read_at IS NOT NULL
        """
    )
    op.drop_column("feedback", "assignee_read_at", schema="app")

    op.add_column(
        "feedback_messages",
        sa.Column("asks_check", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        schema="app",
    )
    op.execute(
        """
        UPDATE app.feedback_messages m SET asks_check = true
        WHERE m.message_type = 'progress' AND EXISTS (
            SELECT 1 FROM app.feedback_events e
            WHERE e.feedback_id = m.feedback_id AND e.event_type = 'status'
                AND e.after ->> 'status' = 'resolved'
                AND e.created_at >= m.created_at AND e.created_at < m.created_at + interval '1 second'
        )
        """
    )

    op.add_column("notifications", sa.Column("step", sa.String(length=40), nullable=True), schema="app")
    op.execute(
        """
        UPDATE app.notifications SET step = CASE
            WHEN type = 'assigned' THEN 'Assigned'
            WHEN type = 'approval_p1' THEN 'Needs approval'
            WHEN type = 'flagged' THEN 'Flagged'
            WHEN type = 'approved' THEN 'Approved'
            WHEN type = 'ask_info' THEN 'Question'
            WHEN type = 'praise' THEN 'Thanks'
            WHEN type = 'plus_one' THEN 'Reported again'
            WHEN type = 'submitter_reply' THEN 'Reply'
            WHEN type = 'taken_over' THEN 'Taken over'
            WHEN type = 'handed_over' THEN 'Handed over'
            WHEN type = 'progress' THEN 'Update'
            WHEN type = 'reply' THEN 'Reply'
            WHEN type = 'mention' THEN 'Mention'
            WHEN type = 'stage' AND title LIKE '%is planned' THEN 'Planned'
            WHEN type = 'stage' AND title LIKE '%is being worked on' THEN 'In progress'
            WHEN type = 'stage' AND title LIKE '%is resolved' THEN 'Resolved'
            WHEN type = 'stage' AND title LIKE '%is fixed' THEN 'Fixed'
            WHEN type = 'stage' AND title LIKE '%won''t be fixed' THEN 'Won''t fix'
            WHEN type = 'stage' AND title LIKE '%is no longer needed' THEN 'No longer needed'
            WHEN type = 'stage' AND title LIKE '%is a duplicate of%' THEN 'Duplicate'
            WHEN type = 'stage' AND title LIKE '%was declined' THEN 'Declined'
        END
        WHERE feedback_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_column("notifications", "step", schema="app")
    op.drop_column("feedback_messages", "asks_check", schema="app")
    op.add_column(
        "feedback", sa.Column("assignee_read_at", sa.DateTime(timezone=True), nullable=True), schema="app"
    )
    op.execute(
        """
        UPDATE app.feedback f SET assignee_read_at = r.read_at
        FROM app.item_reads r JOIN app.digital_staff s ON s.google_email = r.email
        WHERE r.feedback_id = f.id AND s.id = f.assignee_id
        """
    )
    op.drop_table("item_reads", schema="app")
