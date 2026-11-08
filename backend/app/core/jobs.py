"""Enqueue background jobs on the ARQ worker; run them inline when no pool exists (tests)."""

from typing import Any

from fastapi import Request


async def enqueue(request: Request, name: str, *args: Any) -> None:
    pool = getattr(request.app.state, "arq", None)
    if pool is not None:
        await pool.enqueue_job(name, *args)
        return
    from app.worker import tasks

    fn = getattr(tasks, name)
    await fn({}, *args)
