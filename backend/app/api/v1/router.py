from fastapi import APIRouter

from app.api.v1 import (
    activities,
    auth,
    health,
    imports,
    integrity,
    media,
    org,
    play,
    results,
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
api_router.include_router(media.router)
api_router.include_router(users.audit_router)
