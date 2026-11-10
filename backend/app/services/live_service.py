"""Live games: host-paced play. The host moves everyone through the questions; players' phones
show only the answer options. Answers are graded on arrival; the key is never sent to players
before the host reveals it."""

import hashlib
import re
import secrets
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Activity,
    ActivityAssignment,
    ActivityKind,
    LiveAnswer,
    LiveGame,
    LivePlayer,
    LiveScoring,
    LiveStatus,
)
from app.services import grading

LIVE_TYPES = ("mcq", "true_false", "multi_select")
DEFAULT_SECONDS = 20
GET_READY = timedelta(seconds=3)  # "Get ready" before each question opens
GRACE = timedelta(seconds=1)  # network delay allowed after the timer
MAX_POINTS = 1000


def now() -> datetime:
    return datetime.now(UTC)


def err(code: str, message: str, http: int = status.HTTP_409_CONFLICT) -> HTTPException:
    return HTTPException(http, detail={"code": code, "message": message})


# ---------------------------------------------------------------- creating a game


def build_snapshot(activity: Activity) -> list[dict[str, Any]]:
    graded = activity.kind != ActivityKind.poll
    out = []
    for q in activity.questions:
        if q.type.value not in LIVE_TYPES:
            continue
        # Live tiles show text only: a question whose options are pictures without text would
        # be blank tiles on the big screen and on the phones.
        if any(not (o.get("text") or "").strip() for o in (q.options or [])):
            continue
        out.append(
            {
                "id": str(q.id),
                "type": q.type.value,
                "stem": q.stem,
                "stem_image_id": str(q.stem_image_id) if q.stem_image_id else None,
                "options": [
                    {
                        "id": o["id"],
                        "text": o.get("text", ""),
                        "image_id": str(o["image_id"]) if o.get("image_id") else None,
                        "correct": bool(o.get("correct")) and graded,
                    }
                    for o in (q.options or [])
                ],
                "marks": str(q.marks if graded else 0),
                "partial_credit": q.partial_credit,
                "seconds": int(q.time_limit_seconds or DEFAULT_SECONDS),
                "graded": graded,
            }
        )
    return out


async def new_code(session: AsyncSession) -> str:
    """6 digits, unique among open live games and room codes."""
    for _ in range(30):
        code = f"{secrets.randbelow(900000) + 100000}"
        live = await session.scalar(
            select(LiveGame.id).where(LiveGame.code == code, LiveGame.status != LiveStatus.ended)
        )
        room = await session.scalar(
            select(ActivityAssignment.id).where(ActivityAssignment.join_code == code)
        )
        if live is None and room is None:
            return code
    raise err("no_code", "Could not make a join code, try again", 503)


# ---------------------------------------------------------------- nicknames and guests

NICK_RE = re.compile(r"^[\w .'-]{2,20}$", re.UNICODE)
# Kept short on purpose: obvious slurs and insults; the host can also remove any player.
BLOCKED = {
    "fuck", "shit", "bitch", "bastard", "slut", "whore", "cunt", "dick", "pussy", "nigg",
    "rape", "porn", "sex", "chutiya", "madarchod", "bhenchod", "behenchod", "gandu", "randi",
    "lund", "bsdk", "mc", "bc",
}  # fmt: skip


def clean_nickname(raw: str) -> str:
    nick = " ".join(raw.split())
    if not NICK_RE.match(nick):
        raise err("bad_nickname", "Use 2 to 20 letters, numbers or spaces", 422)
    squashed = re.sub(r"[^a-z]", "", nick.lower())
    words = set(re.findall(r"[a-z]+", nick.lower()))
    # long words are caught inside other text; short ones only as whole words (real names)
    if any(b in squashed for b in BLOCKED if len(b) >= 5) or words & BLOCKED:
        raise err("bad_nickname", "Please choose a different nickname", 422)
    return nick


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_guest_token() -> tuple[str, str]:
    t = secrets.token_urlsafe(32)
    return t, token_hash(t)


# ---------------------------------------------------------------- moving through the game


def question(game: LiveGame) -> dict[str, Any] | None:
    if 0 <= game.current_index < len(game.snapshot):
        return game.snapshot[game.current_index]
    return None


def bump(game: LiveGame) -> None:
    game.version += 1


def open_question(game: LiveGame, index: int) -> None:
    if index >= len(game.snapshot):
        end(game)
        return
    q = game.snapshot[index]
    game.current_index = index
    game.status = LiveStatus.question
    game.question_started_at = now() + GET_READY
    game.question_ends_at = game.question_started_at + timedelta(seconds=q["seconds"])
    bump(game)


def end(game: LiveGame) -> None:
    game.status = LiveStatus.ended
    game.ended_at = now()
    game.accepting_joins = False
    bump(game)


def act(game: LiveGame, action: str) -> None:
    """Host buttons. Allowed moves: lobby -> question -> reveal -> leaderboard -> question ...
    -> ended. `end` works from anywhere."""
    s = game.status
    if action == "end":
        if s != LiveStatus.ended:
            end(game)
        return
    if s == LiveStatus.ended:
        raise err("ended", "This game has ended")
    if action == "start" and s == LiveStatus.lobby:
        if not game.snapshot:
            raise err("no_questions", "This game has no questions")
        open_question(game, 0)
    elif action == "reveal" and s == LiveStatus.question:
        game.status = LiveStatus.reveal
        game.question_ends_at = min(game.question_ends_at or now(), now())
        bump(game)
    elif action == "leaderboard" and s == LiveStatus.reveal:
        game.status = LiveStatus.leaderboard
        bump(game)
    elif action == "next" and s in (LiveStatus.reveal, LiveStatus.leaderboard):
        open_question(game, game.current_index + 1)
    elif action == "lock":
        game.accepting_joins = False
        bump(game)
    elif action == "unlock":
        game.accepting_joins = True
        bump(game)
    else:
        raise err("bad_move", f"Cannot {action} now")


# ---------------------------------------------------------------- answers and scoring


def points_for(fraction: Decimal, answer_ms: int, seconds: int) -> int:
    """Up to 1000 for a correct answer; the full amount when instant, half at the last second."""
    if fraction <= 0:
        return 0
    speed = 1 - 0.5 * min(answer_ms, seconds * 1000) / (seconds * 1000)
    return round(MAX_POINTS * float(fraction) * speed)


async def answer(
    session: AsyncSession, game: LiveGame, player: LivePlayer, index: int, response: dict[str, Any]
) -> LiveAnswer:
    q = question(game)
    t = now()
    if game.status != LiveStatus.question or q is None or index != game.current_index:
        raise err("not_open", "This question is not open")
    assert game.question_started_at and game.question_ends_at
    if t < game.question_started_at:
        raise err("not_yet", "Wait for the question to start")
    if t > game.question_ends_at + GRACE:
        raise err("time_up", "Time is up for this question")
    if await session.scalar(
        select(LiveAnswer.id).where(
            LiveAnswer.player_id == player.id, LiveAnswer.question_index == index
        )
    ):
        raise err("answered", "You already answered this question")
    option_ids = {o["id"] for o in q["options"]}
    if q["type"] == "multi_select":
        picked = [c for c in (response.get("choices") or []) if c in option_ids]
        response = {"choices": picked}
    else:
        if response.get("choice") not in option_ids:
            raise err("bad_answer", "Pick one of the options", 422)
        response = {"choice": response["choice"]}

    result = grading.grade(q, response, graded=q["graded"])
    full = Decimal(q["marks"]) if q["graded"] else Decimal("0")
    score = result.score or Decimal("0")
    fraction = (score / full) if full > 0 else Decimal("0")
    ms = int((t - game.question_started_at).total_seconds() * 1000)
    pts = points_for(fraction, ms, q["seconds"])
    counted_marks = Decimal("0") if game.scoring == LiveScoring.fun else score
    ans = LiveAnswer(
        game_id=game.id,
        player_id=player.id,
        question_index=index,
        response=response,
        correct=bool(result.correct),
        marks=counted_marks,
        points=pts,
        answer_ms=ms,
    )
    session.add(ans)
    player.points += pts
    player.marks = (player.marks or Decimal("0")) + counted_marks
    player.answer_ms_total += ms
    return ans


# ---------------------------------------------------------------- views


async def ranked(session: AsyncSession, game: LiveGame) -> list[LivePlayer]:
    rows = list(
        (
            await session.scalars(
                select(LivePlayer).where(
                    LivePlayer.game_id == game.id, LivePlayer.removed.is_(False)
                )
            )
        ).all()
    )
    if game.scoring == LiveScoring.marks:
        rows.sort(key=lambda p: (-(p.marks or 0), p.answer_ms_total, p.nickname_key))
    else:
        rows.sort(key=lambda p: (-p.points, p.answer_ms_total, p.nickname_key))
    return rows


def board_row(p: LivePlayer, rank: int, game: LiveGame) -> dict[str, Any]:
    row: dict[str, Any] = {
        "rank": rank,
        "nickname": p.nickname,
        "points": p.points,
        "guest": p.user_id is None,
    }
    if game.scoring != LiveScoring.fun:
        row["marks"] = str(p.marks)
    return row


def player_question(q: dict[str, Any], game: LiveGame, reveal: bool) -> dict[str, Any]:
    """What a phone sees: the options only (no question text), the key only after the reveal."""
    out: dict[str, Any] = {
        "index": game.current_index,
        "type": q["type"],
        "options": [{"id": o["id"], "text": o["text"]} for o in q["options"]],
        "seconds": q["seconds"],
        "starts_at": game.question_started_at,
        "ends_at": game.question_ends_at,
    }
    if q["type"] == "multi_select":
        out["select_count"] = len(grading.correct_option_ids(q)) or None
    if reveal:
        out["correct_ids"] = sorted(grading.correct_option_ids(q))
    return out


async def answered_count(session: AsyncSession, game: LiveGame) -> int:
    n = await session.scalar(
        select(func.count())
        .select_from(LiveAnswer)
        .join(LivePlayer, LivePlayer.id == LiveAnswer.player_id)
        .where(
            LiveAnswer.game_id == game.id,
            LiveAnswer.question_index == game.current_index,
            LivePlayer.removed.is_(False),
        )
    )
    return int(n or 0)
