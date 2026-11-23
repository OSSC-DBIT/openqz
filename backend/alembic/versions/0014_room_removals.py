"""a host can take a student out of a room (room_removals), and an attempt can end because
of it (submit_reason 'removed')

Revision ID: 0014
Revises: 0013
"""

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "room_removals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "assignment_id",
            sa.Uuid(),
            sa.ForeignKey("activity_assignments.id", ondelete="CASCADE", name="fk_room_removals_assignment"),
            nullable=False,
        ),
        sa.Column(
            "student_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE", name="fk_room_removals_student"),
            nullable=False,
        ),
        sa.Column(
            "removed_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_room_removals_removed_by"),
            nullable=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("assignment_id", "student_id", name="uq_room_removals_assignment_student"),
    )
    op.create_index("ix_room_removals_assignment_id", "room_removals", ["assignment_id"])
    # A new enum value cannot be added inside a transaction block on older Postgres versions.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE submit_reason ADD VALUE IF NOT EXISTS 'removed'")


def downgrade() -> None:
    op.drop_index("ix_room_removals_assignment_id", table_name="room_removals")
    op.drop_table("room_removals")
    # Postgres cannot drop one enum value: rebuild the type without it.
    op.execute("UPDATE attempts SET submit_reason = 'manual' WHERE submit_reason = 'removed'")
    op.execute("ALTER TYPE submit_reason RENAME TO submit_reason_old")
    op.execute("CREATE TYPE submit_reason AS ENUM ('manual', 'timer', 'deadline', 'violations')")
    op.execute(
        "ALTER TABLE attempts ALTER COLUMN submit_reason TYPE submit_reason "
        "USING submit_reason::text::submit_reason"
    )
    op.execute("DROP TYPE submit_reason_old")
