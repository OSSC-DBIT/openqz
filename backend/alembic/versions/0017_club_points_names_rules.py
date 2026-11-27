"""club activities counted in points, names / team names in club rooms, live game instructions

Revision ID: 0017
Revises: 0016
"""

import sqlalchemy as sa
from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "activities",
        sa.Column("uses_points", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    # What club organisers made so far is counted in points from now on (same values).
    op.execute(
        "UPDATE activities SET uses_points = true "
        "WHERE owner_id IN (SELECT id FROM users WHERE role = 'club')"
    )
    # Live games keep the rules they were played with: only new club games use points.
    op.add_column(
        "live_games",
        sa.Column("uses_points", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("live_games", sa.Column("instructions", sa.Text(), nullable=True))
    op.add_column("assignment_targets", sa.Column("display_name", sa.String(40), nullable=True))


def downgrade() -> None:
    op.drop_column("assignment_targets", "display_name")
    op.drop_column("live_games", "instructions")
    op.drop_column("live_games", "uses_points")
    op.drop_column("activities", "uses_points")
