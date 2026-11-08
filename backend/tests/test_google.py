"""Google sign-in, with a local RSA key standing in for Google's signing key."""

import time
from collections.abc import Iterator
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from httpx import AsyncClient

from app.core.config import get_settings
from app.models import Role
from app.services import google_auth
from tests.conftest import PASSWORD, login, make_user

CLIENT_ID = "test-client.apps.googleusercontent.com"
_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)


class _FakeJWKClient:
    def get_signing_key_from_jwt(self, token: str) -> Any:
        return type("K", (), {"key": _key.public_key()})()


@pytest.fixture(autouse=True)
def google_enabled(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    s = get_settings()
    monkeypatch.setattr(s, "google_client_id", CLIENT_ID)
    monkeypatch.setattr(s, "google_allowed_domains", [])
    monkeypatch.setattr(google_auth, "_client", lambda: _FakeJWKClient())
    yield


def id_token(email: str, sub: str = "google-sub-1", **over: Any) -> str:
    now = int(time.time())
    claims = {
        "iss": "https://accounts.google.com",
        "aud": CLIENT_ID,
        "sub": sub,
        "email": email,
        "email_verified": True,
        "iat": now,
        "exp": now + 600,
        **over,
    }
    return jwt.encode(claims, _key, algorithm="RS256")


async def google(client: AsyncClient, token: str):  # type: ignore[no-untyped-def]
    return await client.post("/api/v1/auth/google", json={"credential": token})


async def test_config_exposes_client_id(client: AsyncClient) -> None:
    r = await client.get("/api/v1/auth/config")
    assert r.json()["google_client_id"] == CLIENT_ID


async def test_imported_user_signs_in_and_temp_password_is_cancelled(client: AsyncClient) -> None:
    await make_user("1DB23CS001", must_change=True, email="asha@gmail.com")
    r = await google(client, id_token("Asha@Gmail.com"))
    assert r.status_code == 200, r.text
    me = r.json()["user"]
    assert me["username"] == "1DB23CS001"
    assert me["must_change_password"] is False  # Google proved identity
    assert me["google_linked"] is True
    assert "openqz_refresh" in r.cookies

    # the printed temporary password no longer works
    pw = await client.post(
        "/api/v1/auth/login", json={"email": "asha@gmail.com", "password": PASSWORD}
    )
    assert pw.status_code == 401

    # and the session works for normal routes (no forced password change)
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert (await client.get("/api/v1/me/sections", headers=h)).status_code == 200


async def test_password_still_works_for_users_who_already_set_one(client: AsyncClient) -> None:
    await make_user("fac9", Role.faculty)
    assert (await google(client, id_token("fac9@test.dev"))).status_code == 200
    await login(client, "fac9")  # own password untouched


async def test_unknown_email_is_refused(client: AsyncClient) -> None:
    r = await google(client, id_token("stranger@gmail.com"))
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "google_no_account"


async def test_unverified_email_is_refused(client: AsyncClient) -> None:
    await make_user("stud1")
    r = await google(client, id_token("stud1@test.dev", email_verified=False))
    assert r.json()["detail"]["code"] == "google_unverified"


async def test_other_google_account_with_same_email_is_refused(client: AsyncClient) -> None:
    await make_user("stud2")
    assert (await google(client, id_token("stud2@test.dev", sub="A"))).status_code == 200
    r = await google(client, id_token("stud2@test.dev", sub="B"))
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "google_mismatch"


@pytest.mark.parametrize(
    "bad",
    [
        {"aud": "someone-else.apps.googleusercontent.com"},
        {"iss": "https://evil.example.com"},
        {"exp": int(time.time()) - 3600},
    ],
)
async def test_bad_tokens_are_rejected(client: AsyncClient, bad: dict[str, Any]) -> None:
    await make_user("stud3")
    r = await google(client, id_token("stud3@test.dev", **bad))
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == "google_invalid"


async def test_token_signed_by_another_key_is_rejected(client: AsyncClient) -> None:
    await make_user("stud4")
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = int(time.time())
    forged = jwt.encode(
        {
            "iss": "accounts.google.com",
            "aud": CLIENT_ID,
            "sub": "x",
            "email": "stud4@test.dev",
            "email_verified": True,
            "iat": now,
            "exp": now + 600,
        },
        other,
        algorithm="RS256",
    )
    assert (await google(client, forged)).status_code == 401


async def test_domain_allow_list(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "google_allowed_domains", ["dbit.in"])
    await make_user("stud5", email="stud5@gmail.com")
    r = await google(client, id_token("stud5@gmail.com"))
    assert r.json()["detail"]["code"] == "google_domain"


async def test_disabled_account_is_refused(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    u = await make_user("stud6")
    await client.patch(f"/api/v1/users/{u.id}", headers=admin_headers, json={"is_active": False})
    assert (await google(client, id_token("stud6@test.dev"))).status_code == 403


async def test_changing_email_unlinks_google(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    u = await make_user("stud7")
    assert (await google(client, id_token("stud7@test.dev", sub="S7"))).status_code == 200
    r = await client.patch(
        f"/api/v1/users/{u.id}", headers=admin_headers, json={"email": "New.Mail@Gmail.com"}
    )
    assert r.json()["email"] == "new.mail@gmail.com"
    assert r.json()["google_linked"] is False
    assert (await google(client, id_token("new.mail@gmail.com", sub="S7-new"))).status_code == 200
