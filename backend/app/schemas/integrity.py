import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class IntegrityEventIn(BaseModel):
    kind: str = Field(min_length=1, max_length=48, pattern=r"^[a-z0-9_]+$")
    at: datetime
    attempt_id: uuid.UUID | None = None
    meta: dict[str, Any] | None = None


class IntegrityBatchIn(BaseModel):
    # Random id the player generates per page load, to group events from one session.
    session_id: str = Field(min_length=8, max_length=64)
    events: list[IntegrityEventIn] = Field(min_length=1, max_length=100)


class IntegrityEventOut(BaseModel):
    id: int
    user_id: uuid.UUID
    username: str
    full_name: str
    session_id: str
    attempt_id: uuid.UUID | None
    kind: str
    client_at: datetime
    received_at: datetime
    meta: dict[str, Any] | None
