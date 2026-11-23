"""Admin deletes departments, sections and subjects. Nothing that still carries people or
student work goes; every delete is in the audit log."""

from httpx import AsyncClient
from sqlalchemy import func, select

from app.core.db import SessionLocal
from app.models import Attempt, AuditLog, FacultyAssignment, Role, Section, StudentSection
from tests.conftest import PASSWORD, login, make_user
from tests.test_activities import A, assign, make_quiz, setup_class


async def _ids(client: AsyncClient, admin: dict[str, str]) -> tuple[int, int]:
    dept = (await client.get(f"{A}/departments", headers=admin)).json()[0]["id"]
    sub = (await client.get(f"{A}/subjects", headers=admin)).json()[0]["id"]
    return dept, sub


async def _audit(action: str) -> list[AuditLog]:
    async with SessionLocal() as s:
        return list((await s.scalars(select(AuditLog).where(AuditLog.action == action))).all())


async def test_only_admin_deletes(client: AsyncClient) -> None:
    c = await setup_class(client)
    await make_user("admin", Role.admin, full_name="Admin")
    dept, sub = await _ids(client, await login(client, "admin"))
    for who in (c["fac"], c["s1"]):
        for url in (f"sections/{c['sec']}", f"subjects/{sub}", f"departments/{dept}"):
            assert (await client.delete(f"{A}/{url}", headers=who)).status_code == 403
            assert (await client.get(f"{A}/{url}/delete-impact", headers=who)).status_code == 403


async def test_section_with_attempts_is_refused_then_deleted_when_clean(
    client: AsyncClient,
) -> None:
    c = await setup_class(client)
    await make_user("admin", Role.admin, full_name="Admin")
    admin = await login(client, "admin")
    act = await make_quiz(client, c["fac"])
    asg = await assign(client, c["fac"], act["id"], section_ids=[c["sec"]])

    # assigned but nobody started: allowed, and the dialog is told what goes
    imp = (await client.get(f"{A}/sections/{c['sec']}/delete-impact", headers=admin)).json()
    assert imp["blocked"] is None and imp["name"].startswith("CSE Sem 5 A")
    assert imp["counts"] == {
        "students": 2,
        "teacher_mappings": 1,
        "activities": imp["counts"]["activities"],
        "assignments": 1,
        "attempts": 0,
    }

    await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])
    imp = (await client.get(f"{A}/sections/{c['sec']}/delete-impact", headers=admin)).json()
    assert imp["counts"]["attempts"] == 1 and "Delete those results first" in imp["blocked"]
    r = await client.delete(f"{A}/sections/{c['sec']}", headers=admin)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "in_use"
    async with SessionLocal() as s:
        assert await s.scalar(select(func.count()).select_from(StudentSection)) == 2
        assert await s.scalar(select(func.count()).select_from(Attempt)) == 1
    assert await _audit("section_deleted") == []

    # the results are removed the guarded way, then the section can go
    gone = await client.post(
        f"{A}/admin/data/assignments/{asg['id']}/delete",
        headers=admin,
        json={"password": PASSWORD, "confirm": act["title"]},
    )
    assert gone.status_code == 204, gone.text
    assert (await client.delete(f"{A}/sections/{c['sec']}", headers=admin)).status_code == 204
    async with SessionLocal() as s:
        assert await s.scalar(select(func.count()).select_from(StudentSection)) == 0
        assert await s.scalar(select(func.count()).select_from(FacultyAssignment)) == 0
    log = await _audit("section_deleted")
    assert len(log) == 1 and log[0].meta is not None and log[0].meta["students"] == 2


async def test_attempts_of_another_section_do_not_block(client: AsyncClient) -> None:
    """One assignment for sections A and B: an attempt by a student of B does not hold A."""
    c = await setup_class(client)
    await make_user("admin", Role.admin, full_name="Admin")
    admin = await login(client, "admin")
    async with SessionLocal() as s:
        first = await s.get(Section, c["sec"])
        assert first is not None
        other = Section(
            department_id=first.department_id, semester=5, name="B", academic_year="2026-27"
        )
        s.add(other)
        await s.flush()
        subject_id = await s.scalar(select(FacultyAssignment.subject_id))
        s.add(FacultyAssignment(faculty_id=c["fac_id"], section_id=other.id, subject_id=subject_id))
        s.add(StudentSection(student_id=c["outsider_id"], section_id=other.id))
        await s.commit()
        b_id = other.id
    act = await make_quiz(client, c["fac"])
    asg = await assign(client, c["fac"], act["id"], section_ids=[c["sec"], b_id])
    started = await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["out"])
    assert started.status_code in (200, 201), started.text

    a_imp = (await client.get(f"{A}/sections/{c['sec']}/delete-impact", headers=admin)).json()
    b_imp = (await client.get(f"{A}/sections/{b_id}/delete-impact", headers=admin)).json()
    assert a_imp["counts"]["attempts"] == 0 and a_imp["blocked"] is None
    assert b_imp["counts"]["attempts"] == 1 and b_imp["blocked"]
    assert (await client.delete(f"{A}/sections/{b_id}", headers=admin)).status_code == 409
    assert (await client.delete(f"{A}/sections/{c['sec']}", headers=admin)).status_code == 204
    async with SessionLocal() as s:
        assert await s.scalar(select(func.count()).select_from(Attempt)) == 1


async def test_section_without_work_is_deleted(client: AsyncClient) -> None:
    c = await setup_class(client)
    await make_user("admin", Role.admin, full_name="Admin")
    admin = await login(client, "admin")
    assert (await client.delete(f"{A}/sections/{c['sec']}", headers=admin)).status_code == 204
    assert (await client.delete(f"{A}/sections/{c['sec']}", headers=admin)).status_code == 404
    async with SessionLocal() as s:
        assert await s.scalar(select(func.count()).select_from(StudentSection)) == 0
        assert await s.scalar(select(func.count()).select_from(FacultyAssignment)) == 0
    # the students themselves stay
    assert (await client.get(f"{A}/auth/me", headers=c["s1"])).status_code == 200
    log = await _audit("section_deleted")
    assert len(log) == 1 and log[0].target is not None and "CSE Sem 5 A" in log[0].target


async def test_subject_delete_takes_its_teacher_mappings(client: AsyncClient) -> None:
    c = await setup_class(client)
    await make_user("admin", Role.admin, full_name="Admin")
    admin = await login(client, "admin")
    _, sub = await _ids(client, admin)
    imp = (await client.get(f"{A}/subjects/{sub}/delete-impact", headers=admin)).json()
    assert imp["counts"]["teacher_mappings"] == 1 and imp["blocked"] is None
    assert (await client.delete(f"{A}/subjects/{sub}", headers=admin)).status_code == 204
    assert (await client.get(f"{A}/subjects", headers=admin)).json() == []
    async with SessionLocal() as s:
        assert await s.scalar(select(func.count()).select_from(FacultyAssignment)) == 0
    assert (await client.get(f"{A}/subjects/{sub}/delete-impact", headers=admin)).status_code == 404
    assert len(await _audit("subject_deleted")) == 1
    assert c["sec"]


async def test_department_goes_only_when_empty(client: AsyncClient) -> None:
    c = await setup_class(client)
    await make_user("admin", Role.admin, full_name="Admin")
    admin = await login(client, "admin")
    dept, _ = await _ids(client, admin)

    imp = (await client.get(f"{A}/departments/{dept}/delete-impact", headers=admin)).json()
    assert imp["counts"]["sections"] == 1 and "still has 1 sections" in imp["blocked"]
    r = await client.delete(f"{A}/departments/{dept}", headers=admin)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "in_use"

    assert (await client.delete(f"{A}/sections/{c['sec']}", headers=admin)).status_code == 204
    # a person in the department also blocks it
    made = await client.post(
        f"{A}/users",
        headers=admin,
        json={
            "username": "EMP77",
            "full_name": "Dr Iyer",
            "email": "iyer@college.edu",
            "role": "faculty",
            "department_id": dept,
        },
    )
    assert made.status_code == 201, made.text
    imp = (await client.get(f"{A}/departments/{dept}/delete-impact", headers=admin)).json()
    assert imp["counts"]["people"] == 1 and imp["blocked"]
    assert (await client.delete(f"{A}/departments/{dept}", headers=admin)).status_code == 409

    # an empty one goes
    fresh = await client.post(
        f"{A}/departments", headers=admin, json={"code": "TMP", "name": "Temporary"}
    )
    assert fresh.status_code == 201
    tid = fresh.json()["id"]
    assert (await client.delete(f"{A}/departments/{tid}", headers=admin)).status_code == 204
    codes = [d["code"] for d in (await client.get(f"{A}/departments", headers=admin)).json()]
    assert codes == ["CSE"]
    log = await _audit("department_deleted")
    assert len(log) == 1 and log[0].target == "TMP"
