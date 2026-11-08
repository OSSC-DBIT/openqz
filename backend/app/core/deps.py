import uuid
from collections.abc import Callable, Coroutine
from typing import Annotated, Any

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.security import decode_access_token
from app.models import Role, User

_bearer = HTTPBearer(auto_error=False)

SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def get_current_user_allow_pending(
    session: SessionDep,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    """Authenticated user, even if they still must change their password."""
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    try:
        payload = decode_access_token(creds.credentials)
        user_id = uuid.UUID(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError) as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token") from exc
    user = await session.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account not available")
    return user


PendingUser = Annotated[User, Depends(get_current_user_allow_pending)]


async def get_current_user(user: PendingUser) -> User:
    if user.must_change_password:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail={"code": "password_change_required", "message": "Change your password first"},
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*roles: Role) -> Callable[..., Coroutine[Any, Any, User]]:
    async def _checker(user: CurrentUser) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed for your role")
        return user

    return _checker


AdminUser = Annotated[User, Depends(require_roles(Role.admin))]
StaffUser = Annotated[User, Depends(require_roles(Role.admin, Role.faculty))]
# Anyone who builds activities and hosts rooms: admins, faculty, club organisers.
CreatorUser = Annotated[User, Depends(require_roles(Role.admin, Role.faculty, Role.club))]


def client_ip(request: Request) -> str:
    """Real client address for rate limits and audit.

    Only X-Real-IP is trusted: our edge proxy overwrites it with the connecting address, so
    a client cannot choose it. X-Forwarded-For is ignored (its first entry is client-set).
    """
    real = request.headers.get("x-real-ip", "").strip()
    if real:
        return real[:64]
    return request.client.host if request.client else "unknown"
