"""a Thanks on Fixes and updates items (D110)

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-30 16:00:00

- release_item_thanks (new): one row per person who gave a published item a Thanks; the page
  shows the count only. No existing rows change.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "release_item_thanks",
        sa.Column("release_item_id", sa.UUID(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["release_item_id"], ["app.release_items.id"], name="fk_release_item_thanks_release_item_id_release_items"
        ),
        sa.PrimaryKeyConstraint("release_item_id", "email", name="pk_release_item_thanks"),
        schema="app",
    )


def downgrade() -> None:
    op.drop_table("release_item_thanks", schema="app")
