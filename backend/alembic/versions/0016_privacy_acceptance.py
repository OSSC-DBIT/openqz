"""privacy policy agreement ticked at sign-in: users.privacy_accepted_at and privacy_version

Revision ID: 0016
Revises: 0015
"""

import sqlalchemy as sa
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("privacy_accepted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("privacy_version", sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "privacy_version")
    op.drop_column("users", "privacy_accepted_at")
