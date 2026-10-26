"""named endings on feedback (D44)

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-26 09:00:00

Adds feedback.ending and fills it in for items that have already ended:
- status closed, last status change was from resolved -> fixed
- status closed, any other route -> no_longer_needed
- status declined with duplicate_of set -> duplicate (the "Merged into FB-x" reason is cleared;
  the link holds it)
- status declined with a "Won't fix: " reason -> wont_fix (the prefix is cleared; the ending says it)
- status declined otherwise -> declined
Open items and praise (acknowledged) keep no ending. The downgrade puts the cleared text back.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ENDINGS = "'fixed', 'wont_fix', 'duplicate', 'declined', 'no_longer_needed'"


def upgrade() -> None:
    op.add_column("feedback", sa.Column("ending", sa.String(length=20), nullable=True), schema="app")
    op.execute(
        """
        UPDATE app.feedback f SET ending = CASE
            WHEN (
                SELECT e.before ->> 'status' FROM app.feedback_events e
                WHERE e.feedback_id = f.id AND e.event_type = 'status' AND e.after ->> 'status' = 'closed'
                ORDER BY e.created_at DESC LIMIT 1
            ) = 'resolved' THEN 'fixed'
            ELSE 'no_longer_needed' END
        WHERE f.status = 'closed'
        """
    )
    op.execute(
        "UPDATE app.feedback SET ending = 'duplicate', close_reason = NULL"
        " WHERE status = 'declined' AND duplicate_of IS NOT NULL"
    )
    op.execute(
        """
        UPDATE app.feedback SET ending = 'wont_fix', close_reason = substr(close_reason, 12)
        WHERE status = 'declined' AND ending IS NULL AND close_reason LIKE 'Won''t fix: %'
        """
    )
    op.execute("UPDATE app.feedback SET ending = 'declined' WHERE status = 'declined' AND ending IS NULL")
    op.create_check_constraint(
        op.f("ck_feedback_ending"), "feedback", f"ending IS NULL OR ending IN ({ENDINGS})", schema="app"
    )
    op.create_check_constraint(
        op.f("ck_feedback_ended"), "feedback", "(ending IS NOT NULL) = (status IN ('closed', 'declined'))", schema="app"
    )


def downgrade() -> None:
    op.drop_constraint("ck_feedback_ended", "feedback", schema="app")
    op.drop_constraint("ck_feedback_ending", "feedback", schema="app")
    op.execute("UPDATE app.feedback SET close_reason = 'Won''t fix: ' || close_reason WHERE ending = 'wont_fix'")
    op.execute(
        """
        UPDATE app.feedback f SET close_reason = 'Merged into ' || t.ref_no
        FROM app.feedback t WHERE f.ending = 'duplicate' AND t.id = f.duplicate_of
        """
    )
    op.drop_column("feedback", "ending", schema="app")
