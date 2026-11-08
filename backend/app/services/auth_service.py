import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from redis.asyncio import Redis
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import (
    create_access_token,
    hash_password,
    hash_token,
    needs_rehash,
    new_refresh_token,
    validate_password_strength,
    verify_password,
)
from app.models import PasswordResetToken, RefreshToken, User
from app.services import audit

# Dummy hash so a login for an unknown email costs the same time as a real one.
_DUMMY_HASH = hash_password("not-a-real-password-Aa1")


class AuthError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 401) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass
class IssuedTokens:
    access_token: str
    refresh_token: str
    user: User


async def check_rate_limit(redis: Redis, ip: str, scope: str = "login") -> None:
    s = get_settings()
    key = f"rl:{scope}:{ip}:{int(datetime.now(UTC).timestamp() // 60)}"
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, 70)
    if count > s.login_rate_per_minute:
        what = "sign-in attempts" if scope == "login" else "requests"
        raise AuthError("rate_limited", f"Too many {what}, try again in a minute", 429)


def normalize_email(email: str) -> str:
    return email.strip().lower()


async def find_by_email(session: AsyncSession, email: str) -> User | None:
    return await session.scalar(
        select(User).where(func.lower(User.email) == normalize_email(email))
    )


async def authenticate(session: AsyncSession, email: str, password: str, ip: str) -> User:
    s = get_settings()
    now = datetime.now(UTC)
    user = await find_by_email(session, email)

    if user is None:
        verify_password(password, _DUMMY_HASH)
        audit.record(session, "login_failed", target=normalize_email(email)[:64], meta={"ip": ip})
        await session.commit()
        raise AuthError("invalid_credentials", "Incorrect email or password")

    if not user.is_active:
        raise AuthError("inactive", "This account is disabled", 403)

    if user.locked_until and user.locked_until > now:
        minutes = max(1, int((user.locked_until - now).total_seconds() // 60) + 1)
        raise AuthError("locked", f"Account locked, try again in {minutes} min", 423)

    if not verify_password(password, user.password_hash):
        user.failed_logins += 1
        if user.failed_logins >= s.login_max_failures:
            user.locked_until = now + timedelta(minutes=s.login_lock_minutes)
            user.failed_logins = 0
            audit.record(session, "account_locked", actor_id=user.id, meta={"ip": ip})
        audit.record(session, "login_failed", actor_id=user.id, meta={"ip": ip})
        await session.commit()
        raise AuthError("invalid_credentials", "Incorrect email or password")

    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    user.failed_logins = 0
    user.locked_until = None
    user.last_login_at = now
    audit.record(session, "login", actor_id=user.id, meta={"ip": ip})
    return user


async def google_login(session: AsyncSession, claims: dict[str, object], ip: str) -> User:
    """Sign in an imported user whose email matches a verified Google identity."""
    s = get_settings()
    email = normalize_email(str(claims.get("email", "")))
    sub = str(claims.get("sub", ""))
    if not email or not sub or claims.get("email_verified") is not True:
        raise AuthError("google_unverified", "Your Google email is not verified", 403)
    domain = email.rsplit("@", 1)[-1]
    if s.google_allowed_domains and domain not in {d.lower() for d in s.google_allowed_domains}:
        raise AuthError(
            "google_domain", f"Sign in with your college Google account, not @{domain}", 403
        )

    user = await find_by_email(session, email)
    if user is None:
        audit.record(session, "google_login_unknown", target=email[:64], meta={"ip": ip})
        await session.commit()
        raise AuthError(
            "google_no_account",
            f"No OpenQZ account uses {email}. Ask your admin to add this email.",
            403,
        )
    if not user.is_active:
        raise AuthError("inactive", "This account is disabled", 403)
    if user.google_sub and user.google_sub != sub:
        # Same email, different Google account (e.g. recreated account): refuse.
        audit.record(session, "google_login_mismatch", actor_id=user.id, meta={"ip": ip})
        await session.commit()
        raise AuthError(
            "google_mismatch", "This Google account is not linked to your OpenQZ account", 403
        )

    now = datetime.now(UTC)
    if not user.google_sub:
        user.google_sub = sub
        audit.record(session, "google_linked", actor_id=user.id, meta={"ip": ip})
    if user.must_change_password:
        # Google proved who they are; the printed temporary password is no longer needed,
        # so cancel it rather than leave a valid password on a slip of paper.
        user.password_hash = unusable_password()
        user.must_change_password = False
        audit.record(session, "temp_password_cancelled", actor_id=user.id)
    user.failed_logins = 0
    user.locked_until = None
    user.last_login_at = now
    audit.record(session, "login_google", actor_id=user.id, meta={"ip": ip})
    return user


def unusable_password() -> str:
    """A hash that can never verify (argon2 rejects it as invalid)."""
    return "!" + new_refresh_token()


async def issue_tokens(
    session: AsyncSession, user: User, family_id: uuid.UUID | None = None
) -> IssuedTokens:
    s = get_settings()
    raw = new_refresh_token()
    session.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hash_token(raw),
            family_id=family_id or uuid.uuid4(),
            expires_at=datetime.now(UTC) + timedelta(days=s.refresh_token_ttl_days),
        )
    )
    await session.commit()
    access = create_access_token(user.id, user.role.value, user.must_change_password)
    return IssuedTokens(access_token=access, refresh_token=raw, user=user)


async def rotate_refresh(session: AsyncSession, raw: str) -> IssuedTokens:
    now = datetime.now(UTC)
    token = await session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw))
    )
    if token is None:
        raise AuthError("invalid_refresh", "Session expired, please log in again")

    if token.revoked_at is not None:
        # Reuse of a rotated token: assume theft, kill the whole family.
        await session.execute(
            update(RefreshToken)
            .where(RefreshToken.family_id == token.family_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=now)
        )
        audit.record(session, "refresh_reuse_detected", actor_id=token.user_id)
        await session.commit()
        raise AuthError("invalid_refresh", "Session expired, please log in again")

    if token.expires_at <= now:
        raise AuthError("invalid_refresh", "Session expired, please log in again")

    user = await session.get(User, token.user_id)
    if user is None or not user.is_active:
        raise AuthError("invalid_refresh", "Session expired, please log in again")

    token.revoked_at = now
    return await issue_tokens(session, user, family_id=token.family_id)


async def revoke_refresh(session: AsyncSession, raw: str) -> None:
    token = await session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw))
    )
    if token is not None:
        await session.execute(
            update(RefreshToken)
            .where(RefreshToken.family_id == token.family_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=datetime.now(UTC))
        )
        audit.record(session, "logout", actor_id=token.user_id)
        await session.commit()


async def revoke_all_for_user(session: AsyncSession, user_id: uuid.UUID) -> None:
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )


async def change_password(
    session: AsyncSession, user: User, current_password: str, new_password: str
) -> None:
    if not verify_password(current_password, user.password_hash):
        raise AuthError("invalid_credentials", "Current password is incorrect", 400)
    if current_password == new_password:
        raise AuthError("same_password", "New password must differ from the current one", 400)
    problem = validate_password_strength(new_password)
    if problem:
        raise AuthError("weak_password", problem, 400)
    user.password_hash = hash_password(new_password)
    user.must_change_password = False
    await revoke_all_for_user(session, user.id)
    audit.record(session, "password_changed", actor_id=user.id)


# ---------------------------------------------------------------- forgot / reset password

RESET_PER_EMAIL_PER_HOUR = 3


async def request_password_reset(
    session: AsyncSession, redis: Redis, email: str, ip: str
) -> tuple[User, str] | None:
    """Create a one-time reset token. Returns None (silently) for unknown or throttled emails,
    so the response never reveals whether an account exists."""
    s = get_settings()
    key = f"rl:reset:{normalize_email(email)}:{int(datetime.now(UTC).timestamp() // 3600)}"
    n = await redis.incr(key)
    if n == 1:
        await redis.expire(key, 3700)
    if n > RESET_PER_EMAIL_PER_HOUR:
        return None
    user = await find_by_email(session, email)
    if user is None or not user.is_active:
        audit.record(
            session, "password_reset_unknown", target=normalize_email(email)[:64], meta={"ip": ip}
        )
        await session.commit()
        return None
    raw = new_refresh_token()
    session.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=hash_token(raw),
            expires_at=datetime.now(UTC) + timedelta(minutes=s.password_reset_ttl_minutes),
        )
    )
    audit.record(session, "password_reset_requested", actor_id=user.id, meta={"ip": ip})
    await session.commit()
    return user, raw


async def reset_password_with_token(session: AsyncSession, raw: str, new_password: str) -> User:
    now = datetime.now(UTC)
    tok = await session.scalar(
        select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_token(raw))
    )
    if tok is None or tok.used_at is not None or tok.expires_at <= now:
        raise AuthError("reset_invalid", "This reset link is invalid or has expired", 400)
    problem = validate_password_strength(new_password)
    if problem:
        raise AuthError("weak_password", problem, 400)
    user = await session.get(User, tok.user_id)
    if user is None or not user.is_active:
        raise AuthError("reset_invalid", "This reset link is invalid or has expired", 400)
    user.password_hash = hash_password(new_password)
    user.must_change_password = False
    user.failed_logins = 0
    user.locked_until = None
    # One link, one use: burn every outstanding token of this user.
    await session.execute(
        update(PasswordResetToken)
        .where(PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None))
        .values(used_at=now)
    )
    await revoke_all_for_user(session, user.id)
    audit.record(session, "password_reset_done", actor_id=user.id)
    await session.commit()
    return user
