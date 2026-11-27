"""Rooms (join codes) and the club organiser role."""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from httpx import AsyncClient

from app.core.db import SessionLocal
from app.models import Attempt, Role
from tests.conftest import login, make_user
from tests.test_activities import QUESTIONS, A, by_stem, make_quiz, setup_class


async def _club(client: AsyncClient) -> dict[str, str]:
    await make_user("CLUB1", Role.club, full_name="OSSC Club")
    return await login(client, "CLUB1")


async def test_faculty_room_any_student_can_join(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    r = await client.post(
        f"{A}/activities/{act['id']}/assign", headers=c["fac"], json={"room": True}
    )
    assert r.status_code == 201, r.text
    room = r.json()
    code = room["join_code"]
    assert room["is_room"] and len(code) == 6 and code.isdigit()
    assert room["target_labels"][0] == f"Room {code}" and room["student_count"] == 0

    # a student from another class (not targeted) joins with the code
    pv = (await client.get(f"{A}/join/{code}", headers=c["out"])).json()
    assert pv["title"] == "Unit 1" and pv["open"] and not pv["joined"] and pv["host"] == "Dr Rao"
    j = await client.post(f"{A}/join", headers=c["out"], json={"code": f"{code[:3]} {code[3:]}"})
    assert j.status_code == 200 and j.json()["assignment_id"] == room["id"]
    again = await client.post(f"{A}/join", headers=c["out"], json={"code": code})
    assert again.status_code == 200  # joining twice is harmless

    mine = (await client.get(f"{A}/me/activities", headers=c["out"])).json()
    assert [x["assignment_id"] for x in mine["pending"]] == [room["id"]]
    st = (await client.post(f"{A}/me/assignments/{room['id']}/start", headers=c["out"])).json()
    q0 = (await client.get(f"{A}/attempts/{st['attempt_id']}/questions/0", headers=c["out"])).json()
    await client.put(
        f"{A}/attempts/{st['attempt_id']}/answers/{q0['question']['id']}",
        headers=c["out"],
        json={"response": {"choice": by_stem(q0, "4")}, "final": True},
    )
    await client.post(f"{A}/attempts/{st['attempt_id']}/submit", headers=c["out"])

    rep = (
        await client.get(f"{A}/activity-assignments/{room['id']}/results", headers=c["fac"])
    ).json()
    assert [s["usn"] for s in rep["students"]] == ["1DB23CS099"]
    assert rep["summary"]["submitted"] == 1
    # a teacher's room is not a competition: no leaderboard
    assert rep["ranked"] is False and rep["students"][0]["rank"] is None


async def test_room_codes_wrong_closed_regenerated(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    room = (
        await client.post(
            f"{A}/activities/{act['id']}/assign", headers=c["fac"], json={"room": True}
        )
    ).json()
    bad = await client.post(f"{A}/join", headers=c["s1"], json={"code": "000000"})
    assert bad.status_code == 404 and bad.json()["detail"]["code"] == "bad_code"

    # host stops new joins
    upd = await client.patch(
        f"{A}/activity-assignments/{room['id']}", headers=c["fac"], json={"accepting_joins": False}
    )
    assert upd.json()["accepting_joins"] is False
    closed = await client.post(f"{A}/join", headers=c["s1"], json={"code": room["join_code"]})
    assert closed.status_code == 403 and closed.json()["detail"]["code"] == "room_closed"
    await client.patch(
        f"{A}/activity-assignments/{room['id']}", headers=c["fac"], json={"accepting_joins": True}
    )
    assert (
        await client.post(f"{A}/join", headers=c["s1"], json={"code": room["join_code"]})
    ).status_code == 200

    new = (
        await client.post(f"{A}/activity-assignments/{room['id']}/new-code", headers=c["fac"])
    ).json()
    assert new["join_code"] != room["join_code"]
    assert (await client.get(f"{A}/join/{room['join_code']}", headers=c["s2"])).status_code == 404
    # already-joined students keep access
    assert (
        await client.post(f"{A}/me/assignments/{room['id']}/start", headers=c["s1"])
    ).status_code == 200


async def test_room_window_and_roles(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    ended = (
        await client.post(
            f"{A}/activities/{act['id']}/assign",
            headers=c["fac"],
            json={
                "room": True,
                "start_at": (datetime.now(UTC) - timedelta(days=2)).isoformat(),
                "due_at": (datetime.now(UTC) - timedelta(days=1)).isoformat(),
            },
        )
    ).json()
    r = await client.post(f"{A}/join", headers=c["s1"], json={"code": ended["join_code"]})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "closed"
    # faculty cannot "join"; codes cannot be brute forced
    assert (
        await client.post(f"{A}/join", headers=c["fac"], json={"code": ended["join_code"]})
    ).status_code == 403
    for _ in range(21):
        last = await client.get(f"{A}/join/123456", headers=c["s2"])
    assert last.status_code == 429


async def test_club_role_builds_and_hosts_rooms_only(client: AsyncClient) -> None:
    c = await setup_class(client)
    club = await _club(client)
    opts = (await client.get(f"{A}/me/classes", headers=club)).json()
    assert opts["classes"] == [] and opts["can_use_sections"] is False

    with_sec = await client.post(
        f"{A}/activities", headers=club, json={"title": "x", "section_ids": [c["sec"]]}
    )
    assert with_sec.status_code == 400
    act = (
        await client.post(f"{A}/activities", headers=club, json={"title": "Tech fest quiz"})
    ).json()
    for q in QUESTIONS[:2]:
        assert (
            await client.post(f"{A}/activities/{act['id']}/questions", headers=club, json=q)
        ).status_code == 201

    to_sec = await client.post(
        f"{A}/activities/{act['id']}/assign", headers=club, json={"section_ids": [c["sec"]]}
    )
    assert to_sec.status_code == 400
    room = (
        await client.post(f"{A}/activities/{act['id']}/assign", headers=club, json={"room": True})
    ).json()
    assert room["host_name"] == "OSSC Club"
    assert (
        await client.post(f"{A}/join", headers=c["s2"], json={"code": room["join_code"]})
    ).status_code == 200
    rep = await client.get(f"{A}/activity-assignments/{room['id']}/results", headers=club)
    assert rep.status_code == 200 and rep.json()["summary"]["assigned"] == 1

    # no academic data for clubs
    assert (await client.get(f"{A}/sections/{c['sec']}/students", headers=club)).status_code == 403
    assert (await client.get(f"{A}/users", headers=club)).status_code == 403
    # a club organiser reads the integrity log of their own rooms (nothing else is in it)
    own = await client.get(f"{A}/integrity/events", headers=club)
    assert own.status_code == 200 and all(e["attempt_id"] for e in own.json())
    # and they cannot see faculty activities
    fac_act = await make_quiz(client, c["fac"])
    assert (await client.get(f"{A}/activities/{fac_act['id']}", headers=club)).status_code == 404


async def _take(client: AsyncClient, h: dict[str, str], assignment_id: str, right: set[str]) -> str:
    """Start, answer every question (those in `right` correctly, the others wrongly), submit."""
    st = (await client.post(f"{A}/me/assignments/{assignment_id}/start", headers=h)).json()
    att = st["attempt_id"]
    for i in range(st["total"]):
        q = (await client.get(f"{A}/attempts/{att}/questions/{i}", headers=h)).json()
        stem = q["question"]["stem"]
        if stem == "2+2?":
            resp = {"choice": by_stem(q, "4" if stem in right else "3")}
        else:  # "The sky is green" (true / false)
            resp = {"choice": "false" if stem in right else "true"}
        r = await client.put(
            f"{A}/attempts/{att}/answers/{q['question']['id']}",
            headers=h,
            json={"response": resp, "final": True},
        )
        assert r.status_code == 200, r.text
    assert (await client.post(f"{A}/attempts/{att}/submit", headers=h)).status_code == 200
    return str(att)


async def test_club_room_report_is_a_leaderboard_by_marks(client: AsyncClient) -> None:
    c = await setup_class(client)
    club = await _club(client)
    await make_user("1DB23CS010", full_name="Aaron")  # joins, never starts
    aaron = await login(client, "1DB23CS010")
    act = (
        await client.post(f"{A}/activities", headers=club, json={"title": "Fest round 1"})
    ).json()
    for q in QUESTIONS[:2]:  # 2+2 (1 mark), the sky is green (1 mark)
        await client.post(f"{A}/activities/{act['id']}/questions", headers=club, json=q)
    room = (
        await client.post(f"{A}/activities/{act['id']}/assign", headers=club, json={"room": True})
    ).json()
    for h in (c["s1"], c["s2"], c["out"], aaron):
        assert (
            await client.post(f"{A}/join", headers=h, json={"code": room["join_code"]})
        ).status_code == 200

    both = {"2+2?", "The sky is green"}
    await _take(client, c["s1"], room["id"], {"2+2?"})  # Asha: 1 mark
    await _take(client, c["s2"], room["id"], both)  # Bharath: 2 marks, quick
    slow = await _take(client, c["out"], room["id"], both)  # Other: 2 marks, 10 minutes
    async with SessionLocal() as s:
        att = await s.get(Attempt, uuid.UUID(slow))
        assert att is not None and att.submitted_at is not None
        att.started_at = att.submitted_at - timedelta(minutes=10)
        await s.commit()

    rep = (await client.get(f"{A}/activity-assignments/{room['id']}/results", headers=club)).json()
    assert rep["ranked"] is True
    # most marks first, equal marks the quicker one, then those who have not finished
    rows = [
        (s["name"], s["rank"], None if s["score"] is None else Decimal(str(s["score"])))
        for s in rep["students"]
    ]
    assert rows == [("Bharath", 1, 2), ("Other", 2, 2), ("Asha", 3, 1), ("Aaron", None, None)]
    assert rep["students"][1]["time_taken_seconds"] >= 600
    assert rep["students"][0]["time_taken_seconds"] < 600
    # the CSV follows the same order
    csv_rows = (
        await client.get(f"{A}/activity-assignments/{room['id']}/results.csv", headers=club)
    ).text.splitlines()[1:]
    assert [row.split(",")[1] for row in csv_rows] == ["Bharath", "Other", "Asha", "Aaron"]


async def test_admin_can_create_club_accounts(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    r = await client.post(
        f"{A}/users",
        headers=admin_headers,
        json={
            "username": "OSSC",
            "full_name": "OSSC Club",
            "email": "ossc@dbit.in",
            "role": "club",
        },
    )
    assert r.status_code == 201 and r.json()["user"]["role"] == "club"


async def test_club_rooms_count_in_points_and_ask_for_a_name_or_team(client: AsyncClient) -> None:
    c = await setup_class(client)
    club = await _club(client)
    act = (await client.post(f"{A}/activities", headers=club, json={"title": "Fest quiz"})).json()
    assert act["uses_points"] is True  # a club's activity counts in points
    assert (await make_quiz(client, c["fac"]))["uses_points"] is False  # a teacher's in marks
    for q in QUESTIONS[:2]:
        await client.post(f"{A}/activities/{act['id']}/questions", headers=club, json=q)
    room = (
        await client.post(f"{A}/activities/{act['id']}/assign", headers=club, json={"room": True})
    ).json()
    assert room["uses_points"] is True
    code = room["join_code"]

    pv = (await client.get(f"{A}/join/{code}", headers=c["s1"])).json()
    assert pv["ask_name"] is True and pv["uses_points"] is True and pv["my_name"] is None
    j = await client.post(f"{A}/join", headers=c["s1"], json={"code": code, "name": "Code Ninjas"})
    assert j.status_code == 200 and j.json()["display_name"] == "Code Ninjas"
    # names are unique in the room (whatever the case) and must be friendly
    taken = await client.post(
        f"{A}/join", headers=c["s2"], json={"code": code, "name": "code ninjas"}
    )
    assert taken.status_code == 409 and taken.json()["detail"]["code"] == "name_taken"
    bad = await client.post(f"{A}/join", headers=c["s2"], json={"code": code, "name": "x"})
    assert bad.status_code == 422
    await client.post(f"{A}/join", headers=c["s2"], json={"code": code, "name": "Byte Me"})
    await client.post(f"{A}/join", headers=c["out"], json={"code": code})  # blank: own name
    # joining again changes the name
    await client.post(f"{A}/join", headers=c["s1"], json={"code": code, "name": "Ninjas Two"})
    assert (await client.get(f"{A}/join/{code}", headers=c["s1"])).json()["my_name"] == "Ninjas Two"

    st = (await client.post(f"{A}/me/assignments/{room['id']}/start", headers=c["s1"])).json()
    assert st["uses_points"] is True
    mine = (await client.get(f"{A}/me/activities", headers=c["s1"])).json()
    assert mine["pending"][0]["uses_points"] is True

    rep = (await client.get(f"{A}/activity-assignments/{room['id']}/results", headers=club)).json()
    names = {s["name"]: s["display_name"] for s in rep["students"]}
    assert names == {"Asha": "Ninjas Two", "Bharath": "Byte Me", "Other": None}
    players = (
        await client.get(f"{A}/activity-assignments/{room['id']}/room/players", headers=club)
    ).json()
    assert {p["display_name"] for p in players["joined"]} == {"Ninjas Two", "Byte Me", None}
    head = (
        await client.get(f"{A}/activity-assignments/{room['id']}/results.csv", headers=club)
    ).text.splitlines()[0]
    assert "Name / team" in head and "Points" in head and "Marks" not in head
    xlsx = await client.get(f"{A}/activity-assignments/{room['id']}/results.xlsx", headers=club)
    assert xlsx.status_code == 200

    # a teacher's room asks for no name: one given is ignored
    fac_room = (
        await client.post(
            f"{A}/activities/{(await make_quiz(client, c['fac']))['id']}/assign",
            headers=c["fac"],
            json={"room": True},
        )
    ).json()
    pv = (await client.get(f"{A}/join/{fac_room['join_code']}", headers=c["s2"])).json()
    assert pv["ask_name"] is False and pv["uses_points"] is False
    j = await client.post(
        f"{A}/join", headers=c["s2"], json={"code": fac_room["join_code"], "name": "Team X"}
    )
    assert j.status_code == 200 and j.json()["display_name"] is None


async def test_a_club_gives_any_points_up_to_1000_and_teachers_up_to_100_marks(
    client: AsyncClient,
) -> None:
    c = await setup_class(client)
    club = await _club(client)
    act = (await client.post(f"{A}/activities", headers=club, json={"title": "Final"})).json()
    q = {**QUESTIONS[0], "marks": 250}
    r = await client.post(f"{A}/activities/{act['id']}/questions", headers=club, json=q)
    assert r.status_code == 201 and Decimal(str(r.json()["marks"])) == 250
    r = await client.post(
        f"{A}/activities/{act['id']}/apply-all", headers=club, json={"marks": 37.5}
    )
    assert r.status_code == 200 and Decimal(str(r.json()["questions"][0]["marks"])) == Decimal(
        "37.5"
    )
    over = await client.post(
        f"{A}/activities/{act['id']}/questions", headers=club, json={**q, "marks": 1001}
    )
    assert over.status_code == 422

    # a teacher's question stays at 100 marks at most
    fac = (await client.post(f"{A}/activities", headers=c["fac"], json={"title": "Unit 2"})).json()
    refused = await client.post(f"{A}/activities/{fac['id']}/questions", headers=c["fac"], json=q)
    assert refused.status_code == 400 and "at most 100 marks" in refused.text
    ok = await client.post(
        f"{A}/activities/{fac['id']}/questions", headers=c["fac"], json={**q, "marks": 100}
    )
    assert ok.status_code == 201
    bulk = await client.post(
        f"{A}/activities/{fac['id']}/apply-all", headers=c["fac"], json={"marks": 150}
    )
    assert bulk.status_code == 400
