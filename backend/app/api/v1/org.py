"""Departments, sections, subjects and faculty-section-subject mapping."""

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy import Select, delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import AdminUser, CurrentUser, SessionDep, StaffUser
from app.models import (
    Activity,
    ActivitySection,
    AssignmentTarget,
    Attempt,
    Department,
    FacultyAssignment,
    Role,
    Section,
    StudentSection,
    Subject,
    User,
    UserDepartment,
)
from app.schemas.org import (
    AssignmentIn,
    AssignmentOut,
    DepartmentIn,
    DepartmentOut,
    SectionIn,
    SectionOut,
    StudentSectionIn,
    SubjectIn,
    SubjectOut,
)
from app.services import audit

router = APIRouter(tags=["organisation"])


async def _commit_or_409(session: AsyncSession, what: str) -> None:
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"{what} already exists or is invalid"
        ) from exc


def section_label(section: Section) -> str:
    dept = section.department.code if section.department else "?"
    return f"{dept} Sem {section.semester} {section.name} ({section.academic_year})"


# ---------- departments ----------


@router.get("/departments", response_model=list[DepartmentOut])
async def list_departments(session: SessionDep, _: CurrentUser) -> list[Department]:
    return list(await session.scalars(select(Department).order_by(Department.code)))


@router.post("/departments", response_model=DepartmentOut, status_code=201)
async def create_department(
    body: DepartmentIn, session: SessionDep, admin: AdminUser
) -> Department:
    dept = Department(code=body.code.strip().upper(), name=body.name.strip())
    session.add(dept)
    audit.record(session, "department_created", actor_id=admin.id, target=dept.code)
    await _commit_or_409(session, "Department")
    return dept


class DeleteImpact(BaseModel):
    """What deleting a department, section or subject takes with it (shown before confirming)."""

    name: str
    counts: dict[str, int]
    # A reason it cannot be deleted yet. Set when people or student work still hang on it.
    blocked: str | None = None


async def _count(session: AsyncSession, stmt: Select[Any]) -> int:
    return int(await session.scalar(stmt) or 0)


def _refuse(impact: DeleteImpact) -> None:
    if impact.blocked:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail={"code": "in_use", "message": impact.blocked}
        )


async def _department_impact(session: AsyncSession, dept: Department) -> DeleteImpact:
    sections = await _count(
        session, select(func.count()).select_from(Section).where(Section.department_id == dept.id)
    )
    people = await _count(
        session,
        select(func.count(func.distinct(User.id)))
        .outerjoin(UserDepartment, UserDepartment.user_id == User.id)
        .where((User.department_id == dept.id) | (UserDepartment.department_id == dept.id)),
    )
    subjects = await _count(
        session, select(func.count()).select_from(Subject).where(Subject.department_id == dept.id)
    )
    blocked = None
    if sections or people:
        blocked = (
            f"{dept.code} still has {sections} sections and {people} people. "
            "Delete its sections and move its people to another department first."
        )
    return DeleteImpact(
        name=f"{dept.code} {dept.name}",
        counts={"sections": sections, "people": people, "subjects": subjects},
        blocked=blocked,
    )


@router.get("/departments/{department_id}/delete-impact", response_model=DeleteImpact)
async def department_impact(department_id: int, session: SessionDep, _: AdminUser) -> DeleteImpact:
    dept = await session.get(Department, department_id)
    if dept is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Department not found")
    return await _department_impact(session, dept)


@router.delete("/departments/{department_id}", status_code=204)
async def delete_department(department_id: int, session: SessionDep, admin: AdminUser) -> Response:
    """Only an empty department goes: one with sections or people is refused, so no class is
    lost by one click. Its subjects stay, without a department."""
    dept = await session.get(Department, department_id)
    if dept is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Department not found")
    impact = await _department_impact(session, dept)
    _refuse(impact)
    await session.delete(dept)
    audit.record(
        session, "department_deleted", actor_id=admin.id, target=dept.code, meta=impact.counts
    )
    await session.commit()
    return Response(status_code=204)


# ---------- sections ----------


async def _section_impact(session: AsyncSession, section: Section) -> DeleteImpact:
    students = await _count(
        session,
        select(func.count())
        .select_from(StudentSection)
        .where(StudentSection.section_id == section.id),
    )
    mappings = await _count(
        session,
        select(func.count())
        .select_from(FacultyAssignment)
        .where(FacultyAssignment.section_id == section.id),
    )
    activities = await _count(
        session,
        select(func.count())
        .select_from(ActivitySection)
        .where(ActivitySection.section_id == section.id),
    )
    targets = select(AssignmentTarget.assignment_id).where(
        AssignmentTarget.section_id == section.id
    )
    assignments = await _count(
        session,
        select(func.count(func.distinct(AssignmentTarget.assignment_id))).where(
            AssignmentTarget.section_id == section.id
        ),
    )
    attempts = await _count(
        session,
        select(func.count()).select_from(Attempt).where(Attempt.assignment_id.in_(targets)),
    )
    blocked = None
    if attempts:
        blocked = (
            f"Work assigned to this section has {attempts} student attempts. "
            "Deleting the section would leave those reports without their class. "
            "Delete those results first (report page, Delete results)."
        )
    return DeleteImpact(
        name=section_label(section),
        counts={
            "students": students,
            "teacher_mappings": mappings,
            "activities": activities,
            "assignments": assignments,
            "attempts": attempts,
        },
        blocked=blocked,
    )


@router.get("/sections/{section_id}/delete-impact", response_model=DeleteImpact)
async def section_impact(section_id: int, session: SessionDep, _: AdminUser) -> DeleteImpact:
    section = await session.get(Section, section_id)
    if section is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Section not found")
    return await _section_impact(session, section)


async def _section_out(session: AsyncSession, sections: list[Section]) -> list[SectionOut]:
    if not sections:
        return []
    counts = dict(
        (
            await session.execute(
                select(StudentSection.section_id, func.count())
                .where(StudentSection.section_id.in_([s.id for s in sections]))
                .group_by(StudentSection.section_id)
            )
        ).all()
    )
    return [
        SectionOut(
            id=s.id,
            department_id=s.department_id,
            semester=s.semester,
            name=s.name,
            academic_year=s.academic_year,
            department_code=s.department.code if s.department else None,
            student_count=counts.get(s.id, 0),
        )
        for s in sections
    ]


@router.get("/sections", response_model=list[SectionOut])
async def list_sections(
    session: SessionDep,
    _: AdminUser,
    department_id: int | None = None,
    academic_year: str | None = None,
) -> list[SectionOut]:
    stmt = select(Section)
    if department_id:
        stmt = stmt.where(Section.department_id == department_id)
    if academic_year:
        stmt = stmt.where(Section.academic_year == academic_year)
    stmt = stmt.order_by(Section.academic_year.desc(), Section.semester, Section.name)
    return await _section_out(session, list((await session.scalars(stmt)).unique()))


@router.post("/sections", response_model=SectionOut, status_code=201)
async def create_section(body: SectionIn, session: SessionDep, admin: AdminUser) -> SectionOut:
    section = Section(**body.model_dump() | {"name": body.name.strip().upper()})
    session.add(section)
    audit.record(session, "section_created", actor_id=admin.id, meta=body.model_dump())
    await _commit_or_409(session, "Section")
    await session.refresh(section)
    return (await _section_out(session, [section]))[0]


@router.delete("/sections/{section_id}", status_code=204)
async def delete_section(section_id: int, session: SessionDep, admin: AdminUser) -> Response:
    section = await session.get(Section, section_id)
    if section is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Section not found")
    impact = await _section_impact(session, section)
    _refuse(impact)
    await session.delete(section)
    audit.record(
        session,
        "section_deleted",
        actor_id=admin.id,
        target=impact.name,
        meta={"id": section_id, **impact.counts},
    )
    await session.commit()
    return Response(status_code=204)


@router.post("/sections/{section_id}/students", status_code=204)
async def add_students(
    section_id: int, body: StudentSectionIn, session: SessionDep, admin: AdminUser
) -> Response:
    if await session.get(Section, section_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Section not found")
    students = (
        await session.scalars(
            select(User.id).where(User.id.in_(body.student_ids), User.role == Role.student)
        )
    ).all()
    existing = set(
        (
            await session.scalars(
                select(StudentSection.student_id).where(StudentSection.section_id == section_id)
            )
        ).all()
    )
    for sid in students:
        if sid not in existing:
            session.add(StudentSection(student_id=sid, section_id=section_id))
    audit.record(session, "section_students_added", actor_id=admin.id, target=str(section_id))
    await session.commit()
    return Response(status_code=204)


@router.delete("/sections/{section_id}/students/{student_id}", status_code=204)
async def remove_student(
    section_id: int, student_id: uuid.UUID, session: SessionDep, admin: AdminUser
) -> Response:
    await session.execute(
        delete(StudentSection).where(
            StudentSection.section_id == section_id, StudentSection.student_id == student_id
        )
    )
    audit.record(session, "section_student_removed", actor_id=admin.id, target=str(section_id))
    await session.commit()
    return Response(status_code=204)


# ---------- subjects ----------


@router.get("/subjects", response_model=list[SubjectOut])
async def list_subjects(
    session: SessionDep, _: CurrentUser, department_id: int | None = None
) -> list[Subject]:
    stmt = select(Subject).order_by(Subject.code)
    if department_id:
        stmt = stmt.where(Subject.department_id == department_id)
    return list(await session.scalars(stmt))


@router.post("/subjects", response_model=SubjectOut, status_code=201)
async def create_subject(body: SubjectIn, session: SessionDep, admin: AdminUser) -> Subject:
    subject = Subject(**body.model_dump() | {"code": body.code.strip().upper()})
    session.add(subject)
    audit.record(session, "subject_created", actor_id=admin.id, target=subject.code)
    await _commit_or_409(session, "Subject")
    return subject


async def _subject_impact(session: AsyncSession, subject: Subject) -> DeleteImpact:
    mappings = await _count(
        session,
        select(func.count())
        .select_from(FacultyAssignment)
        .where(FacultyAssignment.subject_id == subject.id),
    )
    activities = await _count(
        session, select(func.count()).select_from(Activity).where(Activity.subject_id == subject.id)
    )
    return DeleteImpact(
        name=f"{subject.code} {subject.name}",
        counts={"teacher_mappings": mappings, "activities": activities},
    )


@router.get("/subjects/{subject_id}/delete-impact", response_model=DeleteImpact)
async def subject_impact(subject_id: int, session: SessionDep, _: AdminUser) -> DeleteImpact:
    subject = await session.get(Subject, subject_id)
    if subject is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Subject not found")
    return await _subject_impact(session, subject)


@router.delete("/subjects/{subject_id}", status_code=204)
async def delete_subject(subject_id: int, session: SessionDep, admin: AdminUser) -> Response:
    """The teacher mappings of the subject go with it; activities keep their questions and
    results and only lose the subject label."""
    subject = await session.get(Subject, subject_id)
    if subject is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Subject not found")
    impact = await _subject_impact(session, subject)
    await session.delete(subject)
    audit.record(
        session, "subject_deleted", actor_id=admin.id, target=subject.code, meta=impact.counts
    )
    await session.commit()
    return Response(status_code=204)


# ---------- faculty assignments ----------


async def _assignment_out(
    session: AsyncSession, rows: list[FacultyAssignment]
) -> list[AssignmentOut]:
    faculty_ids = {r.faculty_id for r in rows}
    users = {
        u.id: u
        for u in (await session.scalars(select(User).where(User.id.in_(faculty_ids)))).unique()
    }
    out = []
    for r in rows:
        f = users.get(r.faculty_id)
        out.append(
            AssignmentOut(
                id=r.id,
                faculty_id=r.faculty_id,
                faculty_name=f.full_name if f else "?",
                faculty_username=f.username if f else "?",
                section_id=r.section_id,
                section_label=section_label(r.section),
                subject_id=r.subject_id,
                subject_code=r.subject.code,
                subject_name=r.subject.name,
            )
        )
    return out


@router.get("/assignments", response_model=list[AssignmentOut])
async def list_assignments(
    session: SessionDep, _: AdminUser, faculty_id: uuid.UUID | None = None
) -> list[AssignmentOut]:
    stmt = select(FacultyAssignment).order_by(FacultyAssignment.id)
    if faculty_id:
        stmt = stmt.where(FacultyAssignment.faculty_id == faculty_id)
    return await _assignment_out(session, list((await session.scalars(stmt)).unique()))


@router.post("/assignments", response_model=AssignmentOut, status_code=201)
async def create_assignment(
    body: AssignmentIn, session: SessionDep, admin: AdminUser
) -> AssignmentOut:
    faculty = await session.get(User, body.faculty_id)
    if faculty is None or faculty.role != Role.faculty:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "faculty_id must be a faculty user")
    row = FacultyAssignment(**body.model_dump())
    session.add(row)
    audit.record(
        session, "assignment_created", actor_id=admin.id, meta=body.model_dump(mode="json")
    )
    await _commit_or_409(session, "Assignment")
    # reload with joined relationships (the identity-map copy has none loaded)
    row = (
        (
            await session.scalars(
                select(FacultyAssignment)
                .where(FacultyAssignment.id == row.id)
                .execution_options(populate_existing=True)
            )
        )
        .unique()
        .one()
    )
    return (await _assignment_out(session, [row]))[0]


@router.delete("/assignments/{assignment_id}", status_code=204)
async def delete_assignment(assignment_id: int, session: SessionDep, admin: AdminUser) -> Response:
    row = await session.get(FacultyAssignment, assignment_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assignment not found")
    await session.delete(row)
    audit.record(session, "assignment_deleted", actor_id=admin.id, target=str(assignment_id))
    await session.commit()
    return Response(status_code=204)


# ---------- "my" views for faculty and students ----------


@router.get("/me/teaching", response_model=list[AssignmentOut])
async def my_teaching(session: SessionDep, user: CurrentUser) -> list[AssignmentOut]:
    if user.role != Role.faculty:
        return []
    rows = await session.scalars(
        select(FacultyAssignment).where(FacultyAssignment.faculty_id == user.id)
    )
    return await _assignment_out(session, list(rows.unique()))


@router.get("/me/sections", response_model=list[SectionOut])
async def my_sections(session: SessionDep, user: CurrentUser) -> list[SectionOut]:
    rows = await session.scalars(
        select(Section)
        .join(StudentSection, StudentSection.section_id == Section.id)
        .where(StudentSection.student_id == user.id)
    )
    return await _section_out(session, list(rows.unique()))


class StudentBrief(BaseModel):
    id: uuid.UUID
    username: str
    full_name: str
    email: str | None


@router.get("/sections/{section_id}/students", response_model=list[StudentBrief])
async def section_students(
    section_id: int, session: SessionDep, user: StaffUser
) -> list[StudentBrief]:
    """Students of a section; faculty may only list sections they teach."""
    if user.role == Role.faculty:
        teaches = await session.scalar(
            select(FacultyAssignment.id).where(
                FacultyAssignment.faculty_id == user.id, FacultyAssignment.section_id == section_id
            )
        )
        if teaches is None:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not teach this section")
    rows = await session.scalars(
        select(User)
        .join(StudentSection, StudentSection.student_id == User.id)
        .where(StudentSection.section_id == section_id, User.is_active.is_(True))
        .order_by(User.username)
    )
    return [
        StudentBrief(id=u.id, username=u.username, full_name=u.full_name, email=u.email)
        for u in rows.unique()
    ]
