"""Insecure direct object references: every route that takes an id refuses someone who may not use
that object (403 or 404), and nothing changes when it does.

People: teacher A owns a class with students s1 and s2; teacher B has their own activity; "out" is
a student outside A's class; a club organiser; a plain admin; a super admin."""

from typing import Any

from httpx import AsyncClient, Response

from app.models import Role
from tests.conftest import login, make_user
from tests.test_activities import A, assign, by_stem, make_quiz, setup_class

REFUSED = (401, 403, 404)


def refused(r: Response, what: str) -> None:
    assert r.status_code in REFUSED, f"{what}: {r.status_code} {r.text[:200]}"


async def _world(client: AsyncClient) -> dict[str, Any]:
    c = await setup_class(client)
    await make_user("EMP2", Role.faculty, full_name="Teacher B")
    await make_user("CLUB1", Role.club, full_name="Club")
    await make_user("ADM1", Role.admin, full_name="Plain admin", superadmin=False)
    w: dict[str, Any] = {**c}
    w["b"] = await login(client, "EMP2")
    w["club"] = await login(client, "CLUB1")
    w["adm"] = await login(client, "ADM1")
    act = await make_quiz(client, c["fac"])
    asg = await assign(
        client, c["fac"], act["id"], section_ids=[c["sec"]], require_fullscreen=False
    )
    st = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])).json()
    q0 = (await client.get(f"{A}/attempts/{st['attempt_id']}/questions/0", headers=c["s1"])).json()
    w.update(act=act, asg=asg, att=st["attempt_id"], q0=q0)
    room = (
        await client.post(
            f"{A}/activities/{act['id']}/assign", headers=c["fac"], json={"room": True}
        )
    ).json()
    w["room"] = room
    game = (
        await client.post(f"{A}/live/games", headers=c["fac"], json={"activity_id": act["id"]})
    ).json()
    w["game"] = game
    return w


async def test_another_teacher_cannot_touch_a_teachers_work(client: AsyncClient) -> None:
    w = await _world(client)
    act, asg, att, room, game = (
        w["act"]["id"],
        w["asg"]["id"],
        w["att"],
        w["room"]["id"],
        w["game"]["id"],
    )
    qid = w["q0"]["question"]["id"]
    b = w["b"]
    for method, url, body in [
        ("GET", f"/activities/{act}", None),
        ("PATCH", f"/activities/{act}", {"title": "Mine now"}),
        ("DELETE", f"/activities/{act}", None),
        (
            "POST",
            f"/activities/{act}/questions",
            {"type": "true_false", "stem": "x", "answer": {"value": True}},
        ),
        (
            "PUT",
            f"/activities/{act}/questions/{qid}",
            {"type": "true_false", "stem": "changed", "answer": {"value": True}, "marks": 1},
        ),
        ("DELETE", f"/activities/{act}/questions/{qid}", None),
        ("POST", f"/activities/{act}/duplicate", None),
        ("POST", f"/activities/{act}/assign", {"room": True}),
        ("GET", f"/activities/{act}/assignments", None),
        ("POST", f"/activities/{act}/publish", None),
        ("POST", f"/activities/{act}/apply-all", {"marks": 5}),
        ("GET", f"/activity-assignments/{asg}", None),
        ("PATCH", f"/activity-assignments/{asg}", {"instructions": "hacked"}),
        ("DELETE", f"/activity-assignments/{asg}", None),
        ("GET", f"/activity-assignments/{asg}/results", None),
        ("GET", f"/activity-assignments/{asg}/results.csv", None),
        ("GET", f"/activity-assignments/{asg}/results.xlsx", None),
        ("GET", f"/activity-assignments/{asg}/grading", None),
        ("POST", f"/activity-assignments/{asg}/release", None),
        ("POST", f"/activity-assignments/{room}/new-code", None),
        ("GET", f"/activity-assignments/{room}/room/players", None),
        ("GET", f"/activity-assignments/attempts/{att}", None),
        ("POST", f"/activity-assignments/attempts/{att}/unblock", {}),
        ("PUT", f"/activity-assignments/attempts/{att}/answers/{qid}/grade", {"score": 1}),
        ("GET", f"/live/games/{game}", None),
        ("POST", f"/live/games/{game}/start", None),
        ("POST", f"/live/games/{game}/end", None),
        ("GET", f"/live/games/{game}/results", None),
        ("GET", f"/live/games/{game}/results.csv", None),
    ]:
        refused(
            await client.request(method, f"{A}{url}", headers=b, json=body),
            f"teacher B {method} {url}",
        )
    # nothing changed
    still = (await client.get(f"{A}/activities/{act}", headers=w["fac"])).json()
    assert still["title"] == "Unit 1" and len(still["questions"]) >= 1
    assert (await client.get(f"{A}/live/games/{game}", headers=w["fac"])).json()[
        "status"
    ] == "lobby"


async def test_a_student_cannot_use_another_students_attempt(client: AsyncClient) -> None:
    w = await _world(client)
    att, qid = w["att"], w["q0"]["question"]["id"]
    for who in ("s2", "out"):
        h = w[who]
        for method, url, body in [
            ("GET", f"/attempts/{att}", None),
            ("GET", f"/attempts/{att}/questions/0", None),
            (
                "PUT",
                f"/attempts/{att}/answers/{qid}",
                {"response": {"choice": by_stem(w["q0"], "4")}, "final": True},
            ),
            ("POST", f"/attempts/{att}/submit", None),
            ("GET", f"/attempts/{att}/review", None),
            (
                "POST",
                f"/attempts/{att}/violations",
                {"kind": "tab_switch", "session_id": "someone-else-1234"},
            ),
        ]:
            refused(
                await client.request(method, f"{A}{url}", headers=h, json=body),
                f"{who} {method} {url}",
            )
    # the owner's attempt is untouched: still running, no violations
    mine = (await client.get(f"{A}/attempts/{att}", headers=w["s1"])).json()
    assert mine["status"] == "in_progress" and mine.get("violations", 0) == 0
    # a student outside the class cannot start the class assignment either
    refused(
        await client.post(f"{A}/me/assignments/{w['asg']['id']}/start", headers=w["out"]),
        "outsider start",
    )


async def test_students_and_clubs_cannot_reach_staff_or_admin_routes(client: AsyncClient) -> None:
    w = await _world(client)
    s1_id, sec = w["s1_id"], w["sec"]
    for who in ("s1", "out"):
        h = w[who]
        for method, url in [
            ("GET", "/users"),
            ("GET", f"/users/{s1_id}"),
            ("POST", f"/users/{s1_id}/reset-password"),
            ("GET", f"/participants/{s1_id}"),
            ("GET", "/participants"),
            ("GET", f"/sections/{sec}/students"),
            ("GET", f"/activity-assignments/{w['asg']['id']}/results"),
            ("POST", "/activities"),
            ("GET", "/audit"),
            ("GET", "/stats"),
            ("GET", "/imports"),
        ]:
            refused(
                await client.request(
                    method, f"{A}{url}", headers=h, json={} if method == "POST" else None
                ),
                f"{who} {method} {url}",
            )
    # a club organiser hosts rooms, it never sees class lists or students' records
    for url in (f"/participants/{s1_id}", f"/sections/{sec}/students", "/users"):
        refused(await client.get(f"{A}{url}", headers=w["club"]), f"club GET {url}")
    # its participant list holds only people who joined its own rooms
    mine = await client.get(f"{A}/participants", headers=w["club"])
    assert mine.status_code == 200 and str(s1_id) not in mine.text
    # teacher B does not see teacher A's student
    refused(await client.get(f"{A}/participants/{s1_id}", headers=w["b"]), "teacher B participant")


async def test_faculty_cannot_manage_people_and_plain_admins_cannot_use_super_admin_powers(
    client: AsyncClient,
) -> None:
    w = await _world(client)
    s1_id = w["s1_id"]
    for method, url, body in [
        ("PATCH", f"/users/{s1_id}", {"full_name": "Renamed"}),
        ("POST", f"/users/{s1_id}/reset-password", {}),
        ("POST", f"/users/{s1_id}/unlock", {}),
        (
            "POST",
            "/users",
            {"username": "X1", "full_name": "X", "email": "x1@example.com", "role": "admin"},
        ),
        ("POST", f"/sections/{w['sec']}/students", {"student_ids": [str(s1_id)]}),
        ("DELETE", f"/sections/{w['sec']}", None),
    ]:
        refused(
            await client.request(method, f"{A}{url}", headers=w["fac"], json=body),
            f"faculty {method} {url}",
        )

    adm = w["adm"]
    # a plain admin: no audit log, no admin accounts, no permanent deletes
    refused(await client.get(f"{A}/audit", headers=adm), "plain admin audit")
    r = await client.post(
        f"{A}/users",
        headers=adm,
        json={
            "username": "ADM9",
            "full_name": "New admin",
            "email": "adm9@example.com",
            "role": "admin",
        },
    )
    refused(r, "plain admin creates an admin")
    refused(
        await client.get(f"{A}/admin/data/users/{s1_id}/impact", headers=adm), "plain admin impact"
    )
    refused(
        await client.post(
            f"{A}/admin/data/users/{s1_id}/delete",
            headers=adm,
            json={"password": "x", "confirm": "x"},
        ),
        "plain admin permanent delete",
    )
    # the student is untouched
    me = (await client.get(f"{A}/auth/me", headers=w["s1"])).json()
    assert me["full_name"] != "Renamed"


async def test_a_live_player_token_only_works_for_its_own_game(client: AsyncClient) -> None:
    w = await _world(client)
    act2 = await make_quiz(client, w["b"])
    g1 = (
        await client.post(
            f"{A}/live/games",
            headers=w["fac"],
            json={"activity_id": w["act"]["id"], "allow_guests": True},
        )
    ).json()
    g2 = (
        await client.post(
            f"{A}/live/games",
            headers=w["b"],
            json={"activity_id": act2["id"], "allow_guests": True},
        )
    ).json()
    guest = (
        await client.post(f"{A}/live/join", json={"code": g1["code"], "nickname": "Visitor"})
    ).json()
    G = {"X-Live-Player": guest["player_token"]}
    assert (await client.get(f"{A}/live/play/{g1['id']}", headers=G)).status_code == 200
    refused(await client.get(f"{A}/live/play/{g2['id']}", headers=G), "guest token on another game")
    refused(
        await client.post(
            f"{A}/live/play/{g2['id']}/answer",
            headers=G,
            json={"index": 0, "response": {"choice": "a"}},
        ),
        "guest answers another game",
    )
    # a guest token is not an account: no staff or student routes
    for url in ("/auth/me", "/me/activities", f"/live/games/{g1['id']}"):
        refused(await client.get(f"{A}{url}", headers=G), f"guest GET {url}")
    # one host cannot remove a player from another host's game
    refused(
        await client.delete(
            f"{A}/live/games/{g1['id']}/players/{guest['player_id']}", headers=w["b"]
        ),
        "other host kicks",
    )


async def test_ids_that_do_not_exist_or_are_malformed_are_plain_not_found(
    client: AsyncClient,
) -> None:
    w = await _world(client)
    zero = "00000000-0000-0000-0000-000000000000"
    for url in (
        f"/activities/{zero}",
        f"/activity-assignments/{zero}",
        f"/attempts/{zero}",
        f"/media/{zero}",
        f"/live/games/{zero}",
    ):
        assert (await client.get(f"{A}{url}", headers=w["fac"])).status_code in (403, 404), url
    for url in (
        "/activities/1%20OR%201=1",
        "/attempts/..%2F..%2Fetc%2Fpasswd",
        "/media/not-a-uuid",
    ):
        assert (await client.get(f"{A}{url}", headers=w["fac"])).status_code in (404, 422), url
