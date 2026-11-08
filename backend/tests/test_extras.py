"""Rubrics, password reset by email, notifications, audit log, class context, Excel export."""

import io
from collections.abc import Iterator
from decimal import Decimal
from typing import Any

import pytest
from httpx import AsyncClient
from openpyxl import load_workbook

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.models import Department, FacultyAssignment, Role, Section, Subject, User
from app.services import email
from tests.conftest import PASSWORD, email_for, login, make_user
from tests.test_activities import A, assign, by_stem, make_quiz, setup_class


@pytest.fixture
def mail(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[email.Mail]]:
    """Turn email on and capture messages instead of sending them."""
    box: list[email.Mail] = []
    monkeypatch.setattr(get_settings(), "smtp_host", "mailpit")
    monkeypatch.setattr(email, "outbox", box)
    yield box


# ---------------------------------------------------------------- rubric


async def test_rubric_validation_and_grading(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = (await client.post(f"{A}/activities", headers=c["fac"], json={"title": "Essay"})).json()
    base = {"type": "open_ended", "stem": "Explain TCP", "marks": 5}
    bad_sum = await client.post(
        f"{A}/activities/{act['id']}/questions",
        headers=c["fac"],
        json={
            **base,
            "rubric": [{"criterion": "Accuracy", "max": 3}, {"criterion": "Clarity", "max": 1}],
        },
    )
    assert bad_sum.status_code == 422 and "add up to 4" in bad_sum.text
    bad_type = await client.post(
        f"{A}/activities/{act['id']}/questions",
        headers=c["fac"],
        json={
            "type": "mcq",
            "stem": "x",
            "marks": 1,
            "rubric": [{"criterion": "a", "max": 1}],
            "options": [{"text": "a", "correct": True}, {"text": "b"}],
        },
    )
    assert bad_type.status_code == 422
    ok = await client.post(
        f"{A}/activities/{act['id']}/questions",
        headers=c["fac"],
        json={
            **base,
            "rubric": [{"criterion": "Accuracy", "max": 3}, {"criterion": "Clarity", "max": 2}],
        },
    )
    assert ok.status_code == 201, ok.text
    rubric = ok.json()["rubric"]
    assert [r["id"] for r in rubric] == ["c1", "c2"]

    asg = await assign(client, c["fac"], act["id"], section_ids=[c["sec"]])
    st = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])).json()
    q0 = (await client.get(f"{A}/attempts/{st['attempt_id']}/questions/0", headers=c["s1"])).json()
    assert "rubric" not in q0["question"]  # marking scheme stays with the teacher
    await client.put(
        f"{A}/attempts/{st['attempt_id']}/answers/{q0['question']['id']}",
        headers=c["s1"],
        json={"response": {"text": "Reliable stream"}},
    )
    await client.post(f"{A}/attempts/{st['attempt_id']}/submit", headers=c["s1"])

    queue = (
        await client.get(f"{A}/activity-assignments/{asg['id']}/grading", headers=c["fac"])
    ).json()
    assert queue[0]["rubric"][0]["criterion"] == "Accuracy"
    url = (
        f"{A}/activity-assignments/attempts/{st['attempt_id']}/answers/{q0['question']['id']}/grade"
    )
    assert (
        await client.put(url, headers=c["fac"], json={"rubric_scores": {"c1": 3}})
    ).status_code == 400
    assert (
        await client.put(url, headers=c["fac"], json={"rubric_scores": {"c1": 4, "c2": 1}})
    ).status_code == 400
    r = await client.put(
        url, headers=c["fac"], json={"rubric_scores": {"c1": 2.5, "c2": 1}, "feedback": "ok"}
    )
    assert r.status_code == 200 and Decimal(r.json()["score"]) == Decimal("3.5")

    rv = (await client.get(f"{A}/attempts/{st['attempt_id']}/review", headers=c["s1"])).json()
    assert [x["score"] for x in rv["items"][0]["rubric"]] == ["2.5", "1"]


async def test_apply_all_marks_clears_rubric(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = (await client.post(f"{A}/activities", headers=c["fac"], json={"title": "E"})).json()
    await client.post(
        f"{A}/activities/{act['id']}/questions",
        headers=c["fac"],
        json={
            "type": "open_ended",
            "stem": "x",
            "marks": 2,
            "rubric": [{"criterion": "a", "max": 2}],
        },
    )
    r = (
        await client.post(
            f"{A}/activities/{act['id']}/apply-all", headers=c["fac"], json={"marks": 4}
        )
    ).json()
    assert r["questions"][0]["rubric"] == [] and Decimal(r["questions"][0]["marks"]) == 4


# ---------------------------------------------------------------- password reset


async def test_forgot_password_flow(client: AsyncClient, mail: list[email.Mail]) -> None:
    await make_user("1DB23CS001", email="asha@gmail.com")
    cfg = (await client.get(f"{A}/auth/config")).json()
    assert cfg["password_reset_email"] is True

    known = await client.post(f"{A}/auth/forgot", json={"email": "ASHA@gmail.com"})
    unknown = await client.post(f"{A}/auth/forgot", json={"email": "nobody@gmail.com"})
    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json()  # no account enumeration
    assert len(mail) == 1 and mail[0].to == "asha@gmail.com"
    link = next(w for w in mail[0].text.split() if "reset-password?token=" in w)
    token = link.split("token=")[1]

    weak = await client.post(f"{A}/auth/reset", json={"token": token, "new_password": "weakpass"})
    assert weak.status_code == 400
    ok = await client.post(f"{A}/auth/reset", json={"token": token, "new_password": "NewSecret9"})
    assert ok.status_code == 200 and ok.json()["user"]["must_change_password"] is False
    again = await client.post(
        f"{A}/auth/reset", json={"token": token, "new_password": "Other9Pass"}
    )
    assert again.status_code == 400  # single use
    login_ok = await client.post(
        f"{A}/auth/login", json={"email": "asha@gmail.com", "password": "NewSecret9"}
    )
    assert login_ok.status_code == 200
    old = await client.post(
        f"{A}/auth/login", json={"email": "asha@gmail.com", "password": PASSWORD}
    )
    assert old.status_code == 401


async def test_forgot_is_throttled_per_email(client: AsyncClient, mail: list[email.Mail]) -> None:
    await make_user("stud1")
    for _ in range(5):
        await client.post(f"{A}/auth/forgot", json={"email": email_for("stud1")})
    assert len(mail) == 3


async def test_forgot_disabled_without_smtp(client: AsyncClient) -> None:
    assert (await client.get(f"{A}/auth/config")).json()["password_reset_email"] is False
    assert (await client.post(f"{A}/auth/forgot", json={"email": "a@b.co"})).status_code == 404


# ---------------------------------------------------------------- notifications


async def test_assign_and_release_send_emails(client: AsyncClient, mail: list[email.Mail]) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    asg = await assign(client, c["fac"], act["id"], section_ids=[c["sec"]], release_mode="manual")
    assert sorted(m.to for m in mail) == [email_for("1DB23CS001"), email_for("1DB23CS002")]
    assert "Unit 1" in mail[0].subject and "Dr Rao" in mail[0].text
    mail.clear()
    await client.post(f"{A}/activity-assignments/{asg['id']}/release", headers=c["fac"])
    assert len(mail) == 2 and mail[0].subject.startswith("Marks released")
    mail.clear()
    await client.post(f"{A}/activity-assignments/{asg['id']}/release", headers=c["fac"])
    assert mail == []  # only the first release notifies

    quiet = await assign(client, c["fac"], act["id"], section_ids=[c["sec"]], notify=False)
    assert quiet["notify"] is False and mail == []


# ---------------------------------------------------------------- audit log


async def test_audit_log(client: AsyncClient, admin_headers: dict[str, str]) -> None:
    await make_user("stud2")
    await client.post(f"{A}/auth/login", json={"email": email_for("stud2"), "password": "bad"})
    log = (await client.get(f"{A}/audit?action=login_failed", headers=admin_headers)).json()
    assert log["total"] >= 1 and log["items"][0]["action"] == "login_failed"
    actions = (await client.get(f"{A}/audit/actions", headers=admin_headers)).json()
    assert "login" in actions and "login_failed" in actions
    s = await login(client, "stud2")
    assert (await client.get(f"{A}/audit", headers=s)).status_code == 403


# ---------------------------------------------------------------- class context


async def _faculty_with_classes() -> dict[str, Any]:
    async with SessionLocal() as s:
        cse = Department(code="CSE", name="CSE")
        ise = Department(code="ISE", name="ISE")
        s.add_all([cse, ise])
        await s.flush()
        s3a = Section(department_id=cse.id, semester=3, name="A", academic_year="2026-27")
        s5b = Section(department_id=cse.id, semester=5, name="B", academic_year="2026-27")
        other = Section(department_id=ise.id, semester=5, name="A", academic_year="2026-27")
        ise3 = Section(department_id=ise.id, semester=3, name="C", academic_year="2026-27")
        sub = Subject(code="BCS301", name="DS")
        s.add_all([s3a, s5b, other, ise3, sub])
        await s.flush()
        fac = User(
            username="EMPC1",
            email="empc1@test.dev",
            full_name="Dr C",
            role=Role.faculty,
            department_id=cse.id,
            password_hash="x",
            must_change_password=False,
        )
        s.add(fac)
        await s.flush()
        s.add_all(
            [
                FacultyAssignment(faculty_id=fac.id, section_id=s3a.id, subject_id=sub.id),
                FacultyAssignment(faculty_id=fac.id, section_id=s5b.id, subject_id=sub.id),
                # also teaches one ISE class (another branch)
                FacultyAssignment(faculty_id=fac.id, section_id=ise3.id, subject_id=sub.id),
            ]
        )
        await s.commit()
        return {
            "cse": cse.id,
            "ise": ise.id,
            "s3a": s3a.id,
            "s5b": s5b.id,
            "other": other.id,
            "ise3": ise3.id,
        }


async def test_activity_class_context(client: AsyncClient) -> None:
    ids = await _faculty_with_classes()
    from app.core.security import hash_password

    async with SessionLocal() as s:
        from sqlalchemy import update

        await s.execute(
            update(User)
            .where(User.username == "EMPC1")
            .values(password_hash=hash_password(PASSWORD))
        )
        await s.commit()
    h = await login(client, "EMPC1")

    opts = (await client.get(f"{A}/me/classes", headers=h)).json()
    assert opts["department"]["code"] == "CSE"
    assert [b["code"] for b in opts["branches"]] == ["CSE", "ISE"]
    assert [c["label"] for c in opts["classes"]] == ["CSE Sem 3 A", "ISE Sem 3 C", "CSE Sem 5 B"]
    assert opts["classes"][0]["subjects"][0]["code"] == "BCS301"

    # several semesters and sections in one go; one branch -> that department
    a = (
        await client.post(
            f"{A}/activities",
            headers=h,
            json={"title": "DS quiz", "section_ids": [ids["s5b"], ids["s3a"]]},
        )
    ).json()
    assert a["department_id"] == ids["cse"]
    assert a["semesters"] == [3, 5]
    assert a["class_labels"] == ["CSE Sem 3 A", "CSE Sem 5 B"]

    other = await client.post(
        f"{A}/activities", headers=h, json={"title": "x", "section_ids": [ids["s3a"], ids["other"]]}
    )
    assert other.status_code == 403  # does not teach that ISE section

    # mixing branches the teacher does teach is fine; the activity has no single department
    mixed = (
        await client.post(
            f"{A}/activities",
            headers=h,
            json={"title": "Mixed", "section_ids": [ids["s3a"], ids["ise3"]]},
        )
    ).json()
    assert mixed["department_id"] is None
    assert mixed["class_labels"] == ["CSE Sem 3 A", "ISE Sem 3 C"]
    ise_only = (await client.get(f"{A}/activities?department_id={ids['ise']}", headers=h)).json()
    assert [x["title"] for x in ise_only] == ["Mixed"]

    await client.post(
        f"{A}/activities", headers=h, json={"title": "Sem 5 only", "section_ids": [ids["s5b"]]}
    )
    sem3 = (await client.get(f"{A}/activities?semester=3", headers=h)).json()
    assert sorted(x["title"] for x in sem3) == ["DS quiz", "Mixed"]
    sec5 = (await client.get(f"{A}/activities?section_id={ids['s5b']}", headers=h)).json()
    assert sorted(x["title"] for x in sec5) == ["DS quiz", "Sem 5 only"]

    moved = (
        await client.patch(
            f"{A}/activities/{a['id']}", headers=h, json={"section_ids": [ids["s5b"]]}
        )
    ).json()
    assert moved["semesters"] == [5] and moved["class_labels"] == ["CSE Sem 5 B"]

    dup = (await client.post(f"{A}/activities/{a['id']}/duplicate", headers=h)).json()
    assert dup["section_ids"] == [ids["s5b"]]


# ---------------------------------------------------------------- Excel export


async def test_results_xlsx(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    asg = await assign(client, c["fac"], act["id"], section_ids=[c["sec"]], instant_feedback=False)
    st = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])).json()
    q0 = (await client.get(f"{A}/attempts/{st['attempt_id']}/questions/0", headers=c["s1"])).json()
    await client.put(
        f"{A}/attempts/{st['attempt_id']}/answers/{q0['question']['id']}",
        headers=c["s1"],
        json={"response": {"choice": by_stem(q0, "4")}},
    )
    await client.post(f"{A}/attempts/{st['attempt_id']}/submit", headers=c["s1"])

    r = await client.get(f"{A}/activity-assignments/{asg['id']}/results.xlsx", headers=c["fac"])
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/vnd.openxmlformats")
    wb = load_workbook(io.BytesIO(r.content))
    assert wb.sheetnames == ["Summary", "Students", "Marks by question", "Questions"]
    students = list(wb["Students"].iter_rows(values_only=True))
    assert students[0][:2] == ("USN / ID", "Name")
    asha = next(row for row in students if row[0] == "1DB23CS001")
    assert asha[5] == 1.0 and asha[3] == "submitted"
    marks = list(wb["Marks by question"].iter_rows(values_only=True))
    assert marks[0][2] == "Q1" and marks[0][-1] == "Total"
    row = next(x for x in marks if x[0] == "1DB23CS001")
    assert row[2] == 1.0 and row[-1] == 1.0
    assert (
        await client.get(f"{A}/activity-assignments/{asg['id']}/results.xlsx", headers=c["s1"])
    ).status_code == 403
