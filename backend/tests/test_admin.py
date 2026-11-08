from httpx import AsyncClient

from app.models import Role
from tests.conftest import login, make_user


async def test_create_user_and_reset_password(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    r = await client.post(
        "/api/v1/users",
        headers=admin_headers,
        json={
            "username": "EMP100",
            "full_name": "Dr. Rao",
            "email": "Rao@College.edu",
            "role": "faculty",
        },
    )
    assert r.status_code == 201, r.text
    temp = r.json()["temporary_password"]
    uid = r.json()["user"]["id"]

    assert r.json()["user"]["email"] == "rao@college.edu"
    no_email = await client.post(
        "/api/v1/users",
        headers=admin_headers,
        json={"username": "EMP102", "full_name": "No Mail", "role": "faculty"},
    )
    assert no_email.status_code == 422

    dup = await client.post(
        "/api/v1/users",
        headers=admin_headers,
        json={
            "username": "EMP101",
            "full_name": "Dup",
            "email": "rao@college.edu",
            "role": "faculty",
        },
    )
    assert dup.status_code == 409

    fac = await client.post(
        "/api/v1/auth/login", json={"email": "rao@college.edu", "password": temp}
    )
    assert fac.json()["user"]["must_change_password"] is True

    reset = await client.post(f"/api/v1/users/{uid}/reset-password", headers=admin_headers)
    assert reset.status_code == 200
    new_temp = reset.json()["temporary_password"]
    assert new_temp != temp
    ok = await client.post(
        "/api/v1/auth/login", json={"email": "rao@college.edu", "password": new_temp}
    )
    assert ok.status_code == 200


async def test_deactivate_blocks_login(client: AsyncClient, admin_headers: dict[str, str]) -> None:
    u = await make_user("stud9")
    r = await client.patch(
        f"/api/v1/users/{u.id}", headers=admin_headers, json={"is_active": False}
    )
    assert r.status_code == 200
    bad = await client.post("/api/v1/auth/login", json={"email": "stud9@test.dev", "password": "x"})
    assert bad.status_code == 403


async def test_sections_subjects_assignments(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    d = await client.post(
        "/api/v1/departments", headers=admin_headers, json={"code": "cse", "name": "CSE"}
    )
    dept_id = d.json()["id"]
    s = await client.post(
        "/api/v1/sections",
        headers=admin_headers,
        json={"department_id": dept_id, "semester": 5, "name": "a", "academic_year": "2026-27"},
    )
    assert s.status_code == 201
    sec_id = s.json()["id"]
    sub = await client.post(
        "/api/v1/subjects", headers=admin_headers, json={"code": "bcs501", "name": "SE"}
    )
    fac = await make_user("EMP1", Role.faculty)
    stu = await make_user("1DB23CS010")

    a = await client.post(
        "/api/v1/assignments",
        headers=admin_headers,
        json={"faculty_id": str(fac.id), "section_id": sec_id, "subject_id": sub.json()["id"]},
    )
    assert a.status_code == 201, a.text
    assert a.json()["subject_code"] == "BCS501"

    add = await client.post(
        f"/api/v1/sections/{sec_id}/students",
        headers=admin_headers,
        json={"student_ids": [str(stu.id)]},
    )
    assert add.status_code == 204
    secs = await client.get("/api/v1/sections", headers=admin_headers)
    assert secs.json()[0]["student_count"] == 1

    fh = await login(client, "EMP1")
    teaching = await client.get("/api/v1/me/teaching", headers=fh)
    assert len(teaching.json()) == 1
    sh = await login(client, "1DB23CS010")
    mine = await client.get("/api/v1/me/sections", headers=sh)
    assert mine.json()[0]["name"] == "A"
