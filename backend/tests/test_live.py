"""Live (Kahoot-style) games: host-paced questions, phones see only the options, guests."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import update

from app.core.db import SessionLocal
from app.models import LiveGame, Role
from app.services import live_service as live
from tests.conftest import login, make_user
from tests.test_activities import make_quiz, setup_class

A = "/api/v1"


async def open_now(game_id: str, seconds: int = 20) -> None:
    """Skip the 3 s "get ready" so answers are accepted at once."""
    async with SessionLocal() as s:
        t = datetime.now(UTC)
        await s.execute(
            update(LiveGame)
            .where(LiveGame.id == game_id)
            .values(
                question_started_at=t - timedelta(seconds=1),
                question_ends_at=t + timedelta(seconds=seconds),
            )
        )
        await s.commit()


async def new_game(client: AsyncClient, h: dict[str, str], **extra: Any) -> dict[str, Any]:
    act = await make_quiz(client, h)
    r = await client.post(f"{A}/live/games", headers=h, json={"activity_id": act["id"], **extra})
    assert r.status_code == 201, r.text
    return r.json()


def correct_id(q: dict[str, Any]) -> str:
    return next(o["id"] for o in q["options"] if o.get("correct"))


async def test_full_game_with_a_student_and_a_guest(client: AsyncClient) -> None:
    c = await setup_class(client)
    g = await new_game(client, c["fac"], allow_guests=True, scoring="marks_speed")
    # only the auto-markable tile questions of the quiz: MCQ, true / false, multi-select
    assert g["status"] == "lobby" and g["total"] == 3 and len(g["code"]) == 6

    # anyone can look up the code; a guest joins with a nickname, a student with their name
    pv = (await client.get(f"{A}/live/join/{g['code']}")).json()
    assert pv["allow_guests"] is True and pv["questions"] == 3 and pv["signed_in"] is False
    guest = (
        await client.post(f"{A}/live/join", json={"code": g["code"], "nickname": "Quiz Ninja"})
    ).json()
    G = {"X-Live-Player": guest["player_token"]}
    stu = (await client.post(f"{A}/live/join", headers=c["s1"], json={"code": g["code"]})).json()
    assert stu["nickname"] == "Asha" and "player_token" not in stu
    again = await client.post(f"{A}/live/join", json={"code": g["code"], "nickname": "quiz ninja"})
    assert again.json()["detail"]["code"] == "nickname_taken"
    assert (
        await client.post(f"{A}/live/join", json={"code": g["code"], "nickname": "x"})
    ).status_code == 422
    host = (await client.get(f"{A}/live/games/{g['id']}", headers=c["fac"])).json()
    assert {p["nickname"] for p in host["players"]} == {"Asha", "Quiz Ninja"}

    # start: the host sees the question; phones see the options only, no text, no key
    host = (await client.post(f"{A}/live/games/{g['id']}/start", headers=c["fac"])).json()
    assert host["status"] == "question" and host["question"]["stem"]
    assert all("correct" not in o for o in host["question"]["options"])
    st = (await client.get(f"{A}/live/play/{g['id']}", headers=G)).json()
    assert st["status"] == "question" and "stem" not in st["question"]
    assert "correct_ids" not in st["question"]
    too_early = await client.post(
        f"{A}/live/play/{g['id']}/answer", headers=G, json={"index": 0, "response": {"choice": "x"}}
    )
    assert too_early.json()["detail"]["code"] in ("not_yet", "bad_answer")

    await open_now(g["id"])
    full = (await client.get(f"{A}/live/games/{g['id']}", headers=c["fac"])).json()
    async with SessionLocal() as s:
        game = await s.get(LiveGame, g["id"])
        assert game is not None
        right = correct_id(game.snapshot[0])
        wrong = next(o["id"] for o in game.snapshot[0]["options"] if not o.get("correct"))
    ok = await client.post(
        f"{A}/live/play/{g['id']}/answer",
        headers=c["s1"],
        json={"index": 0, "response": {"choice": right}},
    )
    assert ok.json() == {"locked": True}
    await client.post(
        f"{A}/live/play/{g['id']}/answer",
        headers=G,
        json={"index": 0, "response": {"choice": wrong}},
    )
    twice = await client.post(
        f"{A}/live/play/{g['id']}/answer",
        headers=c["s1"],
        json={"index": 0, "response": {"choice": right}},
    )
    assert twice.json()["detail"]["code"] == "answered"
    assert (await client.get(f"{A}/live/games/{g['id']}", headers=c["fac"])).json()["answered"] == 2
    assert full["answered"] == 0

    # reveal: the key and the counts; each phone learns its own result
    host = (await client.post(f"{A}/live/games/{g['id']}/reveal", headers=c["fac"])).json()
    assert host["counts"][right] == 1 and host["counts"][wrong] == 1
    me = (await client.get(f"{A}/live/play/{g['id']}", headers=c["s1"])).json()
    assert me["question"]["correct_ids"] == [right]
    assert me["my_answer"]["correct"] is True and 500 <= me["my_answer"]["points"] <= 1000
    gu = (await client.get(f"{A}/live/play/{g['id']}", headers=G)).json()
    assert gu["my_answer"]["correct"] is False and gu["my_answer"]["points"] == 0

    host = (await client.post(f"{A}/live/games/{g['id']}/leaderboard", headers=c["fac"])).json()
    assert host["leaderboard"][0]["nickname"] == "Asha" and host["leaderboard"][1]["guest"] is True
    me = (await client.get(f"{A}/live/play/{g['id']}", headers=c["s1"])).json()
    assert me["me"]["rank"] == 1 and me["me"]["of"] == 2 and me["me"]["marks"] == "1.00"

    # next question, then end: a podium for everyone, results and a CSV for the host
    host = (await client.post(f"{A}/live/games/{g['id']}/next", headers=c["fac"])).json()
    assert host["status"] == "question" and host["index"] == 1
    host = (await client.post(f"{A}/live/games/{g['id']}/end", headers=c["fac"])).json()
    assert host["status"] == "ended" and host["leaderboard"]
    st = (await client.get(f"{A}/live/play/{g['id']}", headers=G)).json()
    assert (
        st["status"] == "ended" and st["podium"][0]["nickname"] == "Asha" and st["me"]["rank"] == 2
    )
    res = (await client.get(f"{A}/live/games/{g['id']}/results", headers=c["fac"])).json()
    assert res["players"][0]["usn"] == "1DB23CS001" and res["players"][0]["correct"] == 1
    assert res["questions"][0]["answered"] == 2
    csv = await client.get(f"{A}/live/games/{g['id']}/results.csv", headers=c["fac"])
    assert "Marks obtained" in csv.text and "Quiz Ninja" in csv.text
    # the code is free again once the game ends
    assert (await client.get(f"{A}/live/join/{g['code']}")).status_code == 404
    listing = (await client.get(f"{A}/live/games", headers=c["fac"])).json()
    assert listing[0]["players"] == 2


async def test_rules_guests_hosts_removal_and_time(client: AsyncClient) -> None:
    c = await setup_class(client)
    g = await new_game(client, c["fac"])  # guests off by default
    no_guest = await client.post(f"{A}/live/join", json={"code": g["code"], "nickname": "Visitor"})
    assert no_guest.status_code == 401 and no_guest.json()["detail"]["code"] == "sign_in"
    # students cannot host; another teacher cannot see or drive this game
    act = await make_quiz(client, c["fac"])
    assert (
        await client.post(f"{A}/live/games", headers=c["s1"], json={"activity_id": act["id"]})
    ).status_code == 403
    await make_user("EMP2", Role.faculty)
    other = await login(client, "EMP2")
    assert (await client.post(f"{A}/live/games/{g['id']}/start", headers=other)).status_code == 404

    # the host removes a player; that phone is shut out
    p = (await client.post(f"{A}/live/join", headers=c["s2"], json={"code": g["code"]})).json()
    r = await client.delete(f"{A}/live/games/{g['id']}/players/{p['player_id']}", headers=c["fac"])
    assert r.status_code == 204
    assert (await client.get(f"{A}/live/play/{g['id']}", headers=c["s2"])).status_code == 403

    # moves out of order are refused; answers after the timer are refused
    assert (
        await client.post(f"{A}/live/games/{g['id']}/reveal", headers=c["fac"])
    ).status_code == 409
    await client.post(f"{A}/live/join", headers=c["s1"], json={"code": g["code"]})
    await client.post(f"{A}/live/games/{g['id']}/start", headers=c["fac"])
    await open_now(g["id"], seconds=-5)
    late = await client.post(
        f"{A}/live/play/{g['id']}/answer",
        headers=c["s1"],
        json={"index": 0, "response": {"choice": "a"}},
    )
    assert late.json()["detail"]["code"] == "time_up"
    # stop new joins
    await client.post(f"{A}/live/games/{g['id']}/lock", headers=c["fac"])
    closed = await client.post(f"{A}/live/join", headers=c["out"], json={"code": g["code"]})
    assert closed.json()["detail"]["code"] == "closed"


async def test_fun_scoring_counts_no_marks(client: AsyncClient) -> None:
    c = await setup_class(client)
    g = await new_game(client, c["fac"], scoring="fun")
    await client.post(f"{A}/live/join", headers=c["s1"], json={"code": g["code"]})
    await client.post(f"{A}/live/games/{g['id']}/start", headers=c["fac"])
    await open_now(g["id"])
    async with SessionLocal() as s:
        game = await s.get(LiveGame, g["id"])
        assert game is not None
        right = correct_id(game.snapshot[0])
    await client.post(
        f"{A}/live/play/{g['id']}/answer",
        headers=c["s1"],
        json={"index": 0, "response": {"choice": right}},
    )
    await client.post(f"{A}/live/games/{g['id']}/reveal", headers=c["fac"])
    me = (await client.get(f"{A}/live/play/{g['id']}", headers=c["s1"])).json()
    assert me["me"]["points"] > 0 and "marks" not in me["me"]
    res = (await client.get(f"{A}/live/games/{g['id']}/results", headers=c["fac"])).json()
    assert res["total_marks"] is None and "marks" not in res["players"][0]


def test_points_and_nicknames() -> None:
    assert live.points_for(Decimal("1"), 0, 20) == 1000
    assert live.points_for(Decimal("1"), 20_000, 20) == 500
    assert live.points_for(Decimal("0.5"), 0, 20) == 500
    assert live.points_for(Decimal("0"), 0, 20) == 0
    assert live.clean_nickname("  Priya   N ") == "Priya N"
    for name in ("Dickens", "Lund Bergman"[:4] + "berg", "Mitchell"):  # real names stay allowed
        assert live.clean_nickname(name)
    for bad in ("a", "x" * 25, "<script>", "Bhenchod99", "fuck you"):
        with pytest.raises(Exception):  # noqa: B017 - HTTPException with a 422
            live.clean_nickname(bad)
