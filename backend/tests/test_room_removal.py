"""A host takes a student out of a room, and lets them back in."""

from httpx import AsyncClient

from tests.test_activities import A, by_stem, make_quiz, setup_class


async def _room(client: AsyncClient, c: dict[str, dict[str, str]]) -> dict[str, str]:
    act = await make_quiz(client, c["fac"])
    r = await client.post(
        f"{A}/activities/{act['id']}/assign", headers=c["fac"], json={"room": True}
    )
    assert r.status_code == 201, r.text
    return r.json()


async def test_remove_submits_running_attempt_blocks_rejoin_and_readmit(
    client: AsyncClient,
) -> None:
    c = await setup_class(client)
    room = await _room(client, c)
    rid, code = room["id"], room["join_code"]
    base = f"{A}/activity-assignments/{rid}/room/players"

    for who in ("out", "s1"):
        assert (
            await client.post(f"{A}/join", headers=c[who], json={"code": code})
        ).status_code == 200
    players = (await client.get(base, headers=c["fac"])).json()
    assert [p["status"] for p in players["joined"]] == ["joined", "joined"] and players[
        "removed"
    ] == []

    # "out" is answering when the host takes them out
    st = (await client.post(f"{A}/me/assignments/{rid}/start", headers=c["out"])).json()
    q0 = (await client.get(f"{A}/attempts/{st['attempt_id']}/questions/0", headers=c["out"])).json()
    await client.put(
        f"{A}/attempts/{st['attempt_id']}/answers/{q0['question']['id']}",
        headers=c["out"],
        json={"response": {"choice": by_stem(q0, "4")}, "final": True},
    )
    joined = {p["usn"]: p for p in (await client.get(base, headers=c["fac"])).json()["joined"]}
    out = joined["1DB23CS099"]
    assert out["status"] == "in_progress"

    r = await client.post(f"{base}/{out['student_id']}/remove", headers=c["fac"])
    assert r.status_code == 204
    players = (await client.get(base, headers=c["fac"])).json()
    assert [p["usn"] for p in players["removed"]] == ["1DB23CS099"]
    assert "1DB23CS099" not in [p["usn"] for p in players["joined"]]

    # their answers so far were submitted, and the report keeps them
    rep = (await client.get(f"{A}/activity-assignments/{rid}/results", headers=c["fac"])).json()
    assert rep["summary"]["submitted"] == 1
    # the room left their list, the code no longer lets them in, starting again fails
    mine = (await client.get(f"{A}/me/activities", headers=c["out"])).json()
    assert rid not in [x["assignment_id"] for x in mine["pending"]]
    again = await client.post(f"{A}/join", headers=c["out"], json={"code": code})
    assert again.status_code == 403 and again.json()["detail"]["code"] == "room_removed"
    assert (await client.post(f"{A}/me/assignments/{rid}/start", headers=c["out"])).status_code in (
        403,
        404,
    )

    # removing someone twice, or who never joined: not found
    assert (
        await client.post(f"{base}/{out['student_id']}/remove", headers=c["fac"])
    ).status_code == 404

    # let back in: joined again, but one attempt is still one attempt
    assert (
        await client.post(f"{base}/{out['student_id']}/readmit", headers=c["fac"])
    ).status_code == 204
    players = (await client.get(base, headers=c["fac"])).json()
    assert players["removed"] == [] and "1DB23CS099" in [p["usn"] for p in players["joined"]]
    assert (
        await client.post(f"{A}/join", headers=c["out"], json={"code": code})
    ).status_code == 200
    restart = await client.post(f"{A}/me/assignments/{rid}/start", headers=c["out"])
    assert restart.status_code == 403 and restart.json()["detail"]["code"] == "already_taken"
    assert (
        await client.post(f"{base}/{out['student_id']}/readmit", headers=c["fac"])
    ).status_code == 404


async def test_only_the_host_manages_room_players(client: AsyncClient) -> None:
    c = await setup_class(client)
    room = await _room(client, c)
    base = f"{A}/activity-assignments/{room['id']}/room/players"
    await client.post(f"{A}/join", headers=c["s1"], json={"code": room["join_code"]})
    sid = (await client.get(base, headers=c["fac"])).json()["joined"][0]["student_id"]
    assert (await client.get(base, headers=c["s1"])).status_code == 403
    assert (await client.post(f"{base}/{sid}/remove", headers=c["s1"])).status_code == 403

    # a class assignment is not a room
    act = await make_quiz(client, c["fac"])
    cls = (
        await client.post(
            f"{A}/activities/{act['id']}/assign", headers=c["fac"], json={"section_ids": [c["sec"]]}
        )
    ).json()
    r = await client.get(f"{A}/activity-assignments/{cls['id']}/room/players", headers=c["fac"])
    assert r.status_code == 400
