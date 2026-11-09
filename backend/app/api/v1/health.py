from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import get_settings
from app.core.db import engine
from app.core.redis import get_redis

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> JSONResponse:
    checks = {"db": "ok", "redis": "ok"}
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:
        checks["db"] = "down"
    try:
        await get_redis().ping()
    except Exception:
        checks["redis"] = "down"
    healthy = all(v == "ok" for v in checks.values())
    return JSONResponse(
        {
            "status": "ok" if healthy else "degraded",
            "version": get_settings().app_version,
            **checks,
        },
        status_code=200 if healthy else 503,
    )
