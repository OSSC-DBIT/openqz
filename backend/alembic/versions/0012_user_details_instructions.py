"""user details (phone, designation), several departments per user, assignment instructions,
"it has started" emails

Revision ID: 0012
Revises: 0011
"""

import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("phone", sa.String(20), nullable=True))
    op.add_column("users", sa.Column("designation", sa.String(120), nullable=True))
    op.create_table(
        "user_departments",
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE", name="fk_user_departments_user"),
            primary_key=True,
        ),
        sa.Column(
            "department_id",
            sa.Integer(),
            sa.ForeignKey(
                "departments.id", ondelete="CASCADE", name="fk_user_departments_department"
            ),
            primary_key=True,
        ),
    )
    op.create_index("ix_user_departments_department_id", "user_departments", ["department_id"])
    # Everyone keeps the department they already have.
    op.execute(
        "INSERT INTO user_departments (user_id, department_id) "
        "SELECT id, department_id FROM users WHERE department_id IS NOT NULL"
    )

    op.add_column("activity_assignments", sa.Column("instructions", sa.Text(), nullable=True))
    op.add_column(
        "activity_assignments",
        sa.Column("start_notified_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Existing assignments never get a late "it has started" email.
    op.execute("UPDATE activity_assignments SET start_notified_at = created_at")


def downgrade() -> None:
    op.drop_column("activity_assignments", "start_notified_at")
    op.drop_column("activity_assignments", "instructions")
    op.drop_index("ix_user_departments_department_id", table_name="user_departments")
    op.drop_table("user_departments")
    op.drop_column("users", "designation")
    op.drop_column("users", "phone")
