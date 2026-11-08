"""Faculty: activity library, editor (questions), publish, duplicate, assign."""

import uuid
from datetime import UTC, datetime
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import CreatorUser, SessionDep
from app.core.jobs import enqueue
from app.models import (
    Activity,
    ActivityAssignment,
    ActivityKind,
    ActivitySection,
    ActivityStatus,
    AssignmentTarget,
    Attempt,
    Department,
    FacultyAssignment,
    Media,
    Question,
    QuestionType,
    Role,
    Section,
    User,
)
from app.schemas.activities import (
    ActivityIn,
    ActivityOut,
    ActivitySummary,
    ActivityUpdate,
    AssignIn,
    AssignmentOut,
    BulkApplyIn,
    QuestionIn,
    QuestionOut,
    ReorderIn,
)
from app.services import audit
from app.services.assignment_view import assignment_out

router = APIRouter(tags=["activities"])

ALLOWED_TYPES = {
    ActivityKind.quiz: set(QuestionType),
    ActivityKind.assignment: set(QuestionType),
    ActivityKind.poll: {QuestionType.mcq, QuestionType.multi_select, QuestionType.open_ended},
    ActivityKind.flashcards: {QuestionType.open_ended},
}


async def get_owned(session: AsyncSession, activity_id: uuid.UUID, user: User) -> Activity:
    act = await session.get(Activity, activity_id)
    if act is None or (user.role != Role.admin and act.owner_id != user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activity not found")
    return act


async def has_attempts(session: AsyncSession, activity_id: uuid.UUID) -> bool:
    n = await session.scalar(
        select(func.count())
        .select_from(Attempt)
        .join(ActivityAssignment, ActivityAssignment.id == Attempt.assignment_id)
        .where(ActivityAssignment.activity_id == activity_id)
    )
    return bool(n)


async def class_labels(session: AsyncSession, act: Activity) -> tuple[list[str], list[int]]:
    ids = act.section_ids
    if not ids:
        return [], []
    secs = sorted(
        (await session.scalars(select(Section).where(Section.id.in_(ids)))).unique(),
        key=lambda x: (x.semester, x.name),
    )
    labels = [
        f"{x.department.code if x.department else ''} Sem {x.semester} {x.name}" for x in secs
    ]
    return labels, sorted({x.semester for x in secs})


async def summary(
    session: AsyncSession, act: Activity, assignment_count: int = 0
) -> ActivitySummary:
    labels, sems = await class_labels(session, act)
    return ActivitySummary(
        id=act.id,
        title=act.title,
        description=act.description,
        kind=act.kind,
        status=act.status,
        subject_id=act.subject_id,
        department_id=act.department_id,
        section_ids=act.section_ids,
        semesters=sems,
        class_labels=labels,
        time_limit_seconds=act.time_limit_seconds,
        question_count=len(act.questions),
        total_marks=sum((q.marks for q in act.questions), Decimal("0")),
        assignment_count=assignment_count,
        created_at=act.created_at,
        updated_at=act.updated_at,
    )


async def full(session: AsyncSession, act: Activity, assignment_count: int = 0) -> ActivityOut:
    return ActivityOut(
        **(await summary(session, act, assignment_count)).model_dump(),
        questions=[QuestionOut.model_validate(q) for q in act.questions],
    )


async def _assignment_count(session: AsyncSession, activity_id: uuid.UUID) -> int:
    return (
        await session.scalar(
            select(func.count()).where(ActivityAssignment.activity_id == activity_id)
        )
    ) or 0


# ---------------------------------------------------------------- library


async def resolve_classes(
    session: AsyncSession, user: User, section_ids: list[int]
) -> tuple[int | None, list[int]]:
    """Validate the chosen classes and work out the department (branch).

    Faculty: only sections they teach, in any branch they teach (e.g. a maths teacher
    with CSE and ECE sections). Club organisers: no sections. Admins: any sections.
    The activity's department is the branch of its sections, or None when they mix branches."""
    ids = sorted(set(section_ids))
    if user.role == Role.club:
        if ids:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Club activities are shared with a join code, not sections",
            )
        return user.department_id, []
    if not ids:
        return (user.department_id if user.role != Role.admin else None), []
    secs = list((await session.scalars(select(Section).where(Section.id.in_(ids)))).unique())
    if len(secs) != len(ids):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown section")
    if user.role == Role.faculty:
        taught = set(
            (
                await session.scalars(
                    select(FacultyAssignment.section_id).where(
                        FacultyAssignment.faculty_id == user.id,
                        FacultyAssignment.section_id.in_(ids),
                    )
                )
            ).all()
        )
        if taught != set(ids):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "You do not teach some of these sections"
            )
    depts = {x.department_id for x in secs}
    return (depts.pop() if len(depts) == 1 else None), ids


@router.get("/me/classes")
async def my_classes(session: SessionDep, user: CreatorUser) -> dict[str, object]:
    """Options for "which branch, semester and section": the classes this teacher teaches,
    in every branch where they teach (admins see every section)."""
    sections: list[tuple[Section, object]]
    if user.role == Role.admin:
        rows = (
            await session.scalars(select(Section).order_by(Section.semester, Section.name))
        ).unique()
        sections = [(s, None) for s in rows]
    elif user.role == Role.club:
        sections = []  # clubs share by join code only
    else:
        fas = (
            await session.scalars(
                select(FacultyAssignment).where(FacultyAssignment.faculty_id == user.id)
            )
        ).unique()
        sections = [(fa.section, fa.subject) for fa in fas]
    by_id: dict[int, dict[str, object]] = {}
    for sec, sub in sections:
        item = by_id.setdefault(
            sec.id,
            {
                "section_id": sec.id,
                "department_id": sec.department_id,
                "department_code": sec.department.code if sec.department else None,
                "semester": sec.semester,
                "section": sec.name,
                "academic_year": sec.academic_year,
                "label": f"{sec.department.code if sec.department else ''} Sem {sec.semester} {sec.name}",
                "subjects": [],
            },
        )
        if sub is not None:
            subjects = item["subjects"]
            assert isinstance(subjects, list)
            subjects.append({"id": sub.id, "code": sub.code, "name": sub.name})  # type: ignore[attr-defined]
    dept = await session.get(Department, user.department_id) if user.department_id else None
    branch_ids = {s.department_id for s, _ in sections}
    branches = (
        list(
            (
                await session.scalars(
                    select(Department)
                    .where(Department.id.in_(branch_ids))
                    .order_by(Department.code)
                )
            ).unique()
        )
        if branch_ids
        else []
    )
    return {
        "department": {"id": dept.id, "code": dept.code, "name": dept.name} if dept else None,
        "branches": [{"id": d.id, "code": d.code, "name": d.name} for d in branches],
        "department_locked": False,
        "can_use_sections": user.role != Role.club,
        "classes": sorted(by_id.values(), key=lambda c: (c["semester"], c["section"])),  # type: ignore[arg-type,return-value]
    }


@router.get("/activities", response_model=list[ActivitySummary])
async def library(
    session: SessionDep,
    user: CreatorUser,
    status_: ActivityStatus | None = None,
    semester: int | None = None,
    section_id: int | None = None,
    department_id: int | None = None,
) -> list[ActivitySummary]:
    stmt = select(Activity).order_by(Activity.updated_at.desc())
    if department_id:
        stmt = stmt.where(
            Activity.id.in_(
                select(ActivitySection.activity_id)
                .join(Section, Section.id == ActivitySection.section_id)
                .where(Section.department_id == department_id)
            )
        )
    if semester:
        stmt = stmt.where(
            Activity.id.in_(
                select(ActivitySection.activity_id)
                .join(Section, Section.id == ActivitySection.section_id)
                .where(Section.semester == semester)
            )
        )
    if section_id:
        stmt = stmt.where(
            Activity.id.in_(
                select(ActivitySection.activity_id).where(ActivitySection.section_id == section_id)
            )
        )
    if user.role != Role.admin:
        stmt = stmt.where(Activity.owner_id == user.id)
    if status_:
        stmt = stmt.where(Activity.status == status_)
    else:
        stmt = stmt.where(Activity.status != ActivityStatus.archived)
    acts = list((await session.scalars(stmt)).unique())
    counts = dict(
        (
            await session.execute(
                select(ActivityAssignment.activity_id, func.count())
                .where(ActivityAssignment.activity_id.in_([a.id for a in acts]))
                .group_by(ActivityAssignment.activity_id)
            )
        ).all()
    )
    return [await summary(session, a, counts.get(a.id, 0)) for a in acts]


@router.post("/activities", response_model=ActivityOut, status_code=201)
async def create(body: ActivityIn, session: SessionDep, user: CreatorUser) -> ActivityOut:
    dept_id, sec_ids = await resolve_classes(session, user, body.section_ids)
    act = Activity(
        owner_id=user.id,
        **body.model_dump(exclude={"section_ids"}),
        department_id=dept_id,
    )
    act.sections = [ActivitySection(section_id=x) for x in sec_ids]
    session.add(act)
    audit.record(session, "activity_created", actor_id=user.id, target=body.title[:200])
    await session.commit()
    await session.refresh(act)
    return await full(session, act)


@router.get("/activities/{activity_id}", response_model=ActivityOut)
async def get(activity_id: uuid.UUID, session: SessionDep, user: CreatorUser) -> ActivityOut:
    act = await get_owned(session, activity_id, user)
    return await full(session, act, await _assignment_count(session, act.id))


@router.patch("/activities/{activity_id}", response_model=ActivityOut)
async def update(
    activity_id: uuid.UUID, body: ActivityUpdate, session: SessionDep, user: CreatorUser
) -> ActivityOut:
    act = await get_owned(session, activity_id, user)
    data = body.model_dump(exclude_unset=True)
    if data.get("section_ids") is not None:
        dept_id, sec_ids = await resolve_classes(session, user, data.pop("section_ids"))
        act.department_id = dept_id
        act.sections = [ActivitySection(section_id=x) for x in sec_ids]
    data.pop("section_ids", None)
    for k, v in data.items():
        setattr(act, k, v)
    act.updated_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(act)
    return await full(session, act, await _assignment_count(session, act.id))


@router.delete("/activities/{activity_id}", status_code=204)
async def delete(activity_id: uuid.UUID, session: SessionDep, user: CreatorUser) -> Response:
    act = await get_owned(session, activity_id, user)
    if await has_attempts(session, act.id):
        # Keep student work: archive instead of deleting.
        act.status = ActivityStatus.archived
    else:
        await session.delete(act)
    audit.record(session, "activity_deleted", actor_id=user.id, target=str(activity_id))
    await session.commit()
    return Response(status_code=204)


@router.post("/activities/{activity_id}/publish", response_model=ActivityOut)
async def publish(activity_id: uuid.UUID, session: SessionDep, user: CreatorUser) -> ActivityOut:
    act = await get_owned(session, activity_id, user)
    if not act.questions:
        raise HTTPException(status.HTTP_409_CONFLICT, "Add at least one question before publishing")
    act.status = ActivityStatus.published
    act.published_at = datetime.now(UTC)
    await session.commit()
    return await full(session, act, await _assignment_count(session, act.id))


@router.post("/activities/{activity_id}/unpublish", response_model=ActivityOut)
async def unpublish(activity_id: uuid.UUID, session: SessionDep, user: CreatorUser) -> ActivityOut:
    act = await get_owned(session, activity_id, user)
    act.status = ActivityStatus.draft
    await session.commit()
    return await full(session, act, await _assignment_count(session, act.id))


@router.post("/activities/{activity_id}/duplicate", response_model=ActivityOut, status_code=201)
async def duplicate(activity_id: uuid.UUID, session: SessionDep, user: CreatorUser) -> ActivityOut:
    src = await get_owned(session, activity_id, user)
    copy = Activity(
        owner_id=user.id,
        title=f"{src.title} (copy)"[:200],
        description=src.description,
        kind=src.kind,
        subject_id=src.subject_id,
        department_id=src.department_id,
        time_limit_seconds=src.time_limit_seconds,
    )
    copy.sections = [ActivitySection(section_id=x) for x in src.section_ids]
    session.add(copy)
    await session.flush()
    for q in src.questions:
        session.add(
            Question(
                activity_id=copy.id,
                position=q.position,
                type=q.type,
                stem=q.stem,
                stem_image_id=q.stem_image_id,
                options=q.options,
                answer=q.answer,
                marks=q.marks,
                partial_credit=q.partial_credit,
                explanation=q.explanation,
                tags=list(q.tags or []),
                time_limit_seconds=q.time_limit_seconds,
                rubric=list(q.rubric or []),
            )
        )
    await session.commit()
    fresh = await session.get(Activity, copy.id, populate_existing=True)
    assert fresh is not None
    return await full(session, fresh, await _assignment_count(session, fresh.id))


# ---------------------------------------------------------------- questions


async def _check_images(session: AsyncSession, body: QuestionIn) -> None:
    ids = {body.stem_image_id, *[o.image_id for o in body.options]} - {None}
    if ids:
        found = set((await session.scalars(select(Media.id).where(Media.id.in_(ids)))).all())
        if found != ids:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown image")


def _validate_for_kind(act: Activity, body: QuestionIn) -> None:
    if body.type not in ALLOWED_TYPES[act.kind]:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"{body.type.value} questions are not used in a {act.kind.value}",
        )
    if act.kind in (ActivityKind.quiz, ActivityKind.assignment) and body.type in (
        QuestionType.mcq,
        QuestionType.justify,
    ):
        if sum(o.correct for o in body.options) != 1:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Mark exactly one correct option")
    if (
        act.kind in (ActivityKind.quiz, ActivityKind.assignment)
        and body.type == QuestionType.multi_select
    ):
        if not any(o.correct for o in body.options):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Mark at least one correct option")
    if act.kind == ActivityKind.poll:
        for o in body.options:
            o.correct = False  # polls have no right answer
    if act.kind == ActivityKind.flashcards and not (body.explanation or "").strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A flashcard needs a back side (answer)")


def _apply(q: Question, body: QuestionIn) -> None:
    q.type = body.type
    q.stem = body.stem
    q.stem_image_id = body.stem_image_id
    q.options = [o.model_dump(mode="json") for o in body.options]
    q.answer = body.answer
    q.marks = body.marks
    q.partial_credit = body.partial_credit
    q.explanation = body.explanation
    q.tags = body.tags
    q.time_limit_seconds = body.time_limit_seconds
    q.rubric = [r.model_dump(mode="json") for r in body.rubric]


@router.post("/activities/{activity_id}/questions", response_model=QuestionOut, status_code=201)
async def add_question(
    activity_id: uuid.UUID, body: QuestionIn, session: SessionDep, user: CreatorUser
) -> QuestionOut:
    act = await get_owned(session, activity_id, user)
    _validate_for_kind(act, body)
    await _check_images(session, body)
    q = Question(activity_id=act.id, position=len(act.questions))
    _apply(q, body)
    session.add(q)
    act.updated_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(q)
    return QuestionOut.model_validate(q)


async def _question(session: AsyncSession, act: Activity, question_id: uuid.UUID) -> Question:
    q = next((x for x in act.questions if x.id == question_id), None)
    if q is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
    return q


@router.put("/activities/{activity_id}/questions/{question_id}", response_model=QuestionOut)
async def update_question(
    activity_id: uuid.UUID,
    question_id: uuid.UUID,
    body: QuestionIn,
    session: SessionDep,
    user: CreatorUser,
) -> QuestionOut:
    act = await get_owned(session, activity_id, user)
    q = await _question(session, act, question_id)
    _validate_for_kind(act, body)
    await _check_images(session, body)
    _apply(q, body)
    act.updated_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(q)
    return QuestionOut.model_validate(q)


@router.delete("/activities/{activity_id}/questions/{question_id}", status_code=204)
async def delete_question(
    activity_id: uuid.UUID, question_id: uuid.UUID, session: SessionDep, user: CreatorUser
) -> Response:
    act = await get_owned(session, activity_id, user)
    q = await _question(session, act, question_id)
    act.questions.remove(q)
    for i, other in enumerate(act.questions):
        other.position = i
    act.updated_at = datetime.now(UTC)
    await session.commit()
    return Response(status_code=204)


@router.put("/activities/{activity_id}/order", response_model=ActivityOut)
async def reorder(
    activity_id: uuid.UUID, body: ReorderIn, session: SessionDep, user: CreatorUser
) -> ActivityOut:
    act = await get_owned(session, activity_id, user)
    current = {q.id: q for q in act.questions}
    if set(body.question_ids) != set(current) or len(body.question_ids) != len(current):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Send every question id exactly once")
    for i, qid in enumerate(body.question_ids):
        current[qid].position = i
    act.updated_at = datetime.now(UTC)
    await session.commit()
    fresh = await session.get(Activity, act.id, populate_existing=True)
    assert fresh is not None
    return await full(session, fresh, await _assignment_count(session, fresh.id))


@router.post("/activities/{activity_id}/apply-all", response_model=ActivityOut)
async def apply_all(
    activity_id: uuid.UUID, body: BulkApplyIn, session: SessionDep, user: CreatorUser
) -> ActivityOut:
    act = await get_owned(session, activity_id, user)
    for q in act.questions:
        if body.clear_timer:
            q.time_limit_seconds = None
        elif body.time_limit_seconds is not None:
            q.time_limit_seconds = body.time_limit_seconds
        if body.marks is not None and act.kind in (ActivityKind.quiz, ActivityKind.assignment):
            q.marks = body.marks
            q.rubric = []  # a rubric must add up to the marks; new marks invalidate it
    act.updated_at = datetime.now(UTC)
    await session.commit()
    return await full(session, act, await _assignment_count(session, act.id))


# ---------------------------------------------------------------- assign


async def new_join_code(session: AsyncSession) -> str:
    """Six digits, unique among rooms (about one in a million chance to guess one)."""
    import secrets

    for _ in range(20):
        code = f"{secrets.randbelow(900000) + 100000}"
        taken = await session.scalar(
            select(ActivityAssignment.id).where(ActivityAssignment.join_code == code)
        )
        if taken is None:
            return code
    raise HTTPException(
        status.HTTP_503_SERVICE_UNAVAILABLE, "Could not create a join code, try again"
    )


@router.post("/activities/{activity_id}/assign", response_model=AssignmentOut, status_code=201)
async def assign(
    activity_id: uuid.UUID, body: AssignIn, request: Request, session: SessionDep, user: CreatorUser
) -> AssignmentOut:
    act = await get_owned(session, activity_id, user)
    if not act.questions:
        raise HTTPException(status.HTTP_409_CONFLICT, "Add questions before assigning")
    if user.role == Role.club and (body.section_ids or body.student_ids or not body.room):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Club organisers share activities as rooms with a join code",
        )
    if body.section_ids and user.role == Role.faculty:
        await resolve_classes(session, user, body.section_ids)
    if act.status == ActivityStatus.draft:
        act.status = ActivityStatus.published  # assigning publishes, like Wayground
        act.published_at = datetime.now(UTC)
    if body.student_ids:
        found = set(
            (
                await session.scalars(
                    select(User.id).where(User.id.in_(body.student_ids), User.role == Role.student)
                )
            ).all()
        )
        if found != set(body.student_ids):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Some selected students do not exist")
    a = ActivityAssignment(
        activity_id=act.id,
        created_by=user.id,
        start_at=body.start_at or datetime.now(UTC),
        **body.model_dump(exclude={"section_ids", "student_ids", "start_at", "room"}),
    )
    if body.room:
        a.join_code = await new_join_code(session)
    a.targets = [AssignmentTarget(section_id=s) for s in sorted(set(body.section_ids))] + [
        AssignmentTarget(student_id=s) for s in sorted(set(body.student_ids))
    ]
    session.add(a)
    audit.record(session, "activity_assigned", actor_id=user.id, target=str(act.id))
    await session.commit()
    fresh = await session.get(ActivityAssignment, a.id, populate_existing=True)
    assert fresh is not None
    if fresh.notify and get_settings().email_enabled:
        await enqueue(request, "notify_assigned", str(fresh.id))
    return await assignment_out(session, fresh)


@router.get("/activities/{activity_id}/assignments", response_model=list[AssignmentOut])
async def list_assignments(
    activity_id: uuid.UUID, session: SessionDep, user: CreatorUser
) -> list[AssignmentOut]:
    act = await get_owned(session, activity_id, user)
    rows = await session.scalars(
        select(ActivityAssignment)
        .where(ActivityAssignment.activity_id == act.id)
        .order_by(ActivityAssignment.created_at.desc())
    )
    return [await assignment_out(session, a) for a in rows.unique()]
