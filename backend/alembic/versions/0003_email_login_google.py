"""email login and google sign-in

Revision ID: 0003
Revises: 0002
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Normalise existing emails; blank strings become NULL so the unique index holds.
    op.execute("UPDATE users SET email = NULLIF(lower(trim(email)), '')")
    op.create_index(
        "uq_users_email_lower", "users", [sa.text("lower(email)")], unique=True
    )
    op.add_column("users", sa.Column("google_sub", sa.String(length=64), nullable=True))
    op.create_unique_constraint("users_google_sub_key", "users", ["google_sub"])


def downgrade() -> None:
    op.drop_constraint("users_google_sub_key", "users", type_="unique")
    op.drop_column("users", "google_sub")
    op.drop_index("uq_users_email_lower", table_name="users")
