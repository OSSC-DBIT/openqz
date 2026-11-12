from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ActivityAssignment, Section, User
from app.schemas.activities import AssignmentOut
from app.services.attempt_service import count_submitted, target_student_ids


async def target_labels(session: AsyncSession, a: ActivityAssignment) -> list[str]:
    labels: list[str] = []
    sec_ids = [t.section_id for t in a.targets if t.section_id]
    if sec_ids:
        for s in (await session.scalars(select(Section).where(Section.id.in_(sec_ids)))).unique():
            dept = s.department.code if s.department else ""
            labels.append(f"{dept} Sem {s.semester} {s.name}")
    stu_ids = [t.student_id for t in a.targets if t.student_id]
    if stu_ids:
        for u in (await session.scalars(select(User).where(User.id.in_(stu_ids)))).unique():
            labels.append(f"{u.full_name} ({u.username})")
    if a.is_room:
        labels.insert(0, f"Room {a.join_code}")
    return labels


async def assignment_out(session: AsyncSession, a: ActivityAssignment) -> AssignmentOut:
    return AssignmentOut(
        id=a.id,
        activity_id=a.activity_id,
        activity_title=a.activity.title,
        activity_kind=a.activity.kind,
        start_at=a.start_at,
        due_at=a.due_at,
        allow_late=a.allow_late,
        max_attempts=a.max_attempts,
        shuffle_questions=a.shuffle_questions,
        shuffle_options=a.shuffle_options,
        instant_feedback=a.instant_feedback,
        show_answers=a.show_answers,
        release_mode=a.release_mode,
        released_at=a.released_at,
        time_limit_seconds=a.time_limit_seconds,
        max_violations=a.max_violations,
        require_fullscreen=a.require_fullscreen,
        notify=a.notify,
        instructions=a.instructions,
        is_room=a.is_room,
        join_code=a.join_code,
        accepting_joins=a.accepting_joins,
        host_name=(await session.get(User, a.activity.owner_id)).full_name  # type: ignore[union-attr]
        if a.activity.owner_id
        else None,
        section_ids=[t.section_id for t in a.targets if t.section_id],
        student_ids=[t.student_id for t in a.targets if t.student_id],
        target_labels=await target_labels(session, a),
        student_count=len(await target_student_ids(session, a)),
        submitted_count=await count_submitted(session, a.id),
        created_at=a.created_at,
    )
