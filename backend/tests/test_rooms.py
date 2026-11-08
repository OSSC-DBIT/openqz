"""Rooms (join codes) and the club organiser role."""

from datetime import UTC, datetime, timedelta

from httpx import AsyncClient

from app.models import Role
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
    assert (await client.get(f"{A}/integrity/events", headers=club)).status_code == 403
    # and they cannot see faculty activities
    fac_act = await make_quiz(client, c["fac"])
    assert (await client.get(f"{A}/activities/{fac_act['id']}", headers=club)).status_code == 404


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
