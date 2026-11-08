"""rooms (join codes), club role, activities for many classes

Revision ID: 0006
Revises: 0005
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # New role. (Postgres cannot remove an enum value; downgrade leaves it in place.)
    op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'club'")

    # Activities may now target several classes.
    op.create_table(
        "activity_sections",
        sa.Column("activity_id", sa.Uuid(), nullable=False),
        sa.Column("section_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["activity_id"], ["activities.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["section_id"], ["sections.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("activity_id", "section_id"),
    )
    op.create_index("ix_activity_sections_section_id", "activity_sections", ["section_id"])
    # keep each existing activity's class
    op.execute(
        "INSERT INTO activity_sections (activity_id, section_id) "
        "SELECT id, section_id FROM activities WHERE section_id IS NOT NULL"
    )
    op.drop_index("ix_activities_section_id", table_name="activities")
    op.drop_constraint("activities_section_id_fkey", "activities", type_="foreignkey")
    op.drop_column("activities", "section_id")
    op.drop_column("activities", "semester")

    # Rooms
    op.add_column("activity_assignments", sa.Column("join_code", sa.String(length=8), nullable=True))
    op.add_column(
        "activity_assignments",
        sa.Column("accepting_joins", sa.Boolean(), server_default=sa.text("true"), nullable=False),
    )
    op.create_unique_constraint(
        "activity_assignments_join_code_key", "activity_assignments", ["join_code"]
    )


def downgrade() -> None:
    op.drop_constraint("activity_assignments_join_code_key", "activity_assignments", type_="unique")
    op.drop_column("activity_assignments", "accepting_joins")
    op.drop_column("activity_assignments", "join_code")

    op.add_column("activities", sa.Column("semester", sa.Integer(), nullable=True))
    op.add_column("activities", sa.Column("section_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "activities_section_id_fkey", "activities", "sections", ["section_id"], ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_activities_section_id", "activities", ["section_id"])
    # keep one class per activity (the lowest section id)
    op.execute(
        "UPDATE activities a SET section_id = s.section_id, semester = sec.semester "
        "FROM (SELECT activity_id, MIN(section_id) AS section_id FROM activity_sections "
        "GROUP BY activity_id) s JOIN sections sec ON sec.id = s.section_id "
        "WHERE a.id = s.activity_id"
    )
    op.drop_index("ix_activity_sections_section_id", table_name="activity_sections")
    op.drop_table("activity_sections")
