"""one attempt per student: existing assignments that allowed retakes now allow one

Revision ID: 0008
Revises: 0007
"""

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Students who already took more attempts keep them; they just cannot start another.
    op.execute("UPDATE activity_assignments SET max_attempts = 1 WHERE max_attempts <> 1")


def downgrade() -> None:
    # The old per-assignment values are not kept; 1 is a valid setting for the old code too.
    pass
