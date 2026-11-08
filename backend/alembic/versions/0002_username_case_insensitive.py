"""case-insensitive unique usernames

Revision ID: 0002
Revises: 0001
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE UNIQUE INDEX uq_users_username_upper ON users (upper(username))")


def downgrade() -> None:
    op.drop_index("uq_users_username_upper", table_name="users")
