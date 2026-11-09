"""live games: host-paced, Kahoot-style play with a join code (players may be guests)

Revision ID: 0011
Revises: 0010
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None

live_status = postgresql.ENUM(
    "lobby", "question", "reveal", "leaderboard", "ended", name="live_status", create_type=False
)
live_scoring = postgresql.ENUM("marks_speed", "marks", "fun", name="live_scoring", create_type=False)


def upgrade() -> None:
    live_status.create(op.get_bind(), checkfirst=True)
    live_scoring.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "live_games",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("activity_id", sa.Uuid(), sa.ForeignKey("activities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("host_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("code", sa.String(6), nullable=False),
        sa.Column("status", live_status, nullable=False, server_default="lobby"),
        sa.Column("scoring", live_scoring, nullable=False, server_default="marks_speed"),
        sa.Column("allow_guests", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("accepting_joins", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("snapshot", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("current_index", sa.Integer(), nullable=False, server_default="-1"),
        sa.Column("question_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("question_ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_live_games_activity_id", "live_games", ["activity_id"])
    op.create_index("ix_live_games_host_id", "live_games", ["host_id"])
    op.create_index("ix_live_games_code", "live_games", ["code"])

    op.create_table(
        "live_players",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("game_id", sa.Uuid(), sa.ForeignKey("live_games.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("nickname", sa.String(40), nullable=False),
        sa.Column("nickname_key", sa.String(40), nullable=False),
        sa.Column("guest_token_hash", sa.String(64), nullable=True),
        sa.Column("points", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("marks", sa.Numeric(8, 2), nullable=False, server_default="0"),
        sa.Column("answer_ms_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("removed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.UniqueConstraint("game_id", "nickname_key", name="uq_live_player_nick"),
    )
    op.create_index("ix_live_players_game_id", "live_players", ["game_id"])
    op.create_index("ix_live_players_user_id", "live_players", ["user_id"])
    op.create_index("ix_live_players_guest_token_hash", "live_players", ["guest_token_hash"])

    op.create_table(
        "live_answers",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("game_id", sa.Uuid(), sa.ForeignKey("live_games.id", ondelete="CASCADE"), nullable=False),
        sa.Column("player_id", sa.Uuid(), sa.ForeignKey("live_players.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question_index", sa.Integer(), nullable=False),
        sa.Column("response", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("correct", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("marks", sa.Numeric(6, 2), nullable=False, server_default="0"),
        sa.Column("points", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("answer_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("player_id", "question_index", name="uq_live_answer"),
    )
    op.create_index("ix_live_answers_game_id", "live_answers", ["game_id"])
    op.create_index("ix_live_answers_player_id", "live_answers", ["player_id"])


def downgrade() -> None:
    op.drop_table("live_answers")
    op.drop_table("live_players")
    op.drop_table("live_games")
    live_scoring.drop(op.get_bind(), checkfirst=True)
    live_status.drop(op.get_bind(), checkfirst=True)
