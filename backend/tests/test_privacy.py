"""Sign-in needs agreement to the privacy policy (ticked on the sign-in page), saved per user."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core import privacy
from app.core.db import SessionLocal
from app.models import AuditLog, Role, User
from tests.conftest import PASSWORD, email_for, make_user

A = "/api/v1/auth/login"


async def _fresh(username: str) -> User:
    u = await make_user(username, Role.student)
    async with SessionLocal() as s:
        row = await s.get(User, u.id)
        assert row is not None
        row.privacy_version = None  # never agreed (like everyone before this feature)
        await s.commit()
    return u


async def test_sign_in_needs_the_tick_once_per_policy_version(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, admin_headers: dict[str, str]
) -> None:
    u = await _fresh("1DB23CS301")
    email = email_for("1DB23CS301")

    # a wrong password says so, never "privacy": nothing to learn about which emails exist
    bad = await client.post(A, json={"email": email, "password": "wrong-one"})
    assert bad.json()["detail"]["code"] == "invalid_credentials"

    # the right password without the tick: refused, nothing saved
    no = await client.post(A, json={"email": email, "password": PASSWORD})
    assert no.status_code == 403 and no.json()["detail"]["code"] == "privacy_required"
    async with SessionLocal() as s:
        row = await s.get(User, u.id)
        assert row is not None and row.privacy_accepted_at is None

    # ticked: signed in, and the agreement is saved with the version and an audit entry
    yes = await client.post(
        A, json={"email": email, "password": PASSWORD, "privacy_accepted": True}
    )
    assert yes.status_code == 200
    async with SessionLocal() as s:
        row = await s.get(User, u.id)
        assert row is not None and row.privacy_accepted_at is not None
        assert row.privacy_version == privacy.PRIVACY_VERSION
        logged = (
            await s.scalars(
                select(AuditLog).where(
                    AuditLog.action == "privacy_accepted", AuditLog.actor_id == u.id
                )
            )
        ).all()
        assert (
            len(logged) == 1
            and logged[0].meta
            and logged[0].meta["version"] == privacy.PRIVACY_VERSION
        )
    shown = (await client.get(f"/api/v1/users/{u.id}", headers=admin_headers)).json()
    assert shown["privacy_version"] == privacy.PRIVACY_VERSION and shown["privacy_accepted_at"]

    # agreed already: no tick needed next time
    assert (await client.post(A, json={"email": email, "password": PASSWORD})).status_code == 200

    # a new policy version asks everyone again
    monkeypatch.setattr("app.services.auth_service.PRIVACY_VERSION", "2099-01-01")
    again = await client.post(A, json={"email": email, "password": PASSWORD})
    assert again.json()["detail"]["code"] == "privacy_required"
    ok = await client.post(A, json={"email": email, "password": PASSWORD, "privacy_accepted": True})
    assert ok.status_code == 200
    async with SessionLocal() as s:
        row = await s.get(User, u.id)
        assert row is not None and row.privacy_version == "2099-01-01"
