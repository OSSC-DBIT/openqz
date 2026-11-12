"""Admin: college-wide statistics, by department and by teacher, with CSV / Excel export."""

import csv
import io
import uuid
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import ColumnElement, and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import AdminUser, SessionDep
from app.models import (
    Activity,
    ActivityAssignment,
    ActivityStatus,
    AssignmentTarget,
    Attempt,
    AttemptStatus,
    Department,
    FacultyAssignment,
    LiveGame,
    Role,
    Section,
    StudentSection,
    User,
    UserDepartment,
)

router = APIRouter(prefix="/admin/stats", tags=["admin statistics"])


class Totals(BaseModel):
    students: int
    faculty: int
    clubs: int
    departments: int
    sections: int
    activities: int
    assignments: int
    rooms: int
    live_games: int
    assigned: int
    submitted: int
    completion: float | None
    avg_percent: float | None
    pending_grading: int


class DepartmentStats(BaseModel):
    department_id: int
    code: str
    name: str
    students: int
    faculty: int
    sections: int
    activities: int
    # Class assignments given to this department's sections, and the students they reached.
    assignments: int
    assigned: int
    submitted: int
    completion: float | None
    avg_percent: float | None


class FacultyStats(BaseModel):
    user_id: uuid.UUID
    name: str
    username: str
    email: str | None
    role: Role
    departments: list[str]
    classes: int
    activities: int
    assignments: int
    rooms: int
    live_games: int
    assigned: int
    submitted: int
    completion: float | None
    avg_percent: float | None
    pending_grading: int
    last_assigned_at: datetime | None


class StatsOut(BaseModel):
    date_from: date | None
    date_to: date | None
    department_id: int | None
    totals: Totals
    departments: list[DepartmentStats]
    faculty: list[FacultyStats]


def _pct(part: int, whole: int) -> float | None:
    return round(part / whole * 100, 1) if whole else None


def _avg(total: float, n: int) -> float | None:
    return round(total / n, 1) if n else None


def _between(col: Any, date_from: date | None, date_to: date | None) -> ColumnElement[bool]:
    conds: list[ColumnElement[bool]] = []
    if date_from:
        conds.append(col >= datetime.combine(date_from, time.min, tzinfo=UTC))
    if date_to:
        conds.append(col < datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=UTC))
    return and_(*conds) if conds else and_(True)


async def build_stats(
    session: AsyncSession,
    date_from: date | None = None,
    date_to: date | None = None,
    department_id: int | None = None,
) -> StatsOut:
    in_range = _between(ActivityAssignment.created_at, date_from, date_to)

    # One row per (assignment, student) that was submitted, with that student's marks in percent.
    percent = case(
        (
            and_(Attempt.score.is_not(None), Attempt.max_score > 0),
            Attempt.score * 100.0 / Attempt.max_score,
        ),
        else_=None,
    )
    done = (
        select(
            Attempt.assignment_id.label("assignment_id"),
            Attempt.student_id.label("student_id"),
            func.max(percent).label("pct"),
            func.bool_or(Attempt.needs_manual).label("needs_manual"),
        )
        .where(Attempt.status == AttemptStatus.submitted)
        .group_by(Attempt.assignment_id, Attempt.student_id)
        .subquery("done")
    )

    # ------------------------------------------------------------ departments
    depts = list((await session.scalars(select(Department).order_by(Department.code))).all())
    if department_id:
        depts = [d for d in depts if d.id == department_id]

    async def by_dept(stmt: Any) -> dict[int, int]:
        return {k: v for k, v in (await session.execute(stmt)).all() if k is not None}

    students = await by_dept(
        select(User.department_id, func.count())
        .where(User.role == Role.student, User.is_active.is_(True))
        .group_by(User.department_id)
    )
    faculty = await by_dept(
        select(UserDepartment.department_id, func.count())
        .join(User, User.id == UserDepartment.user_id)
        .where(User.role == Role.faculty, User.is_active.is_(True))
        .group_by(UserDepartment.department_id)
    )
    sections = await by_dept(
        select(Section.department_id, func.count()).group_by(Section.department_id)
    )
    dept_activities = await by_dept(
        select(Activity.department_id, func.count())
        .where(
            Activity.status != ActivityStatus.archived,
            _between(Activity.created_at, date_from, date_to),
        )
        .group_by(Activity.department_id)
    )
    # Seats: every (assignment, student) reached through a section of the department.
    dept_seat = (
        select(
            Section.department_id.label("department_id"),
            AssignmentTarget.assignment_id.label("assignment_id"),
            StudentSection.student_id.label("student_id"),
        )
        .join(Section, Section.id == AssignmentTarget.section_id)
        .join(StudentSection, StudentSection.section_id == AssignmentTarget.section_id)
        .join(ActivityAssignment, ActivityAssignment.id == AssignmentTarget.assignment_id)
        .where(in_range)
        .distinct()
        .subquery("dept_seat")
    )
    dept_work = {
        row.department_id: row
        for row in (
            await session.execute(
                select(
                    dept_seat.c.department_id,
                    func.count(func.distinct(dept_seat.c.assignment_id)).label("assignments"),
                    func.count().label("assigned"),
                    func.count(done.c.assignment_id).label("submitted"),
                    func.coalesce(func.sum(done.c.pct), 0).label("pct_sum"),
                    func.count(done.c.pct).label("pct_n"),
                )
                .outerjoin(
                    done,
                    and_(
                        done.c.assignment_id == dept_seat.c.assignment_id,
                        done.c.student_id == dept_seat.c.student_id,
                    ),
                )
                .group_by(dept_seat.c.department_id)
            )
        ).all()
    }
    dept_rows: list[DepartmentStats] = []
    for d in depts:
        w = dept_work.get(d.id)
        dept_rows.append(
            DepartmentStats(
                department_id=d.id,
                code=d.code,
                name=d.name,
                students=students.get(d.id, 0),
                faculty=faculty.get(d.id, 0),
                sections=sections.get(d.id, 0),
                activities=dept_activities.get(d.id, 0),
                assignments=w.assignments if w else 0,
                assigned=w.assigned if w else 0,
                submitted=w.submitted if w else 0,
                completion=_pct(w.submitted, w.assigned) if w else None,
                avg_percent=_avg(float(w.pct_sum), w.pct_n) if w else None,
            )
        )

    # ------------------------------------------------------------ teachers and organisers
    people_stmt = (
        select(User)
        .where(User.role.in_([Role.faculty, Role.club, Role.admin]))
        .order_by(User.full_name)
    )
    if department_id:
        people_stmt = people_stmt.where(
            User.id.in_(
                select(UserDepartment.user_id).where(UserDepartment.department_id == department_id)
            )
        )
    people = list((await session.scalars(people_stmt)).unique())
    ids = [u.id for u in people]

    async def by_user(stmt: Any) -> dict[uuid.UUID, Any]:
        return {row[0]: row for row in (await session.execute(stmt)).all()}

    codes: dict[uuid.UUID, list[str]] = {}
    for user_id, code in (
        await session.execute(
            select(UserDepartment.user_id, Department.code)
            .join(Department, Department.id == UserDepartment.department_id)
            .where(UserDepartment.user_id.in_(ids))
            .order_by(Department.code)
        )
    ).all():
        codes.setdefault(user_id, []).append(code)
    classes = await by_user(
        select(
            FacultyAssignment.faculty_id, func.count(func.distinct(FacultyAssignment.section_id))
        )
        .where(FacultyAssignment.faculty_id.in_(ids))
        .group_by(FacultyAssignment.faculty_id)
    )
    owned = await by_user(
        select(Activity.owner_id, func.count())
        .where(
            Activity.owner_id.in_(ids),
            Activity.status != ActivityStatus.archived,
            _between(Activity.created_at, date_from, date_to),
        )
        .group_by(Activity.owner_id)
    )
    given = await by_user(
        select(
            Activity.owner_id,
            func.count().filter(ActivityAssignment.join_code.is_(None)),
            func.count().filter(ActivityAssignment.join_code.is_not(None)),
            func.max(ActivityAssignment.created_at),
        )
        .join(Activity, Activity.id == ActivityAssignment.activity_id)
        .where(Activity.owner_id.in_(ids), in_range)
        .group_by(Activity.owner_id)
    )
    games = await by_user(
        select(LiveGame.host_id, func.count())
        .where(LiveGame.host_id.in_(ids), _between(LiveGame.created_at, date_from, date_to))
        .group_by(LiveGame.host_id)
    )
    # Seats for a teacher: students of the assigned sections plus students picked one by one
    # (room players are added that way when they join).
    via_section = select(
        AssignmentTarget.assignment_id.label("assignment_id"),
        StudentSection.student_id.label("student_id"),
    ).join(StudentSection, StudentSection.section_id == AssignmentTarget.section_id)
    direct = select(
        AssignmentTarget.assignment_id.label("assignment_id"),
        AssignmentTarget.student_id.label("student_id"),
    ).where(AssignmentTarget.student_id.is_not(None))
    seat = via_section.union(direct).subquery("seat")
    work = await by_user(
        select(
            Activity.owner_id,
            func.count().label("assigned"),
            func.count(done.c.assignment_id).label("submitted"),
            func.coalesce(func.sum(done.c.pct), 0).label("pct_sum"),
            func.count(done.c.pct).label("pct_n"),
            func.count().filter(done.c.needs_manual.is_(True)).label("pending"),
        )
        .select_from(seat)
        .join(ActivityAssignment, ActivityAssignment.id == seat.c.assignment_id)
        .join(Activity, Activity.id == ActivityAssignment.activity_id)
        .outerjoin(
            done,
            and_(
                done.c.assignment_id == seat.c.assignment_id,
                done.c.student_id == seat.c.student_id,
            ),
        )
        .where(Activity.owner_id.in_(ids), in_range)
        .group_by(Activity.owner_id)
    )

    rows: list[FacultyStats] = []
    pct_sum = 0.0
    pct_n = 0
    for u in people:
        g = given.get(u.id)
        w = work.get(u.id)
        n_act = owned[u.id][1] if u.id in owned else 0
        n_live = games[u.id][1] if u.id in games else 0
        # Admins appear only when they made something themselves.
        if u.role == Role.admin and not (n_act or g or n_live):
            continue
        if w:
            pct_sum += float(w.pct_sum)
            pct_n += w.pct_n
        rows.append(
            FacultyStats(
                user_id=u.id,
                name=u.full_name,
                username=u.username,
                email=u.email,
                role=u.role,
                departments=codes.get(u.id, []),
                classes=classes[u.id][1] if u.id in classes else 0,
                activities=n_act,
                assignments=g[1] if g else 0,
                rooms=g[2] if g else 0,
                live_games=n_live,
                assigned=w.assigned if w else 0,
                submitted=w.submitted if w else 0,
                completion=_pct(w.submitted, w.assigned) if w else None,
                avg_percent=_avg(float(w.pct_sum), w.pct_n) if w else None,
                pending_grading=w.pending if w else 0,
                last_assigned_at=g[3] if g else None,
            )
        )

    assigned = sum(r.assigned for r in rows)
    submitted = sum(r.submitted for r in rows)
    totals = Totals(
        students=sum(d.students for d in dept_rows)
        if department_id
        else (
            await session.scalar(
                select(func.count()).where(User.role == Role.student, User.is_active.is_(True))
            )
        )
        or 0,
        faculty=sum(1 for u in people if u.role == Role.faculty and u.is_active),
        clubs=sum(1 for u in people if u.role == Role.club and u.is_active),
        departments=len(dept_rows),
        sections=sum(d.sections for d in dept_rows),
        activities=sum(r.activities for r in rows),
        assignments=sum(r.assignments for r in rows),
        rooms=sum(r.rooms for r in rows),
        live_games=sum(r.live_games for r in rows),
        assigned=assigned,
        submitted=submitted,
        completion=_pct(submitted, assigned),
        avg_percent=_avg(pct_sum, pct_n),
        pending_grading=sum(r.pending_grading for r in rows),
    )
    return StatsOut(
        date_from=date_from,
        date_to=date_to,
        department_id=department_id,
        totals=totals,
        departments=dept_rows,
        faculty=rows,
    )


DateFrom = Annotated[date | None, Query(description="Assigned on or after this day (UTC)")]
DateTo = Annotated[date | None, Query(description="Assigned on or before this day (UTC)")]


@router.get("", response_model=StatsOut)
async def stats(
    session: SessionDep,
    _: AdminUser,
    date_from: DateFrom = None,
    date_to: DateTo = None,
    department_id: int | None = None,
) -> StatsOut:
    """Numbers for the whole college: per department and per teacher or club organiser."""
    return await build_stats(session, date_from, date_to, department_id)


# ---------------------------------------------------------------- export

DEPT_HEAD = [
    "Department",
    "Name",
    "Students",
    "Faculty",
    "Sections",
    "Activities",
    "Class assignments",
    "Students assigned",
    "Submitted",
    "Completion %",
    "Average marks %",
]
FACULTY_HEAD = [
    "Name",
    "ID",
    "Email",
    "Role",
    "Departments",
    "Classes taught",
    "Activities",
    "Class assignments",
    "Rooms",
    "Live games",
    "Students assigned",
    "Submitted",
    "Completion %",
    "Average marks %",
    "Pending grading",
    "Last assigned",
]


def _n(v: float | None) -> float | str:
    return "" if v is None else v


def dept_table(s: StatsOut) -> list[list[Any]]:
    return [
        [
            d.code,
            d.name,
            d.students,
            d.faculty,
            d.sections,
            d.activities,
            d.assignments,
            d.assigned,
            d.submitted,
            _n(d.completion),
            _n(d.avg_percent),
        ]
        for d in s.departments
    ]


def faculty_table(s: StatsOut) -> list[list[Any]]:
    return [
        [
            f.name,
            f.username,
            f.email or "",
            "club organiser" if f.role == Role.club else f.role.value,
            ", ".join(f.departments),
            f.classes,
            f.activities,
            f.assignments,
            f.rooms,
            f.live_games,
            f.assigned,
            f.submitted,
            _n(f.completion),
            _n(f.avg_percent),
            f.pending_grading,
            f.last_assigned_at.strftime("%Y-%m-%d") if f.last_assigned_at else "",
        ]
        for f in s.faculty
    ]


def summary_table(s: StatsOut) -> list[list[Any]]:
    t = s.totals
    return [
        ["From", s.date_from.isoformat() if s.date_from else "the beginning"],
        ["To", s.date_to.isoformat() if s.date_to else "today"],
        ["Students", t.students],
        ["Faculty", t.faculty],
        ["Club organisers", t.clubs],
        ["Departments", t.departments],
        ["Sections", t.sections],
        ["Activities", t.activities],
        ["Class assignments", t.assignments],
        ["Rooms", t.rooms],
        ["Live games", t.live_games],
        ["Students assigned", t.assigned],
        ["Submitted", t.submitted],
        ["Completion %", _n(t.completion)],
        ["Average marks %", _n(t.avg_percent)],
        ["Pending grading", t.pending_grading],
    ]


def _safe(v: Any) -> Any:
    """Names come from people: never let a spreadsheet read one as a formula."""
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@"):
        return "'" + v
    return v


@router.get(".csv")
async def stats_csv(
    session: SessionDep,
    _: AdminUser,
    sheet: Literal["departments", "faculty"] = "departments",
    date_from: DateFrom = None,
    date_to: DateTo = None,
    department_id: int | None = None,
) -> StreamingResponse:
    s = await build_stats(session, date_from, date_to, department_id)
    buf = io.StringIO()
    w = csv.writer(buf)
    head, table = (
        (DEPT_HEAD, dept_table(s)) if sheet == "departments" else (FACULTY_HEAD, faculty_table(s))
    )
    w.writerow(head)
    for row in table:
        w.writerow([_safe(v) for v in row])
    return StreamingResponse(
        iter(["﻿" + buf.getvalue()]),  # BOM so Excel opens UTF-8 correctly
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="openqz-stats-{sheet}.csv"'},
    )


@router.get(".xlsx")
async def stats_xlsx(
    session: SessionDep,
    _: AdminUser,
    date_from: DateFrom = None,
    date_to: DateTo = None,
    department_id: int | None = None,
) -> StreamingResponse:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from openpyxl.utils import get_column_letter

    s = await build_stats(session, date_from, date_to, department_id)
    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws.title = "Summary"
    for row in summary_table(s):
        ws.append(row)
    for cell in ws["A"]:
        cell.font = Font(bold=True)
    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["B"].width = 18

    for title, head, table in (
        ("Departments", DEPT_HEAD, dept_table(s)),
        ("Faculty", FACULTY_HEAD, faculty_table(s)),
    ):
        sh = wb.create_sheet(title)
        sh.append(head)
        for cell in sh[1]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill("solid", fgColor="5B3FD6")
        for row in table:
            sh.append([_safe(v) for v in row])
        sh.freeze_panes = "A2"
        for i, name in enumerate(head, start=1):
            widest = max([len(name), *(len(str(r[i - 1])) for r in table)])
            sh.column_dimensions[get_column_letter(i)].width = min(40, widest + 2)

    out = io.BytesIO()
    wb.save(out)
    return StreamingResponse(
        iter([out.getvalue()]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="openqz-stats.xlsx"'},
    )
