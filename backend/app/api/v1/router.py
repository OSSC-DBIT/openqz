from fastapi import APIRouter

from app.api.v1 import (
    activities,
    admin_data,
    auth,
    health,
    imports,
    integrity,
    live,
    media,
    org,
    play,
    results,
    stats,
    users,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(org.router)
api_router.include_router(imports.router)
api_router.include_router(integrity.router)
api_router.include_router(activities.router)
api_router.include_router(results.router)
api_router.include_router(play.router)
api_router.include_router(live.router)
api_router.include_router(media.router)
api_router.include_router(users.audit_router)
api_router.include_router(stats.router)
api_router.include_router(admin_data.router)
