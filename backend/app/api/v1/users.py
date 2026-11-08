import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError

from app.core.deps import AdminUser, SessionDep
from app.core.security import generate_temp_password, hash_password
from app.models import AuditLog, Role, StudentSection, User
from app.schemas.users import (
    Page,
    PasswordResetOut,
    UserCreate,
    UserCreatedOut,
    UserOut,
    UserUpdate,
)
from app.services import audit
from app.services.auth_service import revoke_all_for_user

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=Page[UserOut])
async def list_users(
    session: SessionDep,
    _: AdminUser,
    role: Role | None = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    department_id: int | None = None,
    section_id: int | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=200)] = 50,
) -> Page[UserOut]:
    stmt = select(User)
    if role:
        stmt = stmt.where(User.role == role)
    if department_id:
        stmt = stmt.where(User.department_id == department_id)
    if section_id:
        stmt = stmt.join(StudentSection, StudentSection.student_id == User.id).where(
            StudentSection.section_id == section_id
        )
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(User.username.ilike(like), User.full_name.ilike(like), User.email.ilike(like))
        )
    total = await session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = await session.scalars(
        stmt.order_by(User.role, User.username).offset((page - 1) * size).limit(size)
    )
    return Page(
        items=[UserOut.model_validate(u) for u in rows.unique()], total=total, page=page, size=size
    )


@router.post("", response_model=UserCreatedOut, status_code=201)
async def create_user(body: UserCreate, session: SessionDep, admin: AdminUser) -> UserCreatedOut:
    temp = generate_temp_password()
    user = User(
        username=body.username.strip(),
        full_name=body.full_name.strip(),
        email=str(body.email).strip().lower(),
        role=body.role,
        department_id=body.department_id,
        password_hash=hash_password(temp),
        must_change_password=True,
    )
    session.add(user)
    audit.record(session, "user_created", actor_id=admin.id, target=user.username)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A user with this USN/ID or email already exists"
        ) from exc
    await session.refresh(user)
    return UserCreatedOut(user=UserOut.model_validate(user), temporary_password=temp)


async def _get(session: SessionDep, user_id: uuid.UUID) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return user


@router.get("/{user_id}", response_model=UserOut)
async def get_user(user_id: uuid.UUID, session: SessionDep, _: AdminUser) -> UserOut:
    return UserOut.model_validate(await _get(session, user_id))


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: uuid.UUID, body: UserUpdate, session: SessionDep, admin: AdminUser
) -> UserOut:
    user = await _get(session, user_id)
    data = body.model_dump(exclude_unset=True)
    if user.id == admin.id and data.get("is_active") is False:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot deactivate yourself")
    if "email" in data:
        if not data["email"]:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Email is required (it is the login)")
        data["email"] = str(data["email"]).strip().lower()
        if data["email"] != (user.email or ""):
            # New email means a different Google account: drop the old link.
            user.google_sub = None
    for key, value in data.items():
        setattr(user, key, value)
    if data.get("is_active") is False:
        await revoke_all_for_user(session, user.id)
    audit.record(session, "user_updated", actor_id=admin.id, target=user.username, meta=data)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Another user already has this email"
        ) from exc
    await session.refresh(user)
    return UserOut.model_validate(user)


@router.post("/{user_id}/reset-password", response_model=PasswordResetOut)
async def reset_password(
    user_id: uuid.UUID, session: SessionDep, admin: AdminUser
) -> PasswordResetOut:
    user = await _get(session, user_id)
    temp = generate_temp_password()
    user.password_hash = hash_password(temp)
    user.must_change_password = True
    user.failed_logins = 0
    user.locked_until = None
    await revoke_all_for_user(session, user.id)
    audit.record(session, "password_reset", actor_id=admin.id, target=user.username)
    await session.commit()
    return PasswordResetOut(username=user.username, email=user.email, temporary_password=temp)


@router.post("/{user_id}/unlock", response_model=UserOut)
async def unlock(user_id: uuid.UUID, session: SessionDep, admin: AdminUser) -> UserOut:
    user = await _get(session, user_id)
    user.failed_logins = 0
    user.locked_until = None
    audit.record(session, "user_unlocked", actor_id=admin.id, target=user.username)
    await session.commit()
    await session.refresh(user)
    return UserOut.model_validate(user)


# ---------------------------------------------------------------- audit log

audit_router = APIRouter(prefix="/audit", tags=["audit"])


class AuditOut(BaseModel):
    id: int
    at: datetime
    action: str
    actor_id: uuid.UUID | None
    actor: str | None
    target: str | None
    meta: dict[str, Any] | None


@audit_router.get("", response_model=Page[AuditOut])
async def audit_log(
    session: SessionDep,
    _: AdminUser,
    action: Annotated[str | None, Query(max_length=64)] = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=200)] = 50,
) -> Page[AuditOut]:
    """Who did what: logins, lockouts, resets, imports, releases."""
    stmt = select(AuditLog, User).outerjoin(User, User.id == AuditLog.actor_id)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(User.username.ilike(like), User.email.ilike(like), AuditLog.target.ilike(like))
        )
    total = await session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await session.execute(
            stmt.order_by(AuditLog.id.desc()).offset((page - 1) * size).limit(size)
        )
    ).all()
    items = [
        AuditOut(
            id=a.id,
            at=a.at,
            action=a.action,
            actor_id=a.actor_id,
            actor=(f"{u.full_name} ({u.email or u.username})" if u else None),
            target=a.target,
            meta=a.meta,
        )
        for a, u in rows
    ]
    return Page(items=items, total=total, page=page, size=size)


@audit_router.get("/actions", response_model=list[str])
async def audit_actions(session: SessionDep, _: AdminUser) -> list[str]:
    rows = await session.scalars(select(AuditLog.action).distinct().order_by(AuditLog.action))
    return list(rows.all())
