"""Live games (Kahoot-style). Host endpoints need a creator account (faculty, club, admin).
Players join with the code: signed-in users with their name, or guests with a nickname when the
host allows it (guests get a player token for the X-Live-Player header). Phones poll /state."""

import csv
import io
import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.api.v1.activities import get_owned
from app.core.deps import CreatorUser, SessionDep, client_ip
from app.core.redis import get_redis
from app.core.security import decode_access_token
from app.models import (
    Activity,
    ActivityKind,
    LiveAnswer,
    LiveGame,
    LivePlayer,
    LiveScoring,
    LiveStatus,
    Role,
    User,
)
from app.services import audit
from app.services import live_service as live

router = APIRouter(prefix="/live", tags=["live"])
_bearer = HTTPBearer(auto_error=False)


# ---------------------------------------------------------------- helpers


async def optional_user(
    session: SessionDep, creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]
) -> User | None:
    """The signed-in user, or None (guests). A bad or expired token is an error, not a guest."""
    if creds is None:
        return None
    try:
        user_id = uuid.UUID(decode_access_token(creds.credentials)["sub"])
    except (jwt.PyJWTError, KeyError, ValueError) as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token") from exc
    user = await session.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account not available")
    if user.must_change_password:
        raise live.err("password_change_required", "Change your password first", 403)
    return user


MaybeUser = Annotated[User | None, Depends(optional_user)]


async def rate_limit(request: Request, user: User | None, what: str, per_minute: int) -> None:
    who = str(user.id) if user else client_ip(request)
    key = f"rl:live:{what}:{who}:{int(datetime.now(UTC).timestamp() // 60)}"
    r = get_redis()
    n = await r.incr(key)
    if n == 1:
        await r.expire(key, 70)
    if n > per_minute:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many tries, wait a minute")


async def hosted(session: SessionDep, game_id: uuid.UUID, user: User) -> LiveGame:
    game = await session.get(LiveGame, game_id)
    if game is None or (user.role != Role.admin and game.host_id != user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Game not found")
    return game


async def by_code(session: SessionDep, code: str) -> LiveGame:
    game = await session.scalar(
        select(LiveGame)
        .where(LiveGame.code == code.strip(), LiveGame.status != LiveStatus.ended)
        .order_by(LiveGame.created_at.desc())
    )
    if game is None:
        raise live.err("bad_code", "No live game with that code. Check the digits.", 404)
    return game


async def current_player(
    session: SessionDep,
    game: LiveGame,
    user: User | None,
    token: str | None,
) -> LivePlayer:
    q = select(LivePlayer).where(LivePlayer.game_id == game.id)
    if token:
        q = q.where(LivePlayer.guest_token_hash == live.token_hash(token))
    elif user:
        q = q.where(LivePlayer.user_id == user.id)
    else:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Join the game first")
    player = await session.scalar(q)
    if player is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "You are not in this game")
    if player.removed:
        raise live.err("removed", "The host removed you from this game", 403)
    return player


PlayerToken = Annotated[str | None, Header(alias="X-Live-Player")]


# ---------------------------------------------------------------- host


class GameIn(BaseModel):
    activity_id: uuid.UUID
    scoring: LiveScoring = LiveScoring.marks_speed
    allow_guests: bool = False


@router.post("/games", status_code=201)
async def create_game(body: GameIn, session: SessionDep, user: CreatorUser) -> dict[str, Any]:
    owned = await get_owned(session, body.activity_id, user)
    act = await session.scalar(
        select(Activity).where(Activity.id == owned.id).options(selectinload(Activity.questions))
    )
    if act is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activity not found")
    if act.kind not in (ActivityKind.quiz, ActivityKind.poll):
        raise live.err("bad_kind", "Live games work with quizzes and polls")
    snapshot = live.build_snapshot(act)
    if not snapshot:
        raise live.err(
            "no_questions",
            "Live games use multiple choice, true / false and multi-select questions; this "
            "activity has none",
        )
    game = LiveGame(
        activity_id=act.id,
        host_id=user.id,
        title=act.title,
        code=await live.new_code(session),
        scoring=LiveScoring.fun if act.kind == ActivityKind.poll else body.scoring,
        allow_guests=body.allow_guests,
        snapshot=snapshot,
    )
    session.add(game)
    audit.record(session, "live_game_created", actor_id=user.id, target=str(act.id))
    await session.commit()
    return await host_view(session, game)


async def host_view(session: SessionDep, game: LiveGame) -> dict[str, Any]:
    players = await live.ranked(session, game)
    q = live.question(game)
    revealed = game.status in (LiveStatus.reveal, LiveStatus.leaderboard, LiveStatus.ended)
    out: dict[str, Any] = {
        "id": game.id,
        "title": game.title,
        "code": game.code,
        "status": game.status,
        "scoring": game.scoring,
        "allow_guests": game.allow_guests,
        "accepting_joins": game.accepting_joins,
        "index": game.current_index,
        "total": len(game.snapshot),
        "version": game.version,
        "server_now": live.now(),
        "players": [
            {"id": p.id, "nickname": p.nickname, "guest": p.user_id is None} for p in players
        ],
        "question": None,
        "answered": 0,
        "leaderboard": [],
    }
    if q is not None and game.status != LiveStatus.ended:
        out["question"] = {
            "index": game.current_index,
            "type": q["type"],
            "stem": q["stem"],
            "stem_image_id": q["stem_image_id"],
            "seconds": q["seconds"],
            "starts_at": game.question_started_at,
            "ends_at": game.question_ends_at,
            "options": [
                {
                    "id": o["id"],
                    "text": o["text"],
                    **({"correct": o["correct"]} if revealed else {}),
                }
                for o in q["options"]
            ],
        }
        out["answered"] = await live.answered_count(session, game)
        if revealed:
            rows = await session.scalars(
                select(LiveAnswer.response).where(
                    LiveAnswer.game_id == game.id, LiveAnswer.question_index == game.current_index
                )
            )
            counts = {o["id"]: 0 for o in q["options"]}
            for r in rows:
                for c in [r.get("choice")] + list(r.get("choices") or []):
                    if c in counts:
                        counts[c] += 1
            out["counts"] = counts
    if game.status in (LiveStatus.leaderboard, LiveStatus.ended):
        out["leaderboard"] = [live.board_row(p, i + 1, game) for i, p in enumerate(players[:10])]
    return out


@router.get("/games")
async def my_games(session: SessionDep, user: CreatorUser) -> list[dict[str, Any]]:
    q = select(LiveGame).order_by(LiveGame.created_at.desc()).limit(100)
    if user.role != Role.admin:
        q = q.where(LiveGame.host_id == user.id)
    games = (await session.scalars(q)).all()
    out = []
    for g in games:
        n = len(
            (await session.scalars(select(LivePlayer.id).where(LivePlayer.game_id == g.id))).all()
        )
        out.append(
            {
                "id": g.id,
                "title": g.title,
                "code": g.code,
                "status": g.status,
                "scoring": g.scoring,
                "players": n,
                "created_at": g.created_at,
            }
        )
    return out


@router.get("/games/{game_id}")
async def get_game(game_id: uuid.UUID, session: SessionDep, user: CreatorUser) -> dict[str, Any]:
    return await host_view(session, await hosted(session, game_id, user))


@router.post("/games/{game_id}/{action}")
async def game_action(
    game_id: uuid.UUID,
    action: Literal["start", "reveal", "leaderboard", "next", "end", "lock", "unlock"],
    session: SessionDep,
    user: CreatorUser,
) -> dict[str, Any]:
    game = await hosted(session, game_id, user)
    live.act(game, action)
    await session.commit()
    return await host_view(session, game)


@router.delete("/games/{game_id}/players/{player_id}", status_code=204)
async def remove_player(
    game_id: uuid.UUID, player_id: uuid.UUID, session: SessionDep, user: CreatorUser
) -> Response:
    game = await hosted(session, game_id, user)
    p = await session.get(LivePlayer, player_id)
    if p is None or p.game_id != game.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Player not found")
    p.removed = True
    live.bump(game)
    await session.commit()
    return Response(status_code=204)


@router.get("/games/{game_id}/results")
async def results(game_id: uuid.UUID, session: SessionDep, user: CreatorUser) -> dict[str, Any]:
    game = await hosted(session, game_id, user)
    players = await live.ranked(session, game)
    answers = (await session.scalars(select(LiveAnswer).where(LiveAnswer.game_id == game.id))).all()
    by_player: dict[uuid.UUID, list[LiveAnswer]] = {}
    for a in answers:
        by_player.setdefault(a.player_id, []).append(a)
    users = {
        u.id: u
        for u in (
            await session.scalars(
                select(User).where(User.id.in_([p.user_id for p in players if p.user_id]))
            )
        ).all()
    }
    rows = []
    for i, p in enumerate(players):
        mine = by_player.get(p.id, [])
        u = users.get(p.user_id) if p.user_id else None
        rows.append(
            {
                **live.board_row(p, i + 1, game),
                "usn": u.username if u else None,
                "answered": len(mine),
                "correct": sum(1 for a in mine if a.correct),
            }
        )
    questions = []
    for i, q in enumerate(game.snapshot):
        qa = [a for a in answers if a.question_index == i]
        questions.append(
            {
                "index": i,
                "stem": q["stem"],
                "answered": len(qa),
                "correct": sum(1 for a in qa if a.correct),
                "avg_ms": round(sum(a.answer_ms for a in qa) / len(qa)) if qa else None,
            }
        )
    total_marks = sum(float(q["marks"]) for q in game.snapshot)
    return {
        "id": game.id,
        "title": game.title,
        "status": game.status,
        "scoring": game.scoring,
        "created_at": game.created_at,
        "total_marks": None if game.scoring == LiveScoring.fun else total_marks,
        "players": rows,
        "questions": questions,
    }


@router.get("/games/{game_id}/results.csv")
async def results_csv(game_id: uuid.UUID, session: SessionDep, user: CreatorUser) -> Response:
    data = await results(game_id, session, user)
    buf = io.StringIO()
    w = csv.writer(buf)
    fun = data["scoring"] == LiveScoring.fun
    w.writerow(
        [
            "Rank",
            "Name",
            "USN",
            "Guest",
            "Points",
            *([] if fun else ["Marks obtained", "Max marks"]),
            "Answered",
            "Correct",
        ]
    )
    for r in data["players"]:
        w.writerow(
            [r["rank"], r["nickname"], r["usn"] or "", "yes" if r["guest"] else "", r["points"],
             *([] if fun else [r["marks"], data["total_marks"]]), r["answered"], r["correct"]]
        )  # fmt: skip
    name = "".join(c if c.isalnum() else "_" for c in data["title"])[:40] or "live"
    return Response(
        buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{name}_live_results.csv"'},
    )


# ---------------------------------------------------------------- players


@router.get("/join/{code}")
async def preview(
    code: str, request: Request, session: SessionDep, user: MaybeUser
) -> dict[str, Any]:
    await rate_limit(request, user, "preview", 30)
    game = await by_code(session, code)
    host = await session.get(User, game.host_id)
    return {
        "game_id": game.id,
        "title": game.title,
        "host": host.full_name if host else None,
        "questions": len(game.snapshot),
        "status": game.status,
        "open": game.accepting_joins,
        "allow_guests": game.allow_guests,
        "signed_in": user is not None,
    }


class JoinIn(BaseModel):
    code: str = Field(min_length=6, max_length=6)
    nickname: str | None = Field(default=None, max_length=40)


@router.post("/join")
async def join(
    body: JoinIn, request: Request, session: SessionDep, user: MaybeUser
) -> dict[str, Any]:
    await rate_limit(request, user, "join", 20)
    game = await by_code(session, body.code)
    if user is not None:
        existing = await session.scalar(
            select(LivePlayer).where(LivePlayer.game_id == game.id, LivePlayer.user_id == user.id)
        )
        if existing:
            if existing.removed:
                raise live.err("removed", "The host removed you from this game", 403)
            return {"game_id": game.id, "player_id": existing.id, "nickname": existing.nickname}
    if not game.accepting_joins:
        raise live.err("closed", "This game is not taking new players")
    token = None
    if user is not None:
        base = user.full_name.strip()[:36] or user.username
        nick = base
    else:
        if not game.allow_guests:
            raise live.err("sign_in", "Sign in to join this game", 401)
        nick = live.clean_nickname(body.nickname or "")
        base = nick
    for n in range(1, 50):
        candidate = nick if n == 1 else f"{base[:34]} ({n})"
        if user is None and n > 1:
            raise live.err("nickname_taken", "That nickname is taken in this game, pick another")
        player = LivePlayer(
            game_id=game.id,
            user_id=user.id if user else None,
            nickname=candidate,
            nickname_key=candidate.lower(),
        )
        if user is None:
            token, player.guest_token_hash = live.new_guest_token()
        session.add(player)
        try:
            live.bump(game)
            await session.commit()
            break
        except IntegrityError:
            await session.rollback()
            game = await by_code(session, body.code)
    else:
        raise live.err("nickname_taken", "That name is taken in this game")
    out: dict[str, Any] = {"game_id": game.id, "player_id": player.id, "nickname": player.nickname}
    if token:
        out["player_token"] = token  # shown once; the phone keeps it for this game
    return out


@router.get("/play/{game_id}")
async def state(
    game_id: uuid.UUID,
    session: SessionDep,
    user: MaybeUser,
    token: PlayerToken = None,
    since: int | None = None,
) -> dict[str, Any]:
    game = await session.get(LiveGame, game_id)
    if game is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Game not found")
    player = await current_player(session, game, user, token)
    if since is not None and since == game.version and game.status == LiveStatus.lobby:
        return {"unchanged": True, "version": game.version, "server_now": live.now()}
    q = live.question(game)
    revealed = game.status in (LiveStatus.reveal, LiveStatus.leaderboard)
    out: dict[str, Any] = {
        "game_id": game.id,
        "title": game.title,
        "status": game.status,
        "scoring": game.scoring,
        "index": game.current_index,
        "total": len(game.snapshot),
        "version": game.version,
        "server_now": live.now(),
        "me": {"nickname": player.nickname, "points": player.points},
        "question": None,
        "my_answer": None,
    }
    if game.scoring != LiveScoring.fun:
        out["me"]["marks"] = str(player.marks)
    if q is not None and game.status in (
        LiveStatus.question,
        LiveStatus.reveal,
        LiveStatus.leaderboard,
    ):
        out["question"] = live.player_question(q, game, revealed)
        mine = await session.scalar(
            select(LiveAnswer).where(
                LiveAnswer.player_id == player.id, LiveAnswer.question_index == game.current_index
            )
        )
        if mine:
            out["my_answer"] = {"response": mine.response}
            if revealed:
                out["my_answer"] |= {"correct": mine.correct, "points": mine.points}
    if game.status in (LiveStatus.leaderboard, LiveStatus.ended):
        board = await live.ranked(session, game)
        rank = next((i + 1 for i, p in enumerate(board) if p.id == player.id), None)
        out["me"] |= {"rank": rank, "of": len(board)}
        if game.status == LiveStatus.ended:
            out["podium"] = [live.board_row(p, i + 1, game) for i, p in enumerate(board[:3])]
    return out


class AnswerIn(BaseModel):
    index: int
    response: dict[str, Any]


@router.post("/play/{game_id}/answer")
async def submit_answer(
    game_id: uuid.UUID,
    body: AnswerIn,
    session: SessionDep,
    user: MaybeUser,
    token: PlayerToken = None,
) -> dict[str, Any]:
    game = await session.get(LiveGame, game_id, with_for_update=False)
    if game is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Game not found")
    player = await current_player(session, game, user, token)
    await live.answer(session, game, player, body.index, body.response)
    try:
        await session.commit()
    except IntegrityError as exc:  # a double tap racing itself
        await session.rollback()
        raise live.err("answered", "You already answered this question") from exc
    return {"locked": True}
