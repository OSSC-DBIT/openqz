"""super admins (the full admin) apart from admins (day-to-day), and a small store for
things fetched from outside (the contributor list)

Revision ID: 0013
Revises: 0012
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_superadmin", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # Every admin so far had every power: they stay that way. Admins added later are the
    # day-to-day kind unless a super admin says otherwise.
    op.execute("UPDATE users SET is_superadmin = true WHERE role = 'admin'")
    op.create_table(
        "site_cache",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value", postgresql.JSONB(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )


def downgrade() -> None:
    op.drop_table("site_cache")
    op.drop_column("users", "is_superadmin")
