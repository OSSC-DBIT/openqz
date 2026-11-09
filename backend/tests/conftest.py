"""Test setup: uses a separate Postgres database (openqz_test) and the real Redis.

Run inside the dev stack:  docker compose -f compose.yaml -f compose.dev.yaml exec api pytest
"""

import os

_base = os.environ.get("DATABASE_URL", "postgresql+asyncpg://openqz:openqz@db:5432/openqz")
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", _base.rsplit("/", 1)[0] + "/openqz_test"
)
os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret")
os.environ["MEDIA_DIR"] = "/tmp/openqz-test-media"
os.environ["COOKIE_SECURE"] = "false"
os.environ["LOGIN_RATE_PER_MINUTE"] = "1000"
# Optional integrations start switched off, whatever the developer's .env says; tests that need
# them turn them on with monkeypatch. (A real SMTP_HOST made every email-sending test wait for
# a network timeout.)
for _k in ("SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "GOOGLE_CLIENT_ID", "GOOGLE_ALLOWED_DOMAINS"):
    os.environ[_k] = ""

from collections.abc import AsyncIterator  # noqa: E402

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.config import get_settings  # noqa: E402

get_settings.cache_clear()

from app.core.db import Base, SessionLocal, engine  # noqa: E402
from app.core.redis import get_redis  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import Role, User  # noqa: E402

PASSWORD = "Passw0rd!x"


@pytest.fixture(scope="session", autouse=True)
async def _schema() -> AsyncIterator[None]:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


@pytest.fixture(autouse=True)
async def _clean() -> AsyncIterator[None]:
    yield
    tables = ", ".join(t.name for t in reversed(Base.metadata.sorted_tables))
    async with engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    r = get_redis()
    async for key in r.scan_iter("rl:*"):
        await r.delete(key)


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    app = create_app(with_worker_pool=False)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def email_for(username: str) -> str:
    return f"{username.lower()}@test.dev"


async def make_user(
    username: str,
    role: Role = Role.student,
    must_change: bool = False,
    full_name: str = "Test User",
    email: str | None = None,
) -> User:
    async with SessionLocal() as s:
        u = User(
            username=username,
            email=email or email_for(username),
            full_name=full_name,
            role=role,
            password_hash=hash_password(PASSWORD),
            must_change_password=must_change,
        )
        s.add(u)
        await s.commit()
        await s.refresh(u)
        return u


async def login(client: AsyncClient, username: str, password: str = PASSWORD) -> dict[str, str]:
    r = await client.post(
        "/api/v1/auth/login", json={"email": email_for(username), "password": password}
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
async def admin_headers(client: AsyncClient) -> dict[str, str]:
    await make_user("admin", Role.admin, full_name="Admin")
    return await login(client, "admin")
