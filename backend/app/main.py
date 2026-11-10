from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import Response

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.core.redis import close_redis


def create_app(*, with_worker_pool: bool = True) -> FastAPI:
    settings = get_settings()
    configure_logging(settings.debug)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        settings.media_dir.mkdir(parents=True, exist_ok=True)
        app.state.arq = None
        if with_worker_pool:
            from arq import create_pool
            from arq.connections import RedisSettings

            app.state.arq = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        yield
        if app.state.arq is not None:
            await app.state.arq.aclose()
        await close_redis()

    # Swagger and the OpenAPI document are a development tool: on staging and production
    # both URLs answer 404, so the API surface is not advertised to visitors.
    api_docs = not settings.is_production
    app = FastAPI(
        title="OpenQZ API",
        version="0.1.0",
        docs_url="/api/docs" if api_docs else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if api_docs else None,
        lifespan=lifespan,
    )

    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts + ["test"])
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-Live-Player"],
        max_age=600,
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):  # type: ignore[no-untyped-def]
        response: Response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        if request.url.path.startswith("/api/v1"):
            response.headers.setdefault("Cache-Control", "no-store")
            # API answers are data, never pages: no site may frame them, load them as a
            # resource from another origin, or run anything if one is opened directly.
            response.headers.setdefault("X-Frame-Options", "DENY")
            response.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
            response.headers.setdefault(
                "Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"
            )
        return response

    app.include_router(api_router)
    return app


app = create_app()
