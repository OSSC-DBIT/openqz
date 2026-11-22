"""encrypt personal details: users.email and users.phone (AES-GCM, with keyed-hash lookup columns
email_hash and phone_hash) and the rows kept by import jobs

Uses DATA_KEY through app/core/crypto.py, the same code the application reads with.

Revision ID: 0015
Revises: 0014
"""

from typing import Any

import sqlalchemy as sa
from alembic import op

from app.core.crypto import PREFIX, decrypt, email_index, encrypt, phone_index

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None

BATCH = 500


def _enc(v: str | None) -> str | None:
    return None if v is None or v.startswith(PREFIX) else encrypt(v)


def _dec(v: str | None) -> str | None:
    return None if v is None else decrypt(v)


def upgrade() -> None:
    bind = op.get_bind()
    op.add_column("users", sa.Column("email_hash", sa.String(64), nullable=True))
    op.add_column("users", sa.Column("phone_hash", sa.String(64), nullable=True))
    op.drop_index("uq_users_email_lower", table_name="users")
    op.alter_column("users", "email", type_=sa.Text(), existing_nullable=True)
    op.alter_column("users", "phone", type_=sa.Text(), existing_nullable=True)

    users = sa.table(
        "users",
        sa.column("id", sa.Uuid()),
        sa.column("email", sa.Text()),
        sa.column("phone", sa.Text()),
        sa.column("email_hash", sa.String()),
        sa.column("phone_hash", sa.String()),
    )
    rows = bind.execute(sa.select(users.c.id, users.c.email, users.c.phone)).all()
    for i in range(0, len(rows), BATCH):
        for uid, email, phone in rows[i : i + BATCH]:
            plain_email = _dec(email)
            plain_phone = _dec(phone)
            bind.execute(
                users.update()
                .where(users.c.id == uid)
                .values(
                    email=_enc(plain_email.strip().lower() if plain_email else None),
                    phone=_enc(plain_phone),
                    email_hash=email_index(plain_email),
                    phone_hash=phone_index(plain_phone),
                )
            )
    op.create_index("uq_users_email_hash", "users", ["email_hash"], unique=True)
    op.create_index("ix_users_phone_hash", "users", ["phone_hash"])

    # import jobs: the sheet's rows, encrypted as a whole
    for col in ("preview_rows", "error_rows"):
        op.alter_column(
            "import_jobs", col, type_=sa.Text(), postgresql_using=f"{col}::text", existing_nullable=True
        )
    jobs = sa.table(
        "import_jobs",
        sa.column("id", sa.Uuid()),
        sa.column("preview_rows", sa.Text()),
        sa.column("error_rows", sa.Text()),
    )
    for jid, preview, errors in bind.execute(
        sa.select(jobs.c.id, jobs.c.preview_rows, jobs.c.error_rows)
    ).all():
        bind.execute(
            jobs.update()
            .where(jobs.c.id == jid)
            .values(preview_rows=_enc(preview), error_rows=_enc(errors))
        )


def downgrade() -> None:
    bind = op.get_bind()
    jobs = sa.table(
        "import_jobs",
        sa.column("id", sa.Uuid()),
        sa.column("preview_rows", sa.Text()),
        sa.column("error_rows", sa.Text()),
    )
    for jid, preview, errors in bind.execute(
        sa.select(jobs.c.id, jobs.c.preview_rows, jobs.c.error_rows)
    ).all():
        bind.execute(
            jobs.update()
            .where(jobs.c.id == jid)
            .values(preview_rows=_dec(preview), error_rows=_dec(errors))
        )
    for col in ("preview_rows", "error_rows"):
        op.alter_column(
            "import_jobs",
            col,
            type_=sa.dialects.postgresql.JSONB(),
            postgresql_using=f"{col}::jsonb",
            existing_nullable=True,
        )

    users = sa.table(
        "users",
        sa.column("id", sa.Uuid()),
        sa.column("email", sa.Text()),
        sa.column("phone", sa.Text()),
    )
    for uid, email, phone in bind.execute(sa.select(users.c.id, users.c.email, users.c.phone)).all():
        plain: dict[str, Any] = {"email": _dec(email), "phone": _dec(phone)}
        bind.execute(users.update().where(users.c.id == uid).values(**plain))
    op.drop_index("ix_users_phone_hash", table_name="users")
    op.drop_index("uq_users_email_hash", table_name="users")
    op.alter_column("users", "phone", type_=sa.String(20), existing_nullable=True)
    op.alter_column("users", "email", type_=sa.String(254), existing_nullable=True)
    op.drop_column("users", "phone_hash")
    op.drop_column("users", "email_hash")
    op.create_index("uq_users_email_lower", "users", [sa.text("lower(email)")], unique=True)
