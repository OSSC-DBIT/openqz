"""Live (Kahoot-style) games: host-paced questions, phones see only the options, guests."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, update

from app.core.db import SessionLocal
from app.models import LiveAnswer, LiveGame, Role
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


async def test_the_answer_shows_two_seconds_after_everyone_answered(client: AsyncClient) -> None:
    c = await setup_class(client)
    g = await new_game(client, c["fac"], allow_guests=True)
    for h in (c["s1"], c["s2"]):
        await client.post(f"{A}/live/join", headers=h, json={"code": g["code"]})
    await client.post(f"{A}/live/join", json={"code": g["code"], "nickname": "Slow Guest"})
    await client.post(f"{A}/live/games/{g['id']}/start", headers=c["fac"])
    await open_now(g["id"])
    async with SessionLocal() as s:
        game = await s.get(LiveGame, g["id"])
        assert game is not None
        right = correct_id(game.snapshot[0])

    async def host() -> dict[str, Any]:
        r = await client.get(f"{A}/live/games/{g['id']}", headers=c["fac"])
        return dict(r.json())

    q = (await host())["question"]
    assert q["reveal_at"] == q["ends_at"]  # nobody answered yet: at time up
    for h in (c["s1"], c["s2"]):
        await client.post(
            f"{A}/live/play/{g['id']}/answer",
            headers=h,
            json={"index": 0, "response": {"choice": right}},
        )
    view = await host()
    assert view["answered"] == 2 and view["question"]["reveal_at"] == view["question"]["ends_at"]

    # the guest who has not answered leaves: everyone still playing has answered
    guest = next(p for p in view["players"] if p["guest"])
    await client.delete(f"{A}/live/games/{g['id']}/players/{guest['id']}", headers=c["fac"])
    view = await host()
    async with SessionLocal() as s:
        last = await s.scalar(
            select(func.max(LiveAnswer.created_at)).where(LiveAnswer.game_id == g["id"])
        )
    assert last is not None
    reveal = datetime.fromisoformat(view["question"]["reveal_at"])
    assert reveal == last + timedelta(seconds=2)
    assert reveal < datetime.fromisoformat(view["question"]["ends_at"])

    # time up comes first when the timer ran out before those 2 seconds
    await open_now(g["id"], seconds=-5)
    q = (await host())["question"]
    assert q["reveal_at"] == q["ends_at"]


def test_points_and_nicknames() -> None:
    assert live.points_for(Decimal("1"), 0, 20) == 1000
    assert live.points_for(Decimal("1"), 20_000, 20) == 500
    assert live.points_for(Decimal("0.5"), 0, 20) == 500
    assert live.points_for(Decimal("0"), 0, 20) == 0
    # the worked example in the faculty guide and on the screens: right after 5 s of 20 s
    assert live.points_for(Decimal("1"), 5_000, 20) == 875
    assert live.clean_nickname("  Priya   N ") == "Priya N"
    for name in ("Dickens", "Lund Bergman"[:4] + "berg", "Mitchell"):  # real names stay allowed
        assert live.clean_nickname(name)
    for bad in ("a", "x" * 25, "<script>", "Bhenchod99", "fuck you"):
        with pytest.raises(Exception):  # noqa: B017 - HTTPException with a 422
            live.clean_nickname(bad)


async def test_host_removes_a_player_in_the_middle_of_a_question(client: AsyncClient) -> None:
    c = await setup_class(client)
    g = await new_game(client, c["fac"])
    await client.post(f"{A}/live/join", headers=c["s1"], json={"code": g["code"]})
    p2 = (await client.post(f"{A}/live/join", headers=c["s2"], json={"code": g["code"]})).json()
    await client.post(f"{A}/live/games/{g['id']}/start", headers=c["fac"])
    await open_now(g["id"])
    view = (await client.get(f"{A}/live/games/{g['id']}", headers=c["fac"])).json()
    assert view["status"] == "question" and len(view["players"]) == 2

    r = await client.delete(f"{A}/live/games/{g['id']}/players/{p2['player_id']}", headers=c["fac"])
    assert r.status_code == 204
    # the removed phone can neither see nor answer; the host counts one player now
    assert (await client.get(f"{A}/live/play/{g['id']}", headers=c["s2"])).status_code == 403
    q = (await client.get(f"{A}/live/play/{g['id']}", headers=c["s1"])).json()["question"]
    blocked = await client.post(
        f"{A}/live/play/{g['id']}/answer",
        headers=c["s2"],
        json={"index": 0, "response": {"choice": q["options"][0]["id"]}},
    )
    assert blocked.status_code == 403 and blocked.json()["detail"]["code"] == "removed"
    await client.post(
        f"{A}/live/play/{g['id']}/answer",
        headers=c["s1"],
        json={"index": 0, "response": {"choice": q["options"][0]["id"]}},
    )
    view = (await client.get(f"{A}/live/games/{g['id']}", headers=c["fac"])).json()
    assert [p["nickname"] for p in view["players"]] == ["Asha"] and view["answered"] == 1
    # a removed student cannot join again with the code
    again = await client.post(f"{A}/live/join", headers=c["s2"], json={"code": g["code"]})
    assert again.status_code == 403 and again.json()["detail"]["code"] == "removed"


async def club_game(client: AsyncClient, club: dict[str, str], **extra: Any) -> dict[str, Any]:
    """A club's one-question quiz worth 10 points, hosted as a live game."""
    act = (await client.post(f"{A}/activities", headers=club, json={"title": "Fest final"})).json()
    q = await client.post(
        f"{A}/activities/{act['id']}/questions",
        headers=club,
        json={
            "type": "mcq",
            "stem": "Fastest land animal?",
            "marks": 10,
            "time_limit_seconds": 20,
            "options": [{"text": "Lion"}, {"text": "Cheetah", "correct": True}],
        },
    )
    assert q.status_code == 201, q.text
    r = await client.post(f"{A}/live/games", headers=club, json={"activity_id": act["id"], **extra})
    assert r.status_code == 201, r.text
    return dict(r.json())


async def test_club_game_counts_the_points_set_per_question(client: AsyncClient) -> None:
    c = await setup_class(client)
    await make_user("CLUB1", Role.club, full_name="OSSC Club")
    club = await login(client, "CLUB1")
    # "just for fun" is not a choice for a club's quiz: it counts its points
    g = await club_game(client, club, scoring="fun", instructions="  Teams of two. No phones.  ")
    assert g["scoring"] == "marks" and g["uses_points"] is True
    assert g["instructions"] == "Teams of two. No phones."

    # signed-in players pick a name or team name, which must be free
    pv = (await client.get(f"{A}/live/join/{g['code']}", headers=c["s1"])).json()
    assert pv["ask_name"] is True and pv["instructions"] == "Teams of two. No phones."
    me = await client.post(
        f"{A}/live/join", headers=c["s1"], json={"code": g["code"], "nickname": "Team Rocket"}
    )
    assert me.json()["nickname"] == "Team Rocket"
    taken = await client.post(
        f"{A}/live/join", headers=c["s2"], json={"code": g["code"], "nickname": "team rocket"}
    )
    assert taken.json()["detail"]["code"] == "nickname_taken"
    other = await client.post(f"{A}/live/join", headers=c["s2"], json={"code": g["code"]})
    assert other.json()["nickname"] == "Bharath"  # blank: their own name

    # the rules on the phones while they wait; the host can change them in the lobby
    lobby = (await client.get(f"{A}/live/play/{g['id']}", headers=c["s1"])).json()
    assert lobby["instructions"] == "Teams of two. No phones." and lobby["uses_points"] is True
    upd = await client.patch(
        f"{A}/live/games/{g['id']}", headers=club, json={"instructions": "Answer alone."}
    )
    assert upd.status_code == 200 and upd.json()["instructions"] == "Answer alone."
    fresh = await client.get(
        f"{A}/live/play/{g['id']}", headers=c["s1"], params={"since": lobby["version"]}
    )
    assert fresh.json()["instructions"] == "Answer alone."  # not "unchanged"
    assert (
        await client.patch(
            f"{A}/live/games/{g['id']}", headers=c["fac"], json={"instructions": "x"}
        )
    ).status_code in (403, 404)

    await client.post(f"{A}/live/games/{g['id']}/start", headers=club)
    await open_now(g["id"])
    async with SessionLocal() as s:
        game = await s.get(LiveGame, g["id"])
        assert game is not None
        right = correct_id(game.snapshot[0])
        wrong = next(o["id"] for o in game.snapshot[0]["options"] if not o.get("correct"))
    for h, choice in ((c["s1"], right), (c["s2"], wrong)):
        await client.post(
            f"{A}/live/play/{g['id']}/answer",
            headers=h,
            json={"index": 0, "response": {"choice": choice}},
        )
    await client.post(f"{A}/live/games/{g['id']}/reveal", headers=club)
    mine = (await client.get(f"{A}/live/play/{g['id']}", headers=c["s1"])).json()
    assert mine["my_answer"]["marks"] == "10.00"  # the question's 10 points, no speed bonus
    board = (await client.post(f"{A}/live/games/{g['id']}/leaderboard", headers=club)).json()
    assert [(r["nickname"], r["marks"]) for r in board["leaderboard"]] == [
        ("Team Rocket", "10.00"),
        ("Bharath", "0.00"),
    ]
    head = (await client.get(f"{A}/live/games/{g['id']}/results.csv", headers=club)).text
    assert head.splitlines()[0].startswith("Rank,Name / team,USN,Guest,Points,Max points")


async def test_club_game_with_the_speed_option_shrinks_the_points(client: AsyncClient) -> None:
    c = await setup_class(client)
    await make_user("CLUB1", Role.club, full_name="OSSC Club")
    club = await login(client, "CLUB1")
    g = await club_game(client, club, scoring="marks_speed")
    assert g["scoring"] == "marks_speed" and g["uses_points"] is True
    await client.post(f"{A}/live/join", headers=c["s1"], json={"code": g["code"]})
    await client.post(f"{A}/live/games/{g['id']}/start", headers=club)
    # the question opened 5 seconds ago (of 20)
    async with SessionLocal() as s:
        t = datetime.now(UTC)
        await s.execute(
            update(LiveGame)
            .where(LiveGame.id == g["id"])
            .values(
                question_started_at=t - timedelta(seconds=5),
                question_ends_at=t + timedelta(seconds=15),
            )
        )
        await s.commit()
        game = await s.get(LiveGame, g["id"])
        assert game is not None
        right = correct_id(game.snapshot[0])
    await client.post(
        f"{A}/live/play/{g['id']}/answer",
        headers=c["s1"],
        json={"index": 0, "response": {"choice": right}},
    )
    await client.post(f"{A}/live/games/{g['id']}/reveal", headers=club)
    got = Decimal(
        (await client.get(f"{A}/live/play/{g['id']}", headers=c["s1"])).json()["my_answer"]["marks"]
    )
    # 10 x 1 x (1 - 0.5 x 5 / 20) = 8.75, a little less for the time the request took
    assert Decimal("8.5") < got <= Decimal("8.75")
    assert live.speed_factor(5_000, 20) == Decimal("0.875")
    assert live.speed_factor(0, 20) == 1 and live.speed_factor(30_000, 20) == Decimal("0.5")
