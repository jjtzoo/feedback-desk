"""model usage ledger (D36)

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-21 09:00:00

A new table only; no existing rows are touched.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "model_usage",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_email", sa.String(length=320), nullable=True),
        sa.Column("session_id", sa.String(length=128), nullable=True),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("model", sa.String(length=100), nullable=False),
        sa.Column("calls", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("input_tokens", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("output_tokens", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("estimated", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("cost_aud", sa.Numeric(precision=10, scale=5), server_default=sa.text("0"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("kind IN ('chat', 'embedding')", name=op.f("ck_model_usage_kind")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_model_usage")),
        schema="app",
    )
    op.create_index(op.f("ix_model_usage_created_at"), "model_usage", ["created_at"], unique=False, schema="app")
    op.create_index(
        op.f("ix_model_usage_user_email_created_at"), "model_usage", ["user_email", "created_at"], unique=False, schema="app"
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_model_usage_user_email_created_at"), table_name="model_usage", schema="app")
    op.drop_index(op.f("ix_model_usage_created_at"), table_name="model_usage", schema="app")
    op.drop_table("model_usage", schema="app")
