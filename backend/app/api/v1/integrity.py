"""Exam integrity events reported by the quiz player (tab switch, back, reload, ...)."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from sqlalchemy import select

from app.core.deps import CurrentUser, SessionDep, StaffUser
from app.core.redis import get_redis
from app.models import Activity, ActivityAssignment, Attempt, IntegrityEvent, Role, User
from app.schemas.integrity import IntegrityBatchIn, IntegrityEventOut

router = APIRouter(prefix="/integrity", tags=["integrity"])

EVENTS_PER_10_MIN = 600


@router.post("/events", status_code=204)
async def ingest(
    body: IntegrityBatchIn, request: Request, session: SessionDep, user: CurrentUser
) -> Response:
    redis = get_redis()
    key = f"rl:integrity:{user.id}:{int(datetime.now(UTC).timestamp() // 600)}"
    count = await redis.incrby(key, len(body.events))
    await redis.expire(key, 660)
    if count > EVENTS_PER_10_MIN:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many events")

    now = datetime.now(UTC)
    ua = (request.headers.get("user-agent") or "")[:400]
    for e in body.events:
        client_at = e.at if e.at.tzinfo else e.at.replace(tzinfo=UTC)
        # Clamp absurd client clocks so ordering stays sane.
        if abs(client_at - now) > timedelta(days=1):
            client_at = now
        session.add(
            IntegrityEvent(
                user_id=user.id,
                attempt_id=e.attempt_id,
                session_id=body.session_id,
                kind=e.kind,
                client_at=client_at,
                meta=e.meta,
                user_agent=ua,
            )
        )
    await session.commit()
    return Response(status_code=204)


@router.get("/events", response_model=list[IntegrityEventOut])
async def list_events(
    session: SessionDep,
    staff: StaffUser,
    user_id: uuid.UUID | None = None,
    attempt_id: uuid.UUID | None = None,
    kind: str | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> list[IntegrityEventOut]:
    """Admins see every event; a teacher only the events from attempts at their own activities."""
    stmt = select(IntegrityEvent, User).join(User, User.id == IntegrityEvent.user_id)
    if staff.role != Role.admin:
        stmt = stmt.where(
            IntegrityEvent.attempt_id.in_(
                select(Attempt.id)
                .join(ActivityAssignment, ActivityAssignment.id == Attempt.assignment_id)
                .join(Activity, Activity.id == ActivityAssignment.activity_id)
                .where(Activity.owner_id == staff.id)
            )
        )
    if user_id:
        stmt = stmt.where(IntegrityEvent.user_id == user_id)
    if attempt_id:
        stmt = stmt.where(IntegrityEvent.attempt_id == attempt_id)
    if kind:
        stmt = stmt.where(IntegrityEvent.kind == kind)
    rows = (await session.execute(stmt.order_by(IntegrityEvent.id.desc()).limit(limit))).all()
    return [
        IntegrityEventOut(
            id=ev.id,
            user_id=ev.user_id,
            username=u.username,
            full_name=u.full_name,
            session_id=ev.session_id,
            attempt_id=ev.attempt_id,
            kind=ev.kind,
            client_at=ev.client_at,
            received_at=ev.received_at,
            meta=ev.meta,
        )
        for ev, u in rows
    ]
