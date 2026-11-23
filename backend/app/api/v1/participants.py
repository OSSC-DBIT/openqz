"""Participants tracker: everyone who attempted the activities of a teacher or club organiser,
across all of them, and each person's attempts. Admins see every activity.

The assignment report answers "how did this class do on this quiz"; this answers "what has
this student done with me so far"."""

import uuid
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import case, func, or_, select

from app.core.deps import CreatorUser, SessionDep
from app.models import (
    Activity,
    ActivityAssignment,
    ActivityKind,
    Attempt,
    AttemptStatus,
    Role,
    User,
)
from app.services import attempt_service as svc

router = APIRouter(prefix="/participants", tags=["participants"])

GRADED = (ActivityKind.quiz, ActivityKind.assignment)


def _pct(got: Decimal | None, out_of: Decimal | None) -> float | None:
    if got is None or not out_of:
        return None
    return round(float(got) / float(out_of) * 100, 1)


@router.get("")
async def participants(
    session: SessionDep,
    user: CreatorUser,
    q: Annotated[str | None, Query(max_length=80)] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> list[dict[str, Any]]:
    """One row per student who started any of my activities, most recent first."""
    submitted = Attempt.status == AttemptStatus.submitted
    counted = submitted & Activity.kind.in_(GRADED) & Attempt.score.is_not(None)
    last = func.max(func.coalesce(Attempt.submitted_at, Attempt.started_at))
    stmt = (
        select(
            User.id,
            User.username,
            User.full_name,
            func.count(Attempt.id),
            func.count(func.distinct(Activity.id)),
            func.sum(case((submitted, 1), else_=0)),
            func.sum(case((Attempt.status == AttemptStatus.in_progress, 1), else_=0)),
            func.sum(Attempt.violations),
            func.sum(case((counted, Attempt.score), else_=None)),
            func.sum(case((counted, Attempt.max_score), else_=None)),
            last,
        )
        .join(Attempt, Attempt.student_id == User.id)
        .join(ActivityAssignment, ActivityAssignment.id == Attempt.assignment_id)
        .join(Activity, Activity.id == ActivityAssignment.activity_id)
        .group_by(User.id, User.username, User.full_name)
        .order_by(last.desc())
        .limit(limit)
    )
    if user.role != Role.admin:
        stmt = stmt.where(Activity.owner_id == user.id)
    if q and q.strip():
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(func.lower(User.full_name).like(like), func.lower(User.username).like(like))
        )
    rows = (await session.execute(stmt)).all()
    return [
        {
            "student_id": sid,
            "usn": usn,
            "name": name,
            "attempts": int(n or 0),
            "activities": int(acts or 0),
            "submitted": int(done or 0),
            "in_progress": int(running or 0),
            "warnings": int(warnings or 0),
            "marks": got,
            "max_marks": out_of,
            "accuracy": _pct(got, out_of),
            "last_seen": seen,
        }
        for sid, usn, name, n, acts, done, running, warnings, got, out_of, seen in rows
    ]


@router.get("/{student_id}")
async def participant(
    student_id: uuid.UUID, session: SessionDep, user: CreatorUser
) -> dict[str, Any]:
    """Every attempt this student made on my activities, newest first."""
    student = await session.get(User, student_id)
    stmt = (
        select(Attempt)
        .join(ActivityAssignment, ActivityAssignment.id == Attempt.assignment_id)
        .join(Activity, Activity.id == ActivityAssignment.activity_id)
        .where(Attempt.student_id == student_id)
        .order_by(Attempt.started_at.desc())
        .limit(200)
    )
    if user.role != Role.admin:
        stmt = stmt.where(Activity.owner_id == user.id)
    attempts = list((await session.scalars(stmt)).unique())
    # Someone who never attempted my work is nobody to me: no names leak through this door.
    if student is None or not attempts:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No attempts by this student")
    items = []
    for att in attempts:
        a = att.assignment
        graded = svc.is_graded(a.activity.kind)
        items.append(
            {
                "attempt_id": att.id,
                "assignment_id": a.id,
                "title": a.activity.title,
                "kind": a.activity.kind,
                "is_room": a.join_code is not None,
                "status": att.status,
                "submit_reason": att.submit_reason,
                "started_at": att.started_at,
                "submitted_at": att.submitted_at,
                "marks": att.score if graded else None,
                "max_marks": att.max_score if graded else None,
                "pending_grading": att.needs_manual,
                "warnings": att.violations,
                "late": att.late,
                "can_unblock": svc.can_unblock(att),
            }
        )
    return {
        "student": {"id": student.id, "usn": student.username, "name": student.full_name},
        "attempts": items,
    }
