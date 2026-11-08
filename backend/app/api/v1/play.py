"""Student: my activities, attempt player (server timers, autosave), integrity, review."""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.core.deps import CurrentUser, SessionDep
from app.models import (
    Activity,
    ActivityAssignment,
    AssignmentTarget,
    Attempt,
    AttemptStatus,
    Role,
    SubmitReason,
    User,
)
from app.services import attempt_service as svc
from app.services.attempt_service import AttemptError

router = APIRouter(tags=["play"])


def http(exc: AttemptError) -> HTTPException:
    return HTTPException(exc.status_code, detail={"code": exc.code, "message": exc.message})


def _student(user: User) -> None:
    if user.role != Role.student:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only students attempt activities")


async def my_attempt(session: AsyncSession, attempt_id: uuid.UUID, user: User) -> Attempt:
    # Hot path (every answer save): skip the activity's live question list and the assignment
    # targets; the attempt carries its own frozen snapshot.
    att = await session.scalar(
        select(Attempt)
        .where(Attempt.id == attempt_id)
        .options(
            joinedload(Attempt.assignment)
            .joinedload(ActivityAssignment.activity)
            .raiseload(Activity.questions),
            joinedload(Attempt.assignment).raiseload(ActivityAssignment.targets),
            selectinload(Attempt.answers),
        )
    )
    if att is None or att.student_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attempt not found")
    return att


def attempt_state(att: Attempt) -> dict[str, Any]:
    a = att.assignment
    answered = {str(x.question_id) for x in att.answers if x.response}
    return {
        "attempt_id": att.id,
        "assignment_id": a.id,
        "activity_title": a.activity.title,
        "activity_kind": a.activity.kind,
        "status": att.status,
        "submit_reason": att.submit_reason,
        "total": len(att.snapshot),
        "current_index": att.current_index,
        "answered": [i for i, q in enumerate(att.snapshot) if q["id"] in answered],
        "linear": att.linear,
        "instant_feedback": a.instant_feedback,
        "started_at": att.started_at,
        "deadline_at": att.deadline_at,
        "server_now": svc.now(),
        "violations": att.violations,
        "max_violations": a.max_violations,
        "require_fullscreen": a.require_fullscreen,
        "attempt_no": att.attempt_no,
    }


@router.get("/me/activities")
async def my_activities(session: SessionDep, user: CurrentUser) -> dict[str, list[dict[str, Any]]]:
    _student(user)
    pending, completed = [], []
    for a in await svc.assignments_for_student(session, user):
        atts = [
            await svc.refresh_expired(session, x)
            for x in await svc.attempts_of(session, a.id, user.id)
        ]
        done = [x for x in atts if x.status == AttemptStatus.submitted]
        running = next((x for x in atts if x.status == AttemptStatus.in_progress), None)
        w = svc.window(a)
        # one attempt per student (the load-test seed alone uses 0 = unlimited)
        attempts_left = None if a.max_attempts == 0 else max(0, a.max_attempts - len(atts))
        best = max(done, key=lambda x: x.score or Decimal("-1")) if done else None
        item = {
            "assignment_id": a.id,
            "title": a.activity.title,
            "kind": a.activity.kind,
            "question_count": len(a.activity.questions),
            "start_at": a.start_at,
            "due_at": a.due_at,
            "allow_late": a.allow_late,
            "time_limit_seconds": a.time_limit_seconds or a.activity.time_limit_seconds,
            "attempts_used": len(atts),
            "attempts_left": attempts_left,
            "in_progress_attempt_id": running.id if running else None,
            "can_start": bool(running) or (w.open and attempts_left != 0),
            "window": w.reason or ("late" if w.late else "open"),
            "best_attempt_id": best.id if best else None,
            "score": best.score if best and svc.scores_visible(best) else None,
            "max_score": best.max_score if best else None,
            "pending_grading": bool(best and best.needs_manual),
            "submitted_at": best.submitted_at if best else None,
        }
        if done and not item["can_start"]:
            completed.append(item)
        elif not done and w.reason == "closed" and not running:
            completed.append({**item, "missed": True})
        else:
            pending.append(item)
    return {"pending": pending, "completed": completed}


@router.post("/me/assignments/{assignment_id}/start")
async def start(assignment_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> dict[str, Any]:
    _student(user)
    a = await session.get(ActivityAssignment, assignment_id)
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activity not found")
    try:
        att = await svc.start_or_resume(session, a, user)
    except AttemptError as exc:
        raise http(exc) from exc
    return attempt_state(att)


@router.get("/attempts/{attempt_id}")
async def state(attempt_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> dict[str, Any]:
    att = await my_attempt(session, attempt_id, user)
    await svc.expire_if_needed(session, att)
    return attempt_state(att)


@router.get("/attempts/{attempt_id}/questions/{index}")
async def question(
    attempt_id: uuid.UUID, index: int, session: SessionDep, user: CurrentUser
) -> dict[str, Any]:
    att = await my_attempt(session, attempt_id, user)
    try:
        return await svc.open_question(session, att, index)
    except AttemptError as exc:
        raise http(exc) from exc


class AnswerIn(BaseModel):
    response: dict[str, Any]
    final: bool = False  # True = "Submit answer" (instant feedback), False = autosave


@router.put("/attempts/{attempt_id}/answers/{question_id}")
async def answer(
    attempt_id: uuid.UUID, question_id: str, body: AnswerIn, session: SessionDep, user: CurrentUser
) -> dict[str, Any]:
    att = await my_attempt(session, attempt_id, user)
    try:
        return await svc.save_answer(session, att, question_id, body.response, body.final)
    except AttemptError as exc:
        raise http(exc) from exc


@router.post("/attempts/{attempt_id}/submit")
async def submit(attempt_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> dict[str, Any]:
    att = await my_attempt(session, attempt_id, user)
    if not await svc.expire_if_needed(session, att):
        await svc.finalize(session, att, SubmitReason.manual)
    return svc.review(att)


class ViolationIn(BaseModel):
    kind: str = Field(min_length=1, max_length=48, pattern=r"^[a-z0-9_]+$")
    session_id: str = Field(min_length=8, max_length=64)
    meta: dict[str, Any] | None = None


@router.post("/attempts/{attempt_id}/violations")
async def violation(
    attempt_id: uuid.UUID, body: ViolationIn, session: SessionDep, user: CurrentUser
) -> dict[str, Any]:
    att = await my_attempt(session, attempt_id, user)
    return await svc.record_violation(session, att, body.kind, body.meta, body.session_id)


@router.get("/attempts/{attempt_id}/review")
async def review(attempt_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> dict[str, Any]:
    att = await my_attempt(session, attempt_id, user)
    await svc.expire_if_needed(session, att)
    if att.status != AttemptStatus.submitted:
        raise HTTPException(status.HTTP_409_CONFLICT, "Submit the attempt first")
    return svc.review(att)


# ---------------------------------------------------------------- rooms (join codes)


class JoinIn(BaseModel):
    code: str = Field(min_length=6, max_length=8, pattern=r"^[0-9 ]+$")


async def _room(session: AsyncSession, code: str) -> ActivityAssignment:
    a = await session.scalar(
        select(ActivityAssignment).where(ActivityAssignment.join_code == code.replace(" ", ""))
    )
    if a is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail={"code": "bad_code", "message": "No activity with that code. Check the digits."},
        )
    return a


async def _join_rate_limit(user: User) -> None:
    from datetime import UTC, datetime

    from app.core.redis import get_redis

    r = get_redis()
    key = f"rl:join:{user.id}:{int(datetime.now(UTC).timestamp() // 60)}"
    n = await r.incr(key)
    if n == 1:
        await r.expire(key, 70)
    if n > 20:  # stops guessing codes
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Too many codes tried, wait a minute"
        )


@router.get("/join/{code}")
async def room_preview(code: str, session: SessionDep, user: CurrentUser) -> dict[str, Any]:
    _student(user)
    await _join_rate_limit(user)
    a = await _room(session, code)
    host = await session.get(User, a.activity.owner_id)
    w = svc.window(a)
    return {
        "assignment_id": a.id,
        "title": a.activity.title,
        "kind": a.activity.kind,
        "host": host.full_name if host else None,
        "question_count": len(a.activity.questions),
        "time_limit_seconds": a.time_limit_seconds or a.activity.time_limit_seconds,
        "due_at": a.due_at,
        "open": a.accepting_joins and w.open,
        "joined": await svc.is_target(session, a, user),
    }


@router.post("/join")
async def join(body: JoinIn, session: SessionDep, user: CurrentUser) -> dict[str, Any]:
    """Add the student to a room; they then start it like any other activity."""
    _student(user)
    await _join_rate_limit(user)
    a = await _room(session, body.code)
    if not await svc.is_target(session, a, user):
        if not a.accepting_joins:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail={"code": "room_closed", "message": "This room is not accepting new players"},
            )
        w = svc.window(a)
        if not w.open:
            msg = (
                "This activity has not started yet"
                if w.reason == "not_started"
                else "This activity has ended"
            )
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, detail={"code": w.reason, "message": msg}
            )
        a.targets.append(AssignmentTarget(student_id=user.id))
        await session.commit()
    return {"assignment_id": a.id, "title": a.activity.title}


class ServerTime(BaseModel):
    now: datetime


@router.get("/time", response_model=ServerTime)
async def server_time() -> ServerTime:
    """Lets the player correct for a wrong phone clock."""
    return ServerTime(now=svc.now())
