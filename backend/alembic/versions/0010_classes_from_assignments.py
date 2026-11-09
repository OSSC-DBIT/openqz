"""activities record the classes they were assigned to

Before, picking classes in Assign did not add them to the activity, so the editor showed
"No class chosen" and the library's class filters missed it. Back-fill from past assignments.

Revision ID: 0010
Revises: 0009
"""

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO activity_sections (activity_id, section_id)
        SELECT DISTINCT aa.activity_id, t.section_id
        FROM assignment_targets t
        JOIN activity_assignments aa ON aa.id = t.assignment_id
        WHERE t.section_id IS NOT NULL
        ON CONFLICT DO NOTHING
        """
    )
    # branch = the one department of its classes, or none when they mix branches
    op.execute(
        """
        UPDATE activities a
        SET department_id = d.dept
        FROM (
            SELECT s.activity_id,
                   CASE WHEN COUNT(DISTINCT sec.department_id) = 1
                        THEN MIN(sec.department_id) END AS dept
            FROM activity_sections s
            JOIN sections sec ON sec.id = s.section_id
            GROUP BY s.activity_id
        ) d
        WHERE d.activity_id = a.id
        """
    )


def downgrade() -> None:
    # Data back-fill only; the rows are valid either way.
    pass
