"""teachers can unblock attempts auto-submitted for violations

Revision ID: 0007
Revises: 0006
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "attempts",
        sa.Column("unblocked_count", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "attempt_answers",
        sa.Column("submit_locked", sa.Boolean(), server_default=sa.false(), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("attempt_answers", "submit_locked")
    op.drop_column("attempts", "unblocked_count")
