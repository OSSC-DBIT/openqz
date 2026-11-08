"""Seed data for load testing (never run in production).

    python -m app.loadseed --students 300 --out /tmp/load-tokens.json

Creates a LOAD department + section with N students (password LoadTest2026), a faculty
member, a 10-question quiz assigned to the section, and writes a JSON file with an access
token per student so k6 can skip the (rate-limited) login endpoint.
"""

import argparse
import asyncio
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select

from app.core.config import get_settings
from app.core.db import SessionLocal, engine
from app.core.security import create_access_token, hash_password
from app.models import (
    Activity,
    ActivityAssignment,
    ActivityKind,
    ActivityStatus,
    AssignmentTarget,
    Department,
    Question,
    QuestionType,
    Role,
    Section,
    StudentSection,
    User,
)

PASSWORD = "LoadTest2026"


async def seed(n: int, out: str) -> None:
    if get_settings().is_production:
        raise SystemExit("refusing to seed load-test data in production")
    async with SessionLocal() as s:
        dept = await s.scalar(select(Department).where(Department.code == "LOAD"))
        if dept is None:
            dept = Department(code="LOAD", name="Load test")
            s.add(dept)
            await s.flush()
        sec = await s.scalar(select(Section).where(Section.department_id == dept.id))
        if sec is None:
            sec = Section(department_id=dept.id, semester=1, name="L", academic_year="2026-27")
            s.add(sec)
            await s.flush()
        pw = hash_password(PASSWORD)  # one hash for all: seeding 300 Argon2 hashes is slow
        fac = await s.scalar(select(User).where(User.username == "LOADFAC"))
        if fac is None:
            fac = User(
                username="LOADFAC",
                email="loadfac@openqz.dev",
                full_name="Load Faculty",
                role=Role.faculty,
                department_id=dept.id,
                password_hash=pw,
                must_change_password=False,
            )
            s.add(fac)
            await s.flush()
        existing = {
            u.username: u
            for u in (await s.scalars(select(User).where(User.username.like("LOAD%")))).unique()
        }
        students = []
        for i in range(1, n + 1):
            uname = f"LOAD{i:04d}"
            u = existing.get(uname)
            if u is None:
                u = User(
                    username=uname,
                    email=f"load{i:04d}@openqz.dev",
                    full_name=f"Load Student {i}",
                    role=Role.student,
                    department_id=dept.id,
                    password_hash=pw,
                    must_change_password=False,
                )
                s.add(u)
                await s.flush()
                s.add(StudentSection(student_id=u.id, section_id=sec.id))
            students.append(u)

        act = Activity(
            owner_id=fac.id,
            title=f"Load quiz {datetime.now(UTC):%H%M%S}",
            kind=ActivityKind.quiz,
            status=ActivityStatus.published,
            department_id=dept.id,
            semester=1,
            section_id=sec.id,
        )
        s.add(act)
        await s.flush()
        for i in range(10):
            s.add(
                Question(
                    activity_id=act.id,
                    position=i,
                    type=QuestionType.mcq,
                    stem=f"Load question {i + 1}?",
                    options=[
                        {"id": "a", "text": "A", "correct": True},
                        {"id": "b", "text": "B"},
                        {"id": "c", "text": "C"},
                        {"id": "d", "text": "D"},
                    ],
                    answer={},
                    marks=Decimal("1"),
                    tags=[],
                    rubric=[],
                )
            )
        a = ActivityAssignment(
            activity_id=act.id,
            created_by=fac.id,
            start_at=datetime.now(UTC) - timedelta(minutes=1),
            due_at=datetime.now(UTC) + timedelta(days=1),
            max_attempts=0,
            instant_feedback=False,
            max_violations=0,
            notify=False,
        )
        a.targets = [AssignmentTarget(section_id=sec.id)]
        s.add(a)
        await s.commit()
        tokens = [create_access_token(u.id, "student", False) for u in students]
        with open(out, "w") as f:
            json.dump({"assignment_id": str(a.id), "tokens": tokens}, f)
        print(f"seeded {n} students, assignment {a.id}; tokens -> {out}")
    await engine.dispose()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--students", type=int, default=300)
    ap.add_argument("--out", default="/tmp/load-tokens.json")
    args = ap.parse_args()
    asyncio.run(seed(args.students, args.out))


if __name__ == "__main__":
    main()
