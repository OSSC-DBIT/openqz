"""User details and several departments, instructions, scheduled start (not started + emails),
admin statistics with export, API docs closed outside development."""

import io
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from openpyxl import load_workbook
from sqlalchemy import update

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.main import create_app
from app.models import ActivityAssignment, Department, Role, Section
from app.services import email
from app.worker import tasks
from tests.conftest import email_for, login, make_user
from tests.test_activities import A, answer_all_correctly, assign, make_quiz, setup_class


@pytest.fixture
def mail(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[email.Mail]]:
    box: list[email.Mail] = []
    monkeypatch.setattr(get_settings(), "smtp_host", "mailpit")
    monkeypatch.setattr(email, "outbox", box)
    yield box


async def _org() -> dict[str, int]:
    async with SessionLocal() as s:
        cse, ece = Department(code="CSE", name="Computer Science"), Department(code="ECE", name="E")
        s.add_all([cse, ece])
        await s.flush()
        a = Section(department_id=cse.id, semester=3, name="A", academic_year="2026-27")
        b = Section(department_id=cse.id, semester=3, name="B", academic_year="2026-27")
        s.add_all([a, b])
        await s.commit()
        return {"cse": cse.id, "ece": ece.id, "a": a.id, "b": b.id}


# ---------------------------------------------------------------- users


async def test_user_details_and_several_departments(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    o = await _org()
    r = await client.post(
        f"{A}/users",
        headers=admin_headers,
        json={
            "username": "EMP7",
            "full_name": "Dr Maths",
            "email": "maths@test.dev",
            "role": "faculty",
            "phone": "+91 98765 43210",
            "designation": "  Associate Professor ",
            "department_ids": [o["ece"], o["cse"]],
        },
    )
    assert r.status_code == 201, r.text
    u = r.json()["user"]
    assert u["phone"] == "+91 98765 43210" and u["designation"] == "Associate Professor"
    assert u["department_id"] == o["ece"] and u["department_ids"] == [o["ece"], o["cse"]]

    # listed under both departments, and found by phone
    for d in (o["cse"], o["ece"]):
        page = (await client.get(f"{A}/users?department_id={d}", headers=admin_headers)).json()
        assert [x["username"] for x in page["items"]] == ["EMP7"]
    found = (await client.get(f"{A}/users?q=98765", headers=admin_headers)).json()
    assert found["total"] == 1

    # edit: drop one department, clear the phone
    r = await client.patch(
        f"{A}/users/{u['id']}",
        headers=admin_headers,
        json={"department_ids": [o["cse"]], "phone": ""},
    )
    assert r.status_code == 200, r.text
    assert r.json()["department_ids"] == [o["cse"]] and r.json()["phone"] is None
    assert r.json()["designation"] == "Associate Professor"  # untouched fields stay

    bad_phone = await client.patch(
        f"{A}/users/{u['id']}", headers=admin_headers, json={"phone": "call me"}
    )
    assert bad_phone.status_code == 422
    unknown = await client.patch(
        f"{A}/users/{u['id']}", headers=admin_headers, json={"department_ids": [9999]}
    )
    assert unknown.status_code == 400


async def test_student_gets_a_section_and_only_one_department(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    o = await _org()
    r = await client.post(
        f"{A}/users",
        headers=admin_headers,
        json={
            "username": "1DB26CS001",
            "full_name": "Asha",
            "email": "asha@test.dev",
            "role": "student",
            "section_id": o["a"],
        },
    )
    assert r.status_code == 201, r.text
    u = r.json()["user"]
    # the department comes from the section
    assert u["section_id"] == o["a"] and u["section_label"] == "CSE Sem 3 A"
    assert u["department_ids"] == [o["cse"]]

    # moving to another section of the same year replaces the old one
    moved = await client.patch(
        f"{A}/users/{u['id']}", headers=admin_headers, json={"section_id": o["b"]}
    )
    assert moved.json()["section_label"] == "CSE Sem 3 B"
    in_a = (await client.get(f"{A}/users?section_id={o['a']}", headers=admin_headers)).json()
    assert in_a["total"] == 0

    two = await client.patch(
        f"{A}/users/{u['id']}",
        headers=admin_headers,
        json={"department_ids": [o["cse"], o["ece"]]},
    )
    assert two.status_code == 400 and "more than one department" in two.text

    # a section is for students only
    fac = await client.post(
        f"{A}/users",
        headers=admin_headers,
        json={
            "username": "EMP8",
            "full_name": "X",
            "email": "x@test.dev",
            "role": "faculty",
            "section_id": o["a"],
        },
    )
    assert fac.status_code == 400
    assert (await client.get(f"{A}/users?q=EMP8", headers=admin_headers)).json()["total"] == 0


# ---------------------------------------------------------------- scheduled start


async def test_scheduled_activity_shows_not_started_and_emails_when_it_opens(
    client: AsyncClient, mail: list[email.Mail]
) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    start = datetime.now(UTC) + timedelta(hours=2)
    asg = await assign(
        client,
        c["fac"],
        act["id"],
        section_ids=[c["sec"]],
        start_at=start.isoformat(),
        due_at=(start + timedelta(days=1)).isoformat(),
        instructions="  Keep a calculator ready.\nNo negative marks. ",
    )
    assert asg["instructions"] == "Keep a calculator ready.\nNo negative marks."

    # the "assigned" email says when it opens and carries the instructions
    assert len(mail) == 2
    assert "Opens:" in mail[0].text and "Keep a calculator ready." in mail[0].text
    assert "No negative marks." in mail[0].html
    mail.clear()

    # the student sees it under Pending, as not started, and cannot start it
    mine = (await client.get(f"{A}/me/activities", headers=c["s1"])).json()
    item = mine["pending"][0]
    assert item["window"] == "not_started" and item["can_start"] is False
    assert item["instructions"].startswith("Keep a calculator")
    early = await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])
    assert early.status_code >= 400 and early.json()["detail"]["code"] == "not_started"

    # nothing is sent before the start time
    assert await tasks.notify_started({}) == 0 and mail == []

    # the start time comes
    async with SessionLocal() as s:
        await s.execute(
            update(ActivityAssignment)
            .where(ActivityAssignment.id == asg["id"])
            .values(start_at=datetime.now(UTC) - timedelta(seconds=30))
        )
        await s.commit()
    assert await tasks.notify_started({}) == 2
    assert sorted(m.to for m in mail) == [email_for("1DB23CS001"), email_for("1DB23CS002")]
    assert mail[0].subject == "Open now: Unit 1"
    mail.clear()
    assert await tasks.notify_started({}) == 0 and mail == []  # once only

    started = await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])
    assert started.status_code == 200 and started.json()["instructions"].startswith("Keep")


async def test_an_activity_open_at_once_gets_no_started_email(
    client: AsyncClient, mail: list[email.Mail]
) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    await assign(client, c["fac"], act["id"], section_ids=[c["sec"]])
    assert len(mail) == 2 and "Opens:" not in mail[0].text
    mail.clear()
    assert await tasks.notify_started({}) == 0 and mail == []


async def test_scheduled_without_emails_is_marked_and_stays_silent(
    client: AsyncClient, mail: list[email.Mail]
) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    asg = await assign(
        client,
        c["fac"],
        act["id"],
        section_ids=[c["sec"]],
        start_at=(datetime.now(UTC) + timedelta(hours=1)).isoformat(),
        notify=False,
    )
    async with SessionLocal() as s:
        await s.execute(
            update(ActivityAssignment)
            .where(ActivityAssignment.id == asg["id"])
            .values(start_at=datetime.now(UTC) - timedelta(seconds=30))
        )
        await s.commit()
    assert await tasks.notify_started({}) == 0 and mail == []
    async with SessionLocal() as s:
        row = await s.get(ActivityAssignment, asg["id"])
        assert row is not None and row.start_notified_at is not None


async def test_room_preview_shows_instructions(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    room = await assign(client, c["fac"], act["id"], room=True, instructions="Phones on silent")
    p = (await client.get(f"{A}/join/{room['join_code']}", headers=c["out"])).json()
    assert p["instructions"] == "Phones on silent" and p["window"] == "open"


# ---------------------------------------------------------------- admin statistics


async def _used_class(client: AsyncClient) -> dict[str, Any]:
    """One class assignment (1 of 2 students submitted) and one room (1 player, not started)."""
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    asg = await assign(client, c["fac"], act["id"], section_ids=[c["sec"]])
    st = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])).json()
    await answer_all_correctly(client, c["s1"], st["attempt_id"], st["total"])
    await client.post(f"{A}/attempts/{st['attempt_id']}/submit", headers=c["s1"])
    room = await assign(client, c["fac"], act["id"], room=True)
    await client.post(f"{A}/join", headers=c["out"], json={"code": room["join_code"]})
    return c


async def test_admin_stats_by_department_and_teacher(client: AsyncClient) -> None:
    c = await _used_class(client)
    await make_user("admin", Role.admin, full_name="Admin")
    admin = await login(client, "admin")
    await make_user("CLUB1", Role.club, full_name="Coding Club")

    r = await client.get(f"{A}/admin/stats", headers=admin)
    assert r.status_code == 200, r.text
    s = r.json()

    (cse,) = s["departments"]
    assert cse["code"] == "CSE" and cse["sections"] == 1
    assert (cse["assignments"], cse["assigned"], cse["submitted"]) == (1, 2, 1)
    assert cse["completion"] == 50.0
    # 5 of 10 marks are auto-graded and correct; the other 5 wait for the teacher
    assert cse["avg_percent"] == 50.0

    rows = {f["username"]: f for f in s["faculty"]}
    assert set(rows) == {"EMP1", "CLUB1"}  # the admin made nothing, so no row
    rao = rows["EMP1"]
    assert (rao["activities"], rao["assignments"], rao["rooms"], rao["classes"]) == (1, 1, 1, 1)
    assert (rao["assigned"], rao["submitted"]) == (3, 1)  # 2 in the class + 1 room player
    assert rao["pending_grading"] == 1 and rao["avg_percent"] == 50.0
    assert rows["CLUB1"]["activities"] == 0 and rows["CLUB1"]["completion"] is None

    t = s["totals"]
    assert (t["activities"], t["assignments"], t["rooms"], t["faculty"], t["clubs"]) == (
        1,
        1,
        1,
        1,
        1,
    )
    assert t["students"] == 3 and t["submitted"] == 1

    # a day range before anything was assigned
    old = (await client.get(f"{A}/admin/stats?date_to=2020-01-01", headers=admin)).json()
    assert old["totals"]["assignments"] == 0 and old["departments"][0]["assigned"] == 0
    assert old["faculty"][0]["activities"] == 0

    # only the admin
    assert (await client.get(f"{A}/admin/stats", headers=c["fac"])).status_code == 403
    assert (await client.get(f"{A}/admin/stats.xlsx", headers=c["s1"])).status_code == 403


async def test_admin_stats_exports(client: AsyncClient) -> None:
    await _used_class(client)
    await make_user("admin", Role.admin, full_name="Admin")
    admin = await login(client, "admin")

    csv_d = await client.get(f"{A}/admin/stats.csv", headers=admin)
    assert csv_d.status_code == 200 and "text/csv" in csv_d.headers["content-type"]
    lines = csv_d.text.lstrip("﻿").splitlines()
    assert lines[0].startswith("Department,Name,Students") and lines[1].startswith("CSE,CSE,")

    csv_f = await client.get(f"{A}/admin/stats.csv?sheet=faculty", headers=admin)
    assert "Dr Rao,EMP1," in csv_f.text
    assert 'filename="openqz-stats-faculty.csv"' in csv_f.headers["content-disposition"]

    x = await client.get(f"{A}/admin/stats.xlsx", headers=admin)
    assert x.status_code == 200
    wb = load_workbook(io.BytesIO(x.content))
    assert wb.sheetnames == ["Summary", "Departments", "Faculty"]
    assert wb["Departments"]["A2"].value == "CSE"
    assert wb["Faculty"]["A2"].value == "Dr Rao"
    summary = {row[0].value: row[1].value for row in wb["Summary"].iter_rows()}
    assert summary["Submitted"] == 1 and summary["Rooms"] == 1


# ---------------------------------------------------------------- API docs


@pytest.mark.parametrize(("environment", "code"), [("development", 200), ("production", 404)])
async def test_api_docs_are_closed_outside_development(
    monkeypatch: pytest.MonkeyPatch, environment: str, code: int
) -> None:
    monkeypatch.setattr(get_settings(), "environment", environment)
    app = create_app(with_worker_pool=False)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        assert (await c.get("/api/docs")).status_code == code
        assert (await c.get("/api/openapi.json")).status_code == code
        assert (await c.get("/api/v1/health")).status_code == 200


# ---------------------------------------------------------------- logic and security fixes

V = {"kind": "visibility_hidden", "session_id": "sess-12345678"}


async def test_reset_password_is_rate_limited(client: AsyncClient) -> None:
    body = {"token": "x" * 43, "new_password": "N3w-Passw0rd!x"}
    codes = [(await client.post(f"{A}/auth/reset", json=body)).status_code for _ in range(21)]
    assert codes[:20] == [400] * 20  # a wrong link, answered normally
    assert codes[20] == 429


async def test_questions_are_locked_once_a_student_started(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    asg = await assign(client, c["fac"], act["id"], section_ids=[c["sec"]])
    q = act["questions"][0]
    url = f"{A}/activities/{act['id']}/questions"
    edit = {"type": "true_false", "stem": "Changed", "answer": {"value": True}}
    # before anyone starts, editing is fine
    assert (await client.put(f"{url}/{q['id']}", headers=c["fac"], json=edit)).status_code == 200

    await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])
    for r in (
        await client.put(f"{url}/{q['id']}", headers=c["fac"], json=edit),
        await client.post(url, headers=c["fac"], json=edit),
        await client.delete(f"{url}/{q['id']}", headers=c["fac"]),
        await client.post(
            f"{A}/activities/{act['id']}/apply-all", headers=c["fac"], json={"marks": 5}
        ),
    ):
        assert r.status_code == 409 and r.json()["detail"]["code"] == "has_attempts"
    # a copy is free to change
    copy = (await client.post(f"{A}/activities/{act['id']}/duplicate", headers=c["fac"])).json()
    again = await client.post(f"{A}/activities/{copy['id']}/questions", headers=c["fac"], json=edit)
    assert again.status_code == 201


async def test_a_teacher_sees_only_their_own_integrity_events(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    asg = await assign(client, c["fac"], act["id"], section_ids=[c["sec"]])
    st = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])).json()
    await client.post(f"{A}/attempts/{st['attempt_id']}/violations", headers=c["s1"], json=V)

    await make_user("EMP2", Role.faculty, full_name="Dr Other")
    other = await login(client, "EMP2")
    await make_user("admin", Role.admin, full_name="Admin")
    admin = await login(client, "admin")
    assert len((await client.get(f"{A}/integrity/events", headers=c["fac"])).json()) == 1
    assert (await client.get(f"{A}/integrity/events", headers=other)).json() == []
    assert len((await client.get(f"{A}/integrity/events", headers=admin)).json()) == 1


async def test_a_new_deadline_reaches_attempts_in_progress(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    asg = await assign(client, c["fac"], act["id"], section_ids=[c["sec"]])  # no deadline, no timer
    st = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])).json()
    assert st["deadline_at"] is None

    due = datetime.now(UTC) + timedelta(minutes=30)
    r = await client.patch(
        f"{A}/activity-assignments/{asg['id']}", headers=c["fac"], json={"due_at": due.isoformat()}
    )
    assert r.status_code == 200, r.text
    state = (await client.get(f"{A}/attempts/{st['attempt_id']}", headers=c["s1"])).json()
    assert datetime.fromisoformat(state["deadline_at"]) == due

    # extended: the student gets the extra time too
    later = due + timedelta(hours=1)
    await client.patch(
        f"{A}/activity-assignments/{asg['id']}",
        headers=c["fac"],
        json={"due_at": later.isoformat()},
    )
    state = (await client.get(f"{A}/attempts/{st['attempt_id']}", headers=c["s1"])).json()
    assert datetime.fromisoformat(state["deadline_at"]) == later


async def test_a_blocked_student_sees_no_key_while_they_may_be_let_back_in(
    client: AsyncClient,
) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    asg = await assign(client, c["fac"], act["id"], section_ids=[c["sec"]], max_violations=1)
    st = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])).json()
    out = await client.post(f"{A}/attempts/{st['attempt_id']}/violations", headers=c["s1"], json=V)
    assert out.json()["submitted"] is True

    rv = (await client.get(f"{A}/attempts/{st['attempt_id']}/review", headers=c["s1"])).json()
    assert rv["submit_reason"] == "violations"
    assert rv["scores_visible"] is False and rv["answers_visible"] is False and rv["score"] is None
    assert all("key" not in i and "correct" not in i for i in rv["items"])
    mine = (await client.get(f"{A}/me/activities", headers=c["s1"])).json()
    assert all(x["score"] is None for x in mine["pending"] + mine["completed"])

    # once the activity is over nobody can be let back in, so the usual review rules apply
    async with SessionLocal() as s:
        await s.execute(
            update(ActivityAssignment)
            .where(ActivityAssignment.id == asg["id"])
            .values(due_at=datetime.now(UTC) - timedelta(minutes=1))
        )
        await s.commit()
    rv = (await client.get(f"{A}/attempts/{st['attempt_id']}/review", headers=c["s1"])).json()
    assert rv["scores_visible"] is True and "key" in rv["items"][0]


async def test_resume_still_works_after_the_teacher_unpublishes(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    asg = await assign(client, c["fac"], act["id"], section_ids=[c["sec"]])
    st = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])).json()
    await client.post(f"{A}/activities/{act['id']}/unpublish", headers=c["fac"])
    again = await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])
    assert again.status_code == 200 and again.json()["attempt_id"] == st["attempt_id"]
    # but nobody new can start
    new = await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s2"])
    assert new.status_code == 403 and new.json()["detail"]["code"] == "unavailable"


async def test_two_students_with_the_same_name_join_a_live_game(client: AsyncClient) -> None:
    c = await setup_class(client)
    await make_user("1DB23CS050", full_name="Asha")  # same name as student 1
    twin = await login(client, "1DB23CS050")
    act = await make_quiz(client, c["fac"])
    g = (
        await client.post(f"{A}/live/games", headers=c["fac"], json={"activity_id": act["id"]})
    ).json()
    one = await client.post(f"{A}/live/join", headers=c["s1"], json={"code": g["code"]})
    two = await client.post(f"{A}/live/join", headers=twin, json={"code": g["code"]})
    assert one.status_code == 200 and two.status_code == 200, two.text
    assert (one.json()["nickname"], two.json()["nickname"]) == ("Asha", "Asha (2)")


async def test_api_answers_cannot_be_framed_or_loaded_cross_origin(client: AsyncClient) -> None:
    r = await client.get(f"{A}/health")
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["cross-origin-resource-policy"] == "same-origin"
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
    # a site that is not on the list gets no CORS permission
    pre = await client.options(
        f"{A}/auth/login",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in pre.headers


def test_production_refuses_open_cors() -> None:
    from app.core.config import Settings

    base: dict[str, Any] = {"jwt_secret": "x" * 32, "environment": "production"}
    for bad in ("*", "http://openqz.example.org", "https://openqz.example.org/"):
        with pytest.raises(ValueError, match="CORS_ORIGINS"):
            Settings(**base, cors_origins=[bad])
    ok = Settings(**base, cors_origins=["https://openqz.example.org"])
    assert ok.is_production
