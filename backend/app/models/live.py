"""Live games (Kahoot-style): the host's screen shows each question, players' phones show only
the answer options, everyone moves to the next question together when the host says so."""

import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.base import Timestamped, UUIDPk


class LiveStatus(enum.StrEnum):
    lobby = "lobby"  # players join, host waits
    question = "question"  # a question is open for answers
    reveal = "reveal"  # time is up: correct answer and the answer counts on the big screen
    leaderboard = "leaderboard"  # top players after this question
    ended = "ended"  # podium; results kept as a report


class LiveScoring(enum.StrEnum):
    marks_speed = "marks_speed"  # marks, and faster correct answers earn more leaderboard points
    marks = "marks"  # marks only; ties broken by total answer time
    fun = "fun"  # leaderboard points only, nothing counted as marks


class LiveGame(UUIDPk, Timestamped, Base):
    __tablename__ = "live_games"

    activity_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("activities.id", ondelete="CASCADE"), index=True
    )
    host_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    code: Mapped[str] = mapped_column(String(6), index=True)
    status: Mapped[LiveStatus] = mapped_column(
        Enum(LiveStatus, name="live_status"), default=LiveStatus.lobby
    )
    scoring: Mapped[LiveScoring] = mapped_column(
        Enum(LiveScoring, name="live_scoring"), default=LiveScoring.marks_speed
    )
    allow_guests: Mapped[bool] = mapped_column(Boolean, default=False)
    accepting_joins: Mapped[bool] = mapped_column(Boolean, default=True)
    # Questions frozen when the game is created (with the answer key; never sent to players).
    snapshot: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    current_index: Mapped[int] = mapped_column(Integer, default=-1)
    question_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    question_ends_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Bumped on every change, so phones can poll cheaply ("anything new since version N?").
    version: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LivePlayer(UUIDPk, Timestamped, Base):
    __tablename__ = "live_players"
    __table_args__ = (UniqueConstraint("game_id", "nickname_key", name="uq_live_player_nick"),)

    game_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("live_games.id", ondelete="CASCADE"), index=True
    )
    # Signed-in student, or None for a guest who joined with a nickname.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    nickname: Mapped[str] = mapped_column(String(40))
    nickname_key: Mapped[str] = mapped_column(String(40))  # lower-case, for uniqueness
    guest_token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    points: Mapped[int] = mapped_column(Integer, default=0)
    marks: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=Decimal("0"))
    answer_ms_total: Mapped[int] = mapped_column(Integer, default=0)
    removed: Mapped[bool] = mapped_column(Boolean, default=False)


class LiveAnswer(UUIDPk, Timestamped, Base):
    __tablename__ = "live_answers"
    __table_args__ = (UniqueConstraint("player_id", "question_index", name="uq_live_answer"),)

    game_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("live_games.id", ondelete="CASCADE"), index=True
    )
    player_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("live_players.id", ondelete="CASCADE"), index=True
    )
    question_index: Mapped[int] = mapped_column(Integer)
    response: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    correct: Mapped[bool] = mapped_column(Boolean, default=False)
    marks: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=Decimal("0"))
    points: Mapped[int] = mapped_column(Integer, default=0)
    answer_ms: Mapped[int] = mapped_column(Integer, default=0)
