"""Import job lifecycle: parse -> preview -> commit -> credential PDF."""

import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import generate_temp_password, hash_password
from app.models import (
    Department,
    FacultyAssignment,
    ImportJob,
    ImportKind,
    ImportStatus,
    Role,
    Section,
    StudentSection,
    Subject,
    User,
)
from app.services import audit
from app.services.credential_pdf import Credential, build_credential_pdf
from app.services.import_parser import (
    FIELDS,
    ParseError,
    read_table,
    suggest_header_map,
    validate_rows,
)

PREVIEW_LIMIT = 50
ERROR_LIMIT = 500


def job_dir(job_id: uuid.UUID) -> Path:
    return get_settings().media_dir / "imports" / str(job_id)


async def _db_checks(
    session: AsyncSession, kind: ImportKind, valid: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Cross-check rows against the database. Returns (still_valid, new_errors)."""
    usernames = {r["username"] for r in valid}
    existing = {
        u.username: u
        for u in (await session.scalars(select(User).where(User.username.in_(usernames)))).unique()
    }
    emails = {r["email"] for r in valid if r.get("email")}
    email_owner = {
        (u.email or "").lower(): u.username
        for u in (
            await session.scalars(select(User).where(func.lower(User.email).in_(emails)))
        ).unique()
    }
    ok, errs = [], []
    for r in valid:
        u = existing.get(r["username"])
        problem = None
        owner = email_owner.get(r.get("email", ""))
        if owner and owner != r["username"]:
            problem = f"email {r['email']} already belongs to {owner}"
        elif kind == ImportKind.students and u and u.role != Role.student:
            problem = f"{r['username']} already exists as {u.role.value}"
        elif kind == ImportKind.faculty and u and u.role != Role.faculty:
            problem = f"{r['username']} already exists as {u.role.value}"
        elif kind == ImportKind.mapping and (u is None or u.role != Role.faculty):
            problem = f"faculty {r['username']} not found; import faculty first"
        if problem:
            errs.append({"row": r["row"], "errors": [problem], "values": r})
        else:
            r["exists"] = u is not None
            ok.append(r)
    return ok, errs


async def parse_job(session: AsyncSession, job_id: uuid.UUID) -> ImportJob:
    job = await session.get(ImportJob, job_id)
    if job is None:
        raise ValueError("job not found")
    job.status = ImportStatus.parsing
    await session.commit()
    try:
        headers, rows = read_table(Path(job.file_path))
    except ParseError as exc:
        job.status = ImportStatus.failed
        job.message = str(exc)
        await session.commit()
        return job

    job.source_headers = headers
    if not job.header_map:
        job.header_map = suggest_header_map(job.kind, headers)
    result = validate_rows(job.kind, headers, rows, job.header_map)
    job.total_rows = len(rows)

    if result.missing_columns:
        job.status = ImportStatus.preview
        job.valid_rows = 0
        job.preview_rows = []
        job.error_rows = []
        job.message = "Map these columns before importing: " + ", ".join(result.missing_columns)
        await session.commit()
        return job

    valid, db_errors = await _db_checks(session, job.kind, result.valid)
    errors = sorted(result.errors + db_errors, key=lambda e: e["row"])
    job.valid_rows = len(valid)
    job.preview_rows = valid[:PREVIEW_LIMIT]
    job.error_rows = errors[:ERROR_LIMIT]
    new_count = sum(1 for r in valid if not r.get("exists"))
    new_part = "" if job.kind == ImportKind.mapping else f" ({new_count} new)"
    job.message = f"{len(valid)} valid rows{new_part}, {len(errors)} rows with errors" + (
        f" (showing first {ERROR_LIMIT})" if len(errors) > ERROR_LIMIT else ""
    )
    job.status = ImportStatus.preview
    await session.commit()
    return job


class _Cache:
    def __init__(self, session: AsyncSession, academic_year: str) -> None:
        self.s = session
        self.year = academic_year
        self.depts: dict[str, Department] = {}
        self.sections: dict[tuple[int, int, str], Section] = {}
        self.subjects: dict[str, Subject] = {}

    async def dept(self, code: str) -> Department:
        if code not in self.depts:
            d = await self.s.scalar(select(Department).where(Department.code == code))
            if d is None:
                d = Department(code=code, name=code)
                self.s.add(d)
                await self.s.flush()
            self.depts[code] = d
        return self.depts[code]

    async def section(self, dept: Department, sem: int, name: str) -> Section:
        key = (dept.id, sem, name)
        if key not in self.sections:
            sec = await self.s.scalar(
                select(Section).where(
                    Section.department_id == dept.id,
                    Section.semester == sem,
                    Section.name == name,
                    Section.academic_year == self.year,
                )
            )
            if sec is None:
                sec = Section(
                    department_id=dept.id, semester=sem, name=name, academic_year=self.year
                )
                self.s.add(sec)
                await self.s.flush()
            self.sections[key] = sec
        return self.sections[key]

    async def subject(self, code: str, name: str | None, dept: Department, sem: int) -> Subject:
        if code not in self.subjects:
            sub = await self.s.scalar(select(Subject).where(Subject.code == code))
            if sub is None:
                sub = Subject(code=code, name=name or code, department_id=dept.id, semester=sem)
                self.s.add(sub)
                await self.s.flush()
            elif name and sub.name == sub.code:
                sub.name = name
            self.subjects[code] = sub
        return self.subjects[code]


async def commit_job(session: AsyncSession, job_id: uuid.UUID) -> ImportJob:
    job = await session.get(ImportJob, job_id)
    if job is None:
        raise ValueError("job not found")
    job.status = ImportStatus.committing
    await session.commit()

    try:
        headers, rows = read_table(Path(job.file_path))
        result = validate_rows(job.kind, headers, rows, job.header_map or {})
        valid, _ = await _db_checks(session, job.kind, result.valid)
        created, updated, creds = await _apply(session, job, valid)
    except Exception as exc:  # report any failure on the job instead of crashing the worker
        await session.rollback()
        job = await session.get(ImportJob, job_id)
        assert job is not None
        job.status = ImportStatus.failed
        job.message = f"Import failed: {exc}"
        await session.commit()
        return job

    if creds:
        pdf_path = job_dir(job.id) / "credentials.pdf"
        build_credential_pdf(pdf_path, creds, get_settings().public_url)
        job.credential_pdf_path = str(pdf_path)
    job.created_count = created
    job.updated_count = updated
    job.status = ImportStatus.done
    job.message = f"Imported: {created} created, {updated} updated"
    audit.record(
        session,
        "import_committed",
        actor_id=job.created_by,
        target=str(job.id),
        meta={"kind": job.kind.value, "created": created, "updated": updated},
    )
    await session.commit()
    return job


async def _apply(
    session: AsyncSession, job: ImportJob, valid: list[dict[str, Any]]
) -> tuple[int, int, list[Credential]]:
    cache = _Cache(session, job.academic_year)
    created = updated = 0
    creds: list[Credential] = []

    if job.kind == ImportKind.mapping:
        for r in valid:
            faculty = await session.scalar(select(User).where(User.username == r["username"]))
            assert faculty is not None
            dept = await cache.dept(r["department"])
            sec = await cache.section(dept, r["semester"], r["section"])
            sub = await cache.subject(r["subject_code"], r.get("subject_name"), dept, r["semester"])
            exists = await session.scalar(
                select(FacultyAssignment.id).where(
                    FacultyAssignment.faculty_id == faculty.id,
                    FacultyAssignment.section_id == sec.id,
                    FacultyAssignment.subject_id == sub.id,
                )
            )
            if exists is None:
                session.add(
                    FacultyAssignment(faculty_id=faculty.id, section_id=sec.id, subject_id=sub.id)
                )
                created += 1
            else:
                updated += 1
        await session.flush()
        return created, updated, creds

    role = Role.student if job.kind == ImportKind.students else Role.faculty
    for r in valid:
        dept = await cache.dept(r["department"])
        user = await session.scalar(select(User).where(User.username == r["username"]))
        if user is None:
            temp = generate_temp_password()
            user = User(
                username=r["username"],
                full_name=r["full_name"],
                email=r.get("email"),
                role=role,
                department_id=dept.id,
                password_hash=hash_password(temp),
                must_change_password=True,
            )
            session.add(user)
            await session.flush()
            created += 1
            group = f"Faculty  |  {dept.code}"
        else:
            user.full_name = r["full_name"]
            if r["email"] != (user.email or ""):
                user.email = r["email"]
                user.google_sub = None  # different email = different Google account
            user.department_id = dept.id
            updated += 1
            temp = None

        if role == Role.student:
            sec = await cache.section(dept, r["semester"], r["section"])
            # A student belongs to one section per academic year: move if needed.
            year_sections = select(Section.id).where(Section.academic_year == job.academic_year)
            await session.execute(
                delete(StudentSection).where(
                    StudentSection.student_id == user.id,
                    StudentSection.section_id.in_(year_sections),
                    StudentSection.section_id != sec.id,
                )
            )
            linked = await session.get(StudentSection, (user.id, sec.id))
            if linked is None:
                session.add(StudentSection(student_id=user.id, section_id=sec.id))
            group = f"{dept.code} Sem {sec.semester} {sec.name} ({sec.academic_year})"

        if temp:
            creds.append(Credential(group, user.username, user.full_name, temp, user.email or ""))
    await session.flush()
    return created, updated, creds


def fields_for(kind: ImportKind) -> tuple[list[str], list[str]]:
    return FIELDS[kind]
