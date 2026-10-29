"""images on internal notes (D107)

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-30 12:00:00

- attachments.is_internal: a file added with an internal note. Only the Digital team sees it; the
  tracker leaves it out and its link refuses everyone else. Existing rows stay false, so every file
  already on an item is shown exactly as before.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "attachments",
        sa.Column("is_internal", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        schema="app",
    )


def downgrade() -> None:
    op.drop_column("attachments", "is_internal", schema="app")
