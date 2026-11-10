"""Where a user belongs: departments (faculty may have several) and a student's section."""

import uuid

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Department, Role, Section, StudentSection, User, UserDepartment


class OrgError(Exception):
    """A bad department or section choice; the message is safe to show."""


async def add_department(session: AsyncSession, user_id: uuid.UUID, department_id: int) -> None:
    if await session.get(UserDepartment, (user_id, department_id)) is None:
        session.add(UserDepartment(user_id=user_id, department_id=department_id))


async def set_departments(session: AsyncSession, user: User, department_ids: list[int]) -> None:
    """Replace the user's departments. The first one is the main department.

    Only faculty may belong to more than one."""
    ids = list(dict.fromkeys(department_ids))  # keep order, drop repeats
    if len(ids) > 1 and user.role != Role.faculty:
        raise OrgError("Only faculty can belong to more than one department")
    if ids:
        found = set(
            (await session.scalars(select(Department.id).where(Department.id.in_(ids)))).all()
        )
        if found != set(ids):
            raise OrgError("Unknown department")
    await session.execute(delete(UserDepartment).where(UserDepartment.user_id == user.id))
    for d in ids:
        session.add(UserDepartment(user_id=user.id, department_id=d))
    user.department_id = ids[0] if ids else None


async def set_section(session: AsyncSession, user: User, section_id: int | None) -> Section | None:
    """Put a student in a section (one per academic year), or take them out of every section
    of the current choice when `section_id` is None."""
    if user.role != Role.student:
        if section_id is not None:
            raise OrgError("Only students belong to a section")
        return None
    if section_id is None:
        await session.execute(delete(StudentSection).where(StudentSection.student_id == user.id))
        return None
    sec = await session.get(Section, section_id)
    if sec is None:
        raise OrgError("Unknown section")
    same_year = select(Section.id).where(Section.academic_year == sec.academic_year)
    await session.execute(
        delete(StudentSection).where(
            StudentSection.student_id == user.id,
            StudentSection.section_id.in_(same_year),
            StudentSection.section_id != sec.id,
        )
    )
    if await session.get(StudentSection, (user.id, sec.id)) is None:
        session.add(StudentSection(student_id=user.id, section_id=sec.id))
    return sec


async def current_sections(
    session: AsyncSession, student_ids: list[uuid.UUID]
) -> dict[uuid.UUID, Section]:
    """Each student's section in their latest academic year."""
    if not student_ids:
        return {}
    rows = (
        await session.execute(
            select(StudentSection.student_id, Section)
            .join(Section, Section.id == StudentSection.section_id)
            .where(StudentSection.student_id.in_(student_ids))
            .order_by(Section.academic_year)
        )
    ).all()
    return {student_id: sec for student_id, sec in rows}  # later years overwrite earlier ones


def section_label(sec: Section) -> str:
    dept = sec.department.code if sec.department else ""
    return f"{dept} Sem {sec.semester} {sec.name}".strip()
