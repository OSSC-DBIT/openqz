import pytest
from httpx import AsyncClient

from app.models import Role
from tests.conftest import PASSWORD, login, make_user


async def test_health(client: AsyncClient) -> None:
    r = await client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


async def test_login_ok_sets_refresh_cookie(client: AsyncClient) -> None:
    await make_user("1DB23CS001")
    r = await client.post(
        "/api/v1/auth/login", json={"email": "1db23cs001@test.dev", "password": PASSWORD}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["role"] == "student"
    assert "openqz_refresh" in r.cookies
    me = await client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"}
    )
    assert me.json()["username"] == "1DB23CS001"


async def test_wrong_password_and_unknown_user_same_error(client: AsyncClient) -> None:
    await make_user("stud1")
    a = await client.post(
        "/api/v1/auth/login", json={"email": "stud1@test.dev", "password": "nope"}
    )
    b = await client.post(
        "/api/v1/auth/login", json={"email": "ghost@test.dev", "password": "nope"}
    )
    assert a.status_code == b.status_code == 401
    assert a.json()["detail"]["code"] == b.json()["detail"]["code"] == "invalid_credentials"


async def test_lockout_after_five_failures(client: AsyncClient) -> None:
    await make_user("stud2")
    for _ in range(5):
        await client.post("/api/v1/auth/login", json={"email": "stud2@test.dev", "password": "bad"})
    r = await client.post(
        "/api/v1/auth/login", json={"email": "stud2@test.dev", "password": PASSWORD}
    )
    assert r.status_code == 423
    assert r.json()["detail"]["code"] == "locked"


async def test_refresh_rotation_and_reuse_detection(client: AsyncClient) -> None:
    await make_user("stud3")
    r = await client.post(
        "/api/v1/auth/login", json={"email": "stud3@test.dev", "password": PASSWORD}
    )
    first = r.cookies["openqz_refresh"]

    r2 = await client.post("/api/v1/auth/refresh", cookies={"openqz_refresh": first})
    assert r2.status_code == 200
    second = r2.cookies["openqz_refresh"]
    assert second != first

    # replaying the old token kills the family, including the new one
    replay = await client.post("/api/v1/auth/refresh", cookies={"openqz_refresh": first})
    assert replay.status_code == 401
    after = await client.post("/api/v1/auth/refresh", cookies={"openqz_refresh": second})
    assert after.status_code == 401


async def test_logout_revokes(client: AsyncClient) -> None:
    await make_user("stud4")
    r = await client.post(
        "/api/v1/auth/login", json={"email": "stud4@test.dev", "password": PASSWORD}
    )
    tok = r.cookies["openqz_refresh"]
    assert (
        await client.post("/api/v1/auth/logout", cookies={"openqz_refresh": tok})
    ).status_code == 204
    assert (
        await client.post("/api/v1/auth/refresh", cookies={"openqz_refresh": tok})
    ).status_code == 401


async def test_forced_password_change_gate(client: AsyncClient) -> None:
    await make_user("fac1", Role.faculty, must_change=True)
    headers = await login(client, "fac1")
    blocked = await client.get("/api/v1/me/teaching", headers=headers)
    assert blocked.status_code == 403
    assert blocked.json()["detail"]["code"] == "password_change_required"

    weak = await client.post(
        "/api/v1/auth/change-password",
        headers=headers,
        json={"current_password": PASSWORD, "new_password": "alllowercase1"},
    )
    assert weak.status_code == 400

    ok = await client.post(
        "/api/v1/auth/change-password",
        headers=headers,
        json={"current_password": PASSWORD, "new_password": "BrandNew9pass"},
    )
    assert ok.status_code == 200
    new_headers = {"Authorization": f"Bearer {ok.json()['access_token']}"}
    assert (await client.get("/api/v1/me/teaching", headers=new_headers)).status_code == 200


async def test_rbac_student_cannot_list_users(client: AsyncClient) -> None:
    await make_user("stud5")
    headers = await login(client, "stud5")
    assert (await client.get("/api/v1/users", headers=headers)).status_code == 403
    assert (await client.get("/api/v1/users")).status_code == 401


async def test_login_email_is_case_insensitive(client: AsyncClient) -> None:
    await make_user("1DB23CS042", email="asha.k@college.edu")
    r = await client.post(
        "/api/v1/auth/login", json={"email": "  Asha.K@College.EDU ", "password": PASSWORD}
    )
    assert r.status_code == 200
    assert r.json()["user"]["username"] == "1DB23CS042"
    assert r.json()["user"]["email"] == "asha.k@college.edu"


async def test_usn_is_not_a_login(client: AsyncClient) -> None:
    await make_user("1DB23CS043")
    r = await client.post("/api/v1/auth/login", json={"email": "1DB23CS043", "password": PASSWORD})
    assert r.status_code == 401
    assert r.json()["detail"]["message"] == "Incorrect email or password"


async def test_auth_config_hides_google_when_not_configured(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.core.config import get_settings

    # independent of whatever GOOGLE_CLIENT_ID the developer's .env has
    monkeypatch.setattr(get_settings(), "google_client_id", None)
    r = await client.get("/api/v1/auth/config")
    assert r.json()["google_client_id"] is None and r.json()["password_login"] is True
    g = await client.post("/api/v1/auth/google", json={"credential": "x" * 40})
    assert g.status_code == 404


async def test_client_ip_ignores_spoofed_forwarded_for(client: AsyncClient) -> None:
    """X-Forwarded-For is client-controlled; only X-Real-IP (set by our edge) counts."""
    from app.core.redis import get_redis

    await make_user("stud8")
    bad = {"email": "stud8@test.dev", "password": "wrong"}
    await client.post(
        "/api/v1/auth/login",
        json=bad,
        headers={"X-Real-IP": "10.0.0.7", "X-Forwarded-For": "1.2.3.4"},
    )
    keys = [k async for k in get_redis().scan_iter("rl:login:*")]
    assert any(":10.0.0.7:" in k for k in keys)
    assert not any("1.2.3.4" in k for k in keys)
