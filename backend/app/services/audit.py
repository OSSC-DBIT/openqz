import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog


def record(
    session: AsyncSession,
    action: str,
    actor_id: uuid.UUID | None = None,
    target: str | None = None,
    meta: dict[str, Any] | None = None,
) -> None:
    """Add an audit row to the current transaction (caller commits)."""
    session.add(AuditLog(actor_id=actor_id, action=action, target=target, meta=meta))
