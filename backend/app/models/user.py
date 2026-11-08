import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import Timestamped, UUIDPk


class Role(enum.StrEnum):
    admin = "admin"
    faculty = "faculty"
    student = "student"
    # Club / event organiser: builds activities and hosts join-code rooms. No sections,
    # no access to academic data.
    club = "club"


class User(UUIDPk, Timestamped, Base):
    __tablename__ = "users"

    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(200))
    # Login identifier. Stored lower-case, unique. Nullable only for legacy rows: every
    # write path (API, importer, CLI) requires it.
    email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    # Google account subject id, linked on first Google sign-in.
    google_sub: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    role: Mapped[Role] = mapped_column(Enum(Role, name="user_role"), index=True)
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True
    )
    password_hash: Mapped[str] = mapped_column(String(255))
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    department = relationship("Department", lazy="joined")

    @property
    def google_linked(self) -> bool:
        return self.google_sub is not None


# Usernames are unique regardless of case (login is case-insensitive).
Index("uq_users_username_upper", func.upper(User.username), unique=True)
# Emails are the login id: unique regardless of case.
Index("uq_users_email_lower", func.lower(User.email), unique=True)


class RefreshToken(UUIDPk, Timestamped, Base):
    __tablename__ = "refresh_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    family_id: Mapped[uuid.UUID] = mapped_column(index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PasswordResetToken(UUIDPk, Timestamped, Base):
    """One-time token for "forgot password" emails. Only the SHA-256 hash is stored."""

    __tablename__ = "password_reset_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
