"""Regression tests for the end-to-end review: deletes that keep results, safe downloads,
who may be assigned work, input that used to answer 500, and integrity events."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from httpx import AsyncClient
from sqlalchemy import func, select

from app.core.db import SessionLocal
from app.models import IntegrityEvent, Role, Section, StudentSection, User
from app.services.export_safe import attachment, safe_cell
from tests.conftest import login, make_user
from tests.test_activities import A, assign, by_stem, make_quiz, setup_class

# ---------------------------------------------------------------- deletes


async def test_deleting_an_activity_keeps_its_live_game_results(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    game = await client.post(f"{A}/live/games", headers=c["fac"], json={"activity_id": act["id"]})
    assert game.status_code == 201, game.text

    gone = await client.delete(f"{A}/activities/{act['id']}", headers=c["fac"])
    assert gone.status_code == 204
    # archived, not deleted: the game and its results are still there
    kept = await client.get(f"{A}/live/games/{game.json()['id']}/results", headers=c["fac"])
    assert kept.status_code == 200
    still = await client.get(f"{A}/activities/{act['id']}", headers=c["fac"])
    assert still.status_code == 200 and still.json()["status"] == "archived"

    # an activity nobody played is really removed
    fresh = await make_quiz(client, c["fac"])
    assert (
        await client.delete(f"{A}/activities/{fresh['id']}", headers=c["fac"])
    ).status_code == 204
    assert (await client.get(f"{A}/activities/{fresh['id']}", headers=c["fac"])).status_code == 404


# ---------------------------------------------------------------- downloads


def test_spreadsheet_cells_cannot_start_a_formula() -> None:
    for bad in ("=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"):
        assert safe_cell(bad) == "'" + bad
    assert safe_cell("Asha") == "Asha" and safe_cell(4.5) == 4.5 and safe_cell(None) is None


def test_download_names_survive_non_latin_titles() -> None:
    h = attachment("ಗಣಿತ ಪರೀಕ್ಷೆ 1", "-results.csv")["Content-Disposition"]
    h.encode("latin-1")  # what the server does with every header
    assert 'filename="openqz-1-results.csv"' in h and "filename*=UTF-8''openqz-" in h
    assert (
        'filename="openqz-activity-results.csv"'
        in attachment("ಗಣಿತ", "-results.csv")["Content-Disposition"]
    )
    assert (
        'filename="openqz-Unit-1-results.xlsx"'
        in attachment("Unit 1!", "-results.xlsx")["Content-Disposition"]
    )


async def test_results_download_with_kannada_title_and_formula_name(client: AsyncClient) -> None:
    c = await setup_class(client)
    async with SessionLocal() as s:
        asha = await s.get(User, c["s1_id"])
        assert asha is not None
        asha.full_name = "=HYPERLINK(1)"
        await s.commit()
    act = await make_quiz(client, c["fac"], title="ಗಣಿತ ಪರೀಕ್ಷೆ")
    asg = await assign(client, c["fac"], act["id"], section_ids=[c["sec"]])
    st = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])).json()
    await client.post(f"{A}/attempts/{st['attempt_id']}/submit", headers=c["s1"])

    csv = await client.get(f"{A}/activity-assignments/{asg['id']}/results.csv", headers=c["fac"])
    assert csv.status_code == 200, csv.text
    assert "'=HYPERLINK(1)" in csv.text and ",=HYPERLINK(1)" not in csv.text
    xlsx = await client.get(f"{A}/activity-assignments/{asg['id']}/results.xlsx", headers=c["fac"])
    assert xlsx.status_code == 200
    assert "filename*=UTF-8''" in xlsx.headers["content-disposition"]


# ---------------------------------------------------------------- who gets work


async def test_teacher_assigns_only_to_students_of_their_sections(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    url = f"{A}/activities/{act['id']}/assign"
    # 1DB23CS099 is a real student, but in no section this teacher teaches
    no = await client.post(url, headers=c["fac"], json={"student_ids": [str(c["outsider_id"])]})
    assert no.status_code == 403, no.text
    yes = await client.post(url, headers=c["fac"], json={"student_ids": [str(c["s1_id"])]})
    assert yes.status_code == 201, yes.text
    # the outsider still gets in the usual way: a room and its code
    room = await client.post(url, headers=c["fac"], json={"room": True})
    assert room.status_code == 201


async def test_admin_assign_to_unknown_section_is_refused_not_a_crash(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    act = await make_quiz(client, admin_headers)
    r = await client.post(
        f"{A}/activities/{act['id']}/assign", headers=admin_headers, json={"section_ids": [987654]}
    )
    assert r.status_code == 400


async def test_adding_a_student_to_a_section_moves_them_within_the_year(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    c = await setup_class(client)
    async with SessionLocal() as s:
        first = await s.get(Section, c["sec"])
        assert first is not None
        b = Section(
            department_id=first.department_id, semester=5, name="B", academic_year="2026-27"
        )
        s.add(b)
        await s.commit()
        b_id = b.id
    r = await client.post(
        f"{A}/sections/{b_id}/students",
        headers=admin_headers,
        json={"student_ids": [str(c["s1_id"])]},
    )
    assert r.status_code == 204
    async with SessionLocal() as s:
        mine = (
            await s.scalars(
                select(StudentSection.section_id).where(StudentSection.student_id == c["s1_id"])
            )
        ).all()
    assert list(mine) == [b_id]  # one section per academic year, not two


# ---------------------------------------------------------------- input that used to be a 500


async def test_odd_input_is_refused_cleanly(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    url = f"{A}/activities/{act['id']}/assign"

    naive = await client.post(
        url, headers=c["fac"], json={"section_ids": [c["sec"]], "due_at": "2030-01-01T10:00:00"}
    )
    assert naive.status_code == 422  # a time without a zone is not a time

    asg = await assign(client, c["fac"], act["id"], section_ids=[c["sec"]])
    patched = await client.patch(
        f"{A}/activity-assignments/{asg['id']}",
        headers=c["fac"],
        json={"allow_late": None, "max_violations": None, "due_at": None},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["allow_late"] is False and patched.json()["max_violations"] == 3

    renamed = await client.patch(
        f"{A}/activities/{act['id']}", headers=c["fac"], json={"title": None, "description": "d"}
    )
    assert renamed.status_code == 200 and renamed.json()["title"] == "Unit 1"
    assert (
        await client.patch(
            f"{A}/activities/{act['id']}", headers=c["fac"], json={"subject_id": 424242}
        )
    ).status_code == 400
    assert (
        await client.post(
            f"{A}/activities", headers=c["fac"], json={"title": "x", "subject_id": 424242}
        )
    ).status_code == 400

    st = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])).json()
    q0 = (await client.get(f"{A}/attempts/{st['attempt_id']}/questions/0", headers=c["s1"])).json()
    bad_shapes: list[dict[str, Any]] = [{"choice": ["a"]}, {"choice": {"x": 1}}, {"choices": [{}]}]
    for response in bad_shapes:
        r = await client.put(
            f"{A}/attempts/{st['attempt_id']}/answers/{q0['question']['id']}",
            headers=c["s1"],
            json={"response": response, "final": False},
        )
        assert r.status_code == 422, (response, r.text)
    good = await client.put(
        f"{A}/attempts/{st['attempt_id']}/answers/{q0['question']['id']}",
        headers=c["s1"],
        json={"response": {"choice": by_stem(q0, "4")}, "final": False},
    )
    assert good.status_code == 200


async def test_grading_messages_say_marks(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    asg = await assign(client, c["fac"], act["id"], section_ids=[c["sec"]])
    st = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])).json()
    att = st["attempt_id"]
    open_q = next(q for q in act["questions"] if q["type"] == "open_ended")
    for i in range(st["total"]):
        q = (await client.get(f"{A}/attempts/{att}/questions/{i}", headers=c["s1"])).json()
        if q["question"]["type"] == "open_ended":
            await client.put(
                f"{A}/attempts/{att}/answers/{q['question']['id']}",
                headers=c["s1"],
                json={"response": {"text": "It calls itself"}, "final": False},
            )
    await client.post(f"{A}/attempts/{att}/submit", headers=c["s1"])
    url = f"{A}/activity-assignments/attempts/{att}/answers/{open_q['id']}/grade"
    too_many = await client.put(url, headers=c["fac"], json={"score": 99})
    assert too_many.status_code == 400
    assert "Marks cannot be more than" in str(too_many.json()["detail"])
    assert "core" not in str(too_many.json()["detail"]).lower()  # never "score" to a person
    ok = await client.put(url, headers=c["fac"], json={"score": 2})
    assert ok.status_code == 200, ok.text


# ---------------------------------------------------------------- integrity


async def test_integrity_events_cannot_name_someone_elses_attempt(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    asg = await assign(client, c["fac"], act["id"], section_ids=[c["sec"]])
    mine = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])).json()
    theirs = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s2"])).json()
    now = datetime.now(UTC).isoformat()
    r = await client.post(
        f"{A}/integrity/events",
        headers=c["s1"],
        json={
            "session_id": "sess-12345678",
            "events": [
                {"kind": "focus_lost", "at": now, "attempt_id": mine["attempt_id"]},
                {"kind": "focus_lost", "at": now, "attempt_id": theirs["attempt_id"]},
                {"kind": "focus_lost", "at": now, "attempt_id": str(uuid.uuid4())},
            ],
        },
    )
    assert r.status_code == 204
    async with SessionLocal() as s:
        rows = (await s.scalars(select(IntegrityEvent.attempt_id))).all()
        on_theirs = await s.scalar(
            select(func.count())
            .select_from(IntegrityEvent)
            .where(IntegrityEvent.attempt_id == uuid.UUID(theirs["attempt_id"]))
        )
    assert on_theirs == 0
    assert sorted(str(x) for x in rows if x) == [mine["attempt_id"]]
    assert len(rows) == 3  # all three are kept, two of them without an attempt


# ---------------------------------------------------------------- imports


async def test_username_made_by_hand_in_lower_case_matches_the_sheet(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    """A user typed in as `1db23cs050` is the same person as `1DB23CS050` in an import."""
    from app.models import ImportKind
    from app.services import import_service

    await make_user("1db23cs050", Role.student, full_name="Typed By Hand")
    rows = [
        {
            "username": "1DB23CS050",
            "full_name": "From Sheet",
            "email": "1db23cs050@test.dev",
            "department": "CSE",
        }
    ]
    async with SessionLocal() as s:
        still_valid, errors = await import_service._db_checks(s, ImportKind.students, rows)
    # matched to the existing account (so it is an update, not a clashing insert)
    assert errors == [] and len(still_valid) == 1


async def test_sweep_skips_nothing_and_submits_once(client: AsyncClient) -> None:
    """The sweeper takes the same row lock as the student's own requests."""
    from sqlalchemy import update

    from app.models import Attempt
    from app.services import attempt_service

    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    asg = await assign(client, c["fac"], act["id"], section_ids=[c["sec"]], time_limit_seconds=60)
    st = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])).json()
    async with SessionLocal() as s:
        await s.execute(
            update(Attempt)
            .where(Attempt.id == uuid.UUID(st["attempt_id"]))
            .values(deadline_at=datetime.now(UTC) - timedelta(minutes=1))
        )
        await s.commit()
    async with SessionLocal() as s:
        assert await attempt_service.sweep_expired(s) == 1
    async with SessionLocal() as s:
        assert await attempt_service.sweep_expired(s) == 0
    state = (await client.get(f"{A}/attempts/{st['attempt_id']}", headers=c["s1"])).json()
    assert state["status"] == "submitted" and state["submit_reason"] == "timer"


async def test_attempt_open_on_a_second_device_counts_one_warning(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    asg = await assign(client, c["fac"], act["id"], section_ids=[c["sec"]])
    st = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])).json()
    url = f"{A}/attempts/{st['attempt_id']}/questions/0"

    async def violations() -> int:
        state = await client.get(f"{A}/attempts/{st['attempt_id']}", headers=c["s1"])
        return int(state.json()["violations"])

    phone = {**c["s1"], "X-Player-Session": "p-phone-0001"}
    laptop = {**c["s1"], "X-Player-Session": "p-laptop-0002"}
    # one tab, any number of requests (and reloads, which keep the id): nothing
    for _ in range(3):
        assert (await client.get(url, headers=phone)).status_code == 200
    assert await violations() == 0
    # the same attempt from another device: one warning
    assert (await client.get(url, headers=laptop)).status_code == 200
    assert await violations() == 1
    # taking turns quickly does not empty the warning budget in seconds
    await client.get(url, headers=phone)
    await client.get(url, headers=laptop)
    assert await violations() == 1
    # requests without the header (old clients, scripts) are left alone
    assert (await client.get(url, headers=c["s1"])).status_code == 200
    assert await violations() == 1

    async with SessionLocal() as s:
        kinds = (await s.scalars(select(IntegrityEvent.kind))).all()
    assert list(kinds) == ["second_device"]


async def test_participants_tracker_and_club_integrity_log(client: AsyncClient) -> None:
    """Teachers and club organisers see who attempted their own activities, and only those."""
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    asg = await assign(client, c["fac"], act["id"], section_ids=[c["sec"]])
    st = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])).json()
    q0 = (await client.get(f"{A}/attempts/{st['attempt_id']}/questions/0", headers=c["s1"])).json()
    await client.put(
        f"{A}/attempts/{st['attempt_id']}/answers/{q0['question']['id']}",
        headers=c["s1"],
        json={"response": {"choice": by_stem(q0, "4")}, "final": True},
    )
    await client.post(
        f"{A}/attempts/{st['attempt_id']}/violations",
        headers=c["s1"],
        json={"kind": "focus_lost", "session_id": "sess-12345678"},
    )
    await client.post(f"{A}/attempts/{st['attempt_id']}/submit", headers=c["s1"])
    await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s2"])  # still running

    people = (await client.get(f"{A}/participants", headers=c["fac"])).json()
    by_usn = {p["usn"]: p for p in people}
    assert set(by_usn) == {"1DB23CS001", "1DB23CS002"}
    asha = by_usn["1DB23CS001"]
    assert (asha["attempts"], asha["submitted"], asha["warnings"]) == (1, 1, 1)
    assert asha["name"] == "Asha" and float(asha["marks"]) == 1.0
    assert by_usn["1DB23CS002"]["in_progress"] == 1 and by_usn["1DB23CS002"]["marks"] is None
    found = (await client.get(f"{A}/participants?q=ash", headers=c["fac"])).json()
    assert [p["usn"] for p in found] == ["1DB23CS001"]

    one = await client.get(f"{A}/participants/{c['s1_id']}", headers=c["fac"])
    assert one.status_code == 200, one.text
    row = one.json()["attempts"][0]
    assert row["title"] == "Unit 1" and row["status"] == "submitted" and row["warnings"] == 1
    assert row["assignment_id"] == asg["id"] and row["attempt_id"] == st["attempt_id"]

    # a club organiser hosts a room: their tracker and integrity log hold only their own players
    await make_user("CLUB9", Role.club, full_name="Quiz Club")
    club = await login(client, "CLUB9")
    assert (await client.get(f"{A}/participants", headers=club)).json() == []
    assert (await client.get(f"{A}/participants/{c['s1_id']}", headers=club)).status_code == 404
    assert (await client.get(f"{A}/integrity/events", headers=club)).json() == []
    cact = await make_quiz(client, club)
    room = (
        await client.post(f"{A}/activities/{cact['id']}/assign", headers=club, json={"room": True})
    ).json()
    await client.post(f"{A}/join", headers=c["out"], json={"code": room["join_code"]})
    cst = (await client.post(f"{A}/me/assignments/{room['id']}/start", headers=c["out"])).json()
    await client.post(
        f"{A}/attempts/{cst['attempt_id']}/violations",
        headers=c["out"],
        json={"kind": "visibility_hidden", "session_id": "sess-12345678"},
    )
    mine = (await client.get(f"{A}/participants", headers=club)).json()
    assert [p["usn"] for p in mine] == ["1DB23CS099"] and mine[0]["warnings"] == 1
    events = (await client.get(f"{A}/integrity/events", headers=club)).json()
    assert [e["kind"] for e in events] == ["visibility_hidden"]
    # the teacher's view is unchanged by the club's room, and students have no tracker
    assert len((await client.get(f"{A}/participants", headers=c["fac"])).json()) == 2
    assert (await client.get(f"{A}/participants", headers=c["s1"])).status_code == 403
