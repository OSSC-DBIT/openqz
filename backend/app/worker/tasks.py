import uuid
from typing import Any

from arq import cron
from arq.connections import RedisSettings
from sqlalchemy import select

from app.core.config import get_settings
from app.core.db import SessionLocal, engine
from app.models import Activity, ActivityAssignment, ActivityStatus, Attempt, User
from app.services import attempt_service, email, import_service


async def parse_import(ctx: dict[str, Any], job_id: str) -> str:
    async with SessionLocal() as session:
        job = await import_service.parse_job(session, uuid.UUID(job_id))
        return job.status.value


async def commit_import(ctx: dict[str, Any], job_id: str) -> str:
    async with SessionLocal() as session:
        job = await import_service.commit_job(session, uuid.UUID(job_id))
        return job.status.value


async def sweep_attempts(ctx: dict[str, Any]) -> int:
    """Auto-submit attempts whose server deadline passed while the student was away."""
    async with SessionLocal() as session:
        return await attempt_service.sweep_expired(session)


def _link(path: str) -> str:
    return get_settings().public_url.rstrip("/") + path


async def send_password_reset(ctx: dict[str, Any], user_id: str, raw_token: str) -> bool:
    async with SessionLocal() as session:
        user = await session.get(User, uuid.UUID(user_id))
        if user is None or not user.email:
            return False
        s = get_settings()
        return await email.send(
            email.password_reset(
                user.email,
                user.full_name,
                _link(f"/reset-password?token={raw_token}"),
                s.password_reset_ttl_minutes,
            )
        )


def _when(at: Any) -> str | None:
    return at.strftime("%d %b %Y, %I:%M %p UTC") if at else None


async def _students(session: Any, a: ActivityAssignment) -> list[User]:
    ids = await attempt_service.target_student_ids(session, a)
    rows = await session.scalars(select(User).where(User.id.in_(ids), User.is_active.is_(True)))
    return [u for u in rows.unique() if u.email]


async def notify_assigned(ctx: dict[str, Any], assignment_id: str) -> int:
    async with SessionLocal() as session:
        a = await session.get(ActivityAssignment, uuid.UUID(assignment_id))
        if a is None or not a.notify:
            return 0
        teacher = await session.get(User, a.activity.owner_id)
        scheduled = a.start_notified_at is None  # opens later: say when
        sent = 0
        for u in await _students(session, a):
            mail = email.assigned(
                u.email or "",
                u.full_name,
                a.activity.title,
                teacher.full_name if teacher else "Your teacher",
                _when(a.due_at),
                _link("/student"),
                opens=_when(a.start_at) if scheduled else None,
                instructions=a.instructions,
            )
            sent += int(await email.send(mail))
        return sent


async def notify_started(ctx: dict[str, Any]) -> int:
    """Every minute: email "it is open now" for scheduled assignments whose start time came.

    Each assignment is marked first and mailed after, so a slow mail server or a crash can
    never send the same email twice."""
    async with SessionLocal() as session:
        ids = list(
            (
                await session.scalars(
                    select(ActivityAssignment.id)
                    .join(Activity, Activity.id == ActivityAssignment.activity_id)
                    .where(
                        ActivityAssignment.start_notified_at.is_(None),
                        ActivityAssignment.start_at <= attempt_service.now(),
                        Activity.status != ActivityStatus.archived,
                    )
                    .with_for_update(of=ActivityAssignment, skip_locked=True)
                )
            ).all()
        )
        if not ids:
            return 0
        opened = list(
            (
                await session.scalars(
                    select(ActivityAssignment).where(ActivityAssignment.id.in_(ids))
                )
            ).unique()
        )
        for a in opened:
            a.start_notified_at = attempt_service.now()
        await session.commit()
        sent = 0
        for a in opened:
            if not a.notify:
                continue
            begun = set(
                (
                    await session.scalars(
                        select(Attempt.student_id).where(Attempt.assignment_id == a.id)
                    )
                ).all()
            )
            teacher = await session.get(User, a.activity.owner_id)
            for u in await _students(session, a):
                if u.id in begun:
                    continue
                mail = email.started(
                    u.email or "",
                    u.full_name,
                    a.activity.title,
                    teacher.full_name if teacher else "Your teacher",
                    _when(a.due_at),
                    _link("/student"),
                )
                sent += int(await email.send(mail))
        return sent


async def notify_released(ctx: dict[str, Any], assignment_id: str) -> int:
    async with SessionLocal() as session:
        a = await session.get(ActivityAssignment, uuid.UUID(assignment_id))
        if a is None or not a.notify:
            return 0
        sent = 0
        for u in await _students(session, a):
            mail = email.scores_released(
                u.email or "", u.full_name, a.activity.title, _link("/student")
            )
            sent += int(await email.send(mail))
        return sent


async def shutdown(ctx: dict[str, Any]) -> None:
    await engine.dispose()


class WorkerSettings:
    functions = [
        parse_import,
        commit_import,
        send_password_reset,
        notify_assigned,
        notify_released,
    ]
    cron_jobs = [
        cron(sweep_attempts, second=0, run_at_startup=True),
        cron(notify_started, second=20),
    ]
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    max_jobs = 4
    # A heartbeat in Redis every 30 s; `arq --check` (the container health check) reads it.
    health_check_interval = 30
    job_timeout = 900
