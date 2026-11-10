import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import AdminUser, SessionDep
from app.core.security import generate_temp_password, hash_password
from app.models import AuditLog, Role, Section, StudentSection, User, UserDepartment
from app.schemas.users import (
    Page,
    PasswordResetOut,
    UserCreate,
    UserCreatedOut,
    UserOut,
    UserUpdate,
)
from app.services import audit, user_org
from app.services.auth_service import revoke_all_for_user

router = APIRouter(prefix="/users", tags=["users"])


def user_out(u: User, section: Section | None = None) -> UserOut:
    """`u` must have been loaded with its departments (selectinload(User.departments))."""
    return UserOut(
        id=u.id,
        username=u.username,
        full_name=u.full_name,
        email=u.email,
        phone=u.phone,
        designation=u.designation,
        role=u.role,
        department_id=u.department_id,
        # main department first
        department_ids=sorted(u.department_ids, key=lambda d: d != u.department_id),
        section_id=section.id if section else None,
        section_label=user_org.section_label(section) if section else None,
        is_active=u.is_active,
        must_change_password=u.must_change_password,
        google_linked=u.google_linked,
        locked_until=u.locked_until,
        last_login_at=u.last_login_at,
        created_at=u.created_at,
    )


async def _out(session: AsyncSession, user_id: uuid.UUID) -> UserOut:
    """Fresh copy of one user with departments and section."""
    u = await session.scalar(
        select(User)
        .where(User.id == user_id)
        .options(selectinload(User.departments))
        .execution_options(populate_existing=True)
    )
    assert u is not None
    section = (await user_org.current_sections(session, [u.id])).get(u.id)
    return user_out(u, section)


def _departments(department_id: int | None, department_ids: list[int] | None) -> list[int]:
    """One list from the two ways to send departments; `department_id` is the main one."""
    ids = list(department_ids or [])
    if department_id is not None:
        ids = [department_id, *[d for d in ids if d != department_id]]
    return ids


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
    stmt = select(User).options(selectinload(User.departments))
    if role:
        stmt = stmt.where(User.role == role)
    if department_id:
        stmt = stmt.where(
            User.id.in_(
                select(UserDepartment.user_id).where(UserDepartment.department_id == department_id)
            )
        )
    if section_id:
        stmt = stmt.join(StudentSection, StudentSection.student_id == User.id).where(
            StudentSection.section_id == section_id
        )
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                User.username.ilike(like),
                User.full_name.ilike(like),
                User.email.ilike(like),
                User.phone.ilike(like),
            )
        )
    total = await session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    users = list(
        (
            await session.scalars(
                stmt.order_by(User.role, User.username).offset((page - 1) * size).limit(size)
            )
        ).unique()
    )
    sections = await user_org.current_sections(
        session, [u.id for u in users if u.role == Role.student]
    )
    return Page(
        items=[user_out(u, sections.get(u.id)) for u in users], total=total, page=page, size=size
    )


@router.post("", response_model=UserCreatedOut, status_code=201)
async def create_user(body: UserCreate, session: SessionDep, admin: AdminUser) -> UserCreatedOut:
    temp = generate_temp_password()
    user = User(
        username=body.username.strip(),
        full_name=body.full_name.strip(),
        email=str(body.email).strip().lower(),
        role=body.role,
        phone=body.phone,
        designation=body.designation,
        password_hash=hash_password(temp),
        must_change_password=True,
    )
    session.add(user)
    audit.record(session, "user_created", actor_id=admin.id, target=user.username)
    try:
        await session.flush()
        section = await user_org.set_section(session, user, body.section_id)
        dept_ids = _departments(body.department_id, body.department_ids)
        if section is not None and not dept_ids:
            dept_ids = [section.department_id]  # a student's department is their section's
        await user_org.set_departments(session, user, dept_ids)
        await session.commit()
    except user_org.OrgError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A user with this USN/ID or email already exists"
        ) from exc
    return UserCreatedOut(user=await _out(session, user.id), temporary_password=temp)


async def _get(session: SessionDep, user_id: uuid.UUID) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return user


@router.get("/{user_id}", response_model=UserOut)
async def get_user(user_id: uuid.UUID, session: SessionDep, _: AdminUser) -> UserOut:
    return await _out(session, (await _get(session, user_id)).id)


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
    org: dict[str, Any] = {
        k: data.pop(k) for k in ("department_id", "department_ids", "section_id") if k in data
    }
    for key, value in data.items():
        setattr(user, key, value)
    if data.get("is_active") is False:
        await revoke_all_for_user(session, user.id)
    audit.record(
        session, "user_updated", actor_id=admin.id, target=user.username, meta={**data, **org}
    )
    try:
        if "section_id" in org:
            await user_org.set_section(session, user, org["section_id"])
        if "department_id" in org or "department_ids" in org:
            await user_org.set_departments(
                session, user, _departments(org.get("department_id"), org.get("department_ids"))
            )
        await session.commit()
    except user_org.OrgError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Another user already has this email"
        ) from exc
    return await _out(session, user.id)


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
    return await _out(session, user.id)


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
