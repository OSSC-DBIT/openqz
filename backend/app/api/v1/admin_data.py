"""Admin: delete data for good (a person, an activity, one assignment's results).

Every delete here is permanent and takes student work with it, so each one needs, in the same
request, the admin's own password again (a stolen or unattended session is not enough) and the
name of the thing typed out (no accidental click). Wrong passwords are limited and audited;
every delete is audited with what it removed."""

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import AdminUser, SessionDep
from app.core.redis import get_redis
from app.core.security import verify_password
from app.models import (
    Activity,
    ActivityAssignment,
    Attempt,
    LiveGame,
    Role,
    User,
)
from app.services import audit
from app.services.auth_service import revoke_all_for_user

router = APIRouter(prefix="/admin/data", tags=["admin data"])

WRONG_PASSWORDS_ALLOWED = 5  # per admin, per 10 minutes
WINDOW_SECONDS = 600


class ConfirmIn(BaseModel):
    # The admin's own password, checked again for this one action.
    password: str = Field(min_length=1, max_length=200)
    # The name of what is being deleted, typed out.
    confirm: str = Field(min_length=1, max_length=200)


class Impact(BaseModel):
    """What goes away with a person."""

    username: str
    full_name: str
    role: Role
    # their own work as a student
    attempts: int
    # what they made, and other students' work on it
    activities: int
    assignments: int
    attempts_by_students: int
    live_games: int
    blocked_by: str | None = None


async def _step_up(session: AsyncSession, admin: User, password: str, what: str) -> None:
    """Check the admin's password again. Too many wrong ones lock deletes for a while."""
    r = get_redis()
    key = f"rl:stepup:{admin.id}"
    if int(await r.get(key) or 0) >= WRONG_PASSWORDS_ALLOWED:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "too_many_tries",
                "message": "Too many wrong passwords. Deleting is locked for 10 minutes.",
            },
        )
    if not verify_password(password, admin.password_hash):
        n = await r.incr(key)
        if n == 1:
            await r.expire(key, WINDOW_SECONDS)
        audit.record(session, "admin_delete_denied", actor_id=admin.id, target=what[:200])
        await session.commit()
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail={"code": "wrong_password", "message": "That is not your password"},
        )
    await r.delete(key)


def _typed(body: ConfirmIn, expected: str) -> None:
    if body.confirm.strip().casefold() != expected.strip().casefold():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail={"code": "confirm_mismatch", "message": f'Type "{expected}" to confirm'},
        )


async def _count(session: AsyncSession, stmt: Any) -> int:
    return (await session.scalar(stmt)) or 0


async def _impact(session: AsyncSession, admin: User, user: User) -> Impact:
    theirs = select(Activity.id).where(Activity.owner_id == user.id)
    their_assignments = select(ActivityAssignment.id).where(
        ActivityAssignment.activity_id.in_(theirs)
    )
    blocked = None
    if user.id == admin.id:
        blocked = "You cannot delete your own account"
    elif user.role == Role.admin and user.is_active:
        others = await _count(
            session,
            select(func.count()).where(
                User.role == Role.admin, User.is_active.is_(True), User.id != user.id
            ),
        )
        if others == 0:
            blocked = "This is the last admin account"
    return Impact(
        username=user.username,
        full_name=user.full_name,
        role=user.role,
        attempts=await _count(session, select(func.count()).where(Attempt.student_id == user.id)),
        activities=await _count(session, select(func.count()).where(Activity.owner_id == user.id)),
        assignments=await _count(
            session,
            select(func.count()).where(ActivityAssignment.activity_id.in_(theirs)),
        ),
        attempts_by_students=await _count(
            session, select(func.count()).where(Attempt.assignment_id.in_(their_assignments))
        ),
        live_games=await _count(session, select(func.count()).where(LiveGame.host_id == user.id)),
        blocked_by=blocked,
    )


async def _user(session: AsyncSession, user_id: uuid.UUID) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return user


@router.get("/users/{user_id}/impact", response_model=Impact)
async def user_impact(user_id: uuid.UUID, session: SessionDep, admin: AdminUser) -> Impact:
    """What deleting this person would remove. Shown before the admin confirms."""
    return await _impact(session, admin, await _user(session, user_id))


@router.post("/users/{user_id}/delete", status_code=204)
async def delete_user(
    user_id: uuid.UUID, body: ConfirmIn, session: SessionDep, admin: AdminUser
) -> Response:
    """Delete a person and everything that belongs to them: their attempts, and (for a teacher
    or organiser) the activities they made with all student work on them. To keep the work,
    disable the account instead."""
    user = await _user(session, user_id)
    impact = await _impact(session, admin, user)
    if impact.blocked_by:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, impact.blocked_by)
    _typed(body, user.username)
    await _step_up(session, admin, body.password, f"user {user.username}")
    await revoke_all_for_user(session, user.id)
    audit.record(
        session,
        "user_deleted",
        actor_id=admin.id,
        target=user.username,
        meta={
            "full_name": user.full_name,
            "role": user.role.value,
            **impact.model_dump(include={"attempts", "activities", "assignments", "live_games"}),
            "attempts_by_students": impact.attempts_by_students,
        },
    )
    await session.delete(user)
    await session.commit()
    return Response(status_code=204)


@router.post("/activities/{activity_id}/delete", status_code=204)
async def delete_activity(
    activity_id: uuid.UUID, body: ConfirmIn, session: SessionDep, admin: AdminUser
) -> Response:
    """Delete an activity for good, with every assignment, attempt and live game of it.
    (A teacher's own Delete only archives an activity that students have attempted.)"""
    act = await session.get(Activity, activity_id)
    if act is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activity not found")
    _typed(body, act.title)
    await _step_up(session, admin, body.password, f"activity {act.title}")
    assignments = select(ActivityAssignment.id).where(ActivityAssignment.activity_id == act.id)
    audit.record(
        session,
        "activity_deleted_forever",
        actor_id=admin.id,
        target=act.title[:200],
        meta={
            "activity_id": str(act.id),
            "owner_id": str(act.owner_id),
            "assignments": await _count(
                session, select(func.count()).select_from(assignments.subquery())
            ),
            "attempts": await _count(
                session, select(func.count()).where(Attempt.assignment_id.in_(assignments))
            ),
        },
    )
    await session.delete(act)
    await session.commit()
    return Response(status_code=204)


@router.post("/assignments/{assignment_id}/delete", status_code=204)
async def delete_assignment(
    assignment_id: uuid.UUID, body: ConfirmIn, session: SessionDep, admin: AdminUser
) -> Response:
    """Delete one assignment (or room) with all its attempts and marks. The activity stays."""
    a = await session.get(ActivityAssignment, assignment_id)
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assignment not found")
    title = a.activity.title
    _typed(body, title)
    await _step_up(session, admin, body.password, f"results of {title}")
    audit.record(
        session,
        "assignment_deleted_forever",
        actor_id=admin.id,
        target=title[:200],
        meta={
            "assignment_id": str(a.id),
            "activity_id": str(a.activity_id),
            "attempts": await _count(
                session, select(func.count()).where(Attempt.assignment_id == a.id)
            ),
        },
    )
    await session.delete(a)
    await session.commit()
    return Response(status_code=204)
