"""clear the bell, keep the history (D108)

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-30 14:00:00

- notifications.cleared_at: when the person cleared it from the bell. The bell leaves cleared rows
  out; the notifications page still lists them until the 90-day purge. Existing rows stay empty, so
  every bell shows what it showed before.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("notifications", sa.Column("cleared_at", sa.DateTime(timezone=True), nullable=True), schema="app")


def downgrade() -> None:
    op.drop_column("notifications", "cleared_at", schema="app")
