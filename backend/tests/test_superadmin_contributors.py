"""Super admins and day-to-day admins; the contributor list for the landing page."""

from typing import Any

import pytest
from httpx import AsyncClient

from app.core.db import SessionLocal
from app.models import Role
from app.services import contributors
from tests.conftest import login, make_user

A = "/api/v1"


async def test_plain_admin_runs_the_day_to_day_but_not_the_keys(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    boss = await client.get(f"{A}/auth/me", headers=admin_headers)
    assert boss.json()["is_superadmin"] is True

    # only a super admin makes another admin; the new one is a plain admin unless told otherwise
    made = await client.post(
        f"{A}/users",
        headers=admin_headers,
        json={
            "username": "OFFICE1",
            "full_name": "Office",
            "email": "office@test.dev",
            "role": "admin",
        },
    )
    assert made.status_code == 201, made.text
    assert made.json()["user"]["is_superadmin"] is False
    await make_user("OFFICE2", Role.admin, full_name="Office Two", superadmin=False)
    office = await login(client, "OFFICE2")
    assert (await client.get(f"{A}/auth/me", headers=office)).json()["is_superadmin"] is False

    # day-to-day work is open: people, classes, statistics
    assert (await client.get(f"{A}/users", headers=office)).status_code == 200
    assert (await client.get(f"{A}/departments", headers=office)).status_code == 200
    assert (await client.get(f"{A}/admin/stats", headers=office)).status_code == 200
    student = await client.post(
        f"{A}/users",
        headers=office,
        json={
            "username": "1DB23CS300",
            "full_name": "New",
            "email": "new@test.dev",
            "role": "student",
        },
    )
    assert student.status_code == 201, student.text
    sid = student.json()["user"]["id"]
    assert (await client.post(f"{A}/users/{sid}/reset-password", headers=office)).status_code == 200

    # the keys are not: admin accounts, the audit log, permanent deletes
    more = await client.post(
        f"{A}/users",
        headers=office,
        json={"username": "OFFICE3", "full_name": "x", "email": "o3@test.dev", "role": "admin"},
    )
    assert more.status_code == 403 and more.json()["detail"]["code"] == "superadmin_only"
    boss_id = boss.json()["id"]
    assert (
        await client.patch(f"{A}/users/{boss_id}", headers=office, json={"is_active": False})
    ).status_code == 403
    assert (
        await client.post(f"{A}/users/{boss_id}/reset-password", headers=office)
    ).status_code == 403
    me = (await client.get(f"{A}/auth/me", headers=office)).json()["id"]
    assert (
        await client.patch(f"{A}/users/{me}", headers=office, json={"is_superadmin": True})
    ).status_code == 403
    assert (await client.get(f"{A}/audit", headers=office)).status_code == 403
    assert (
        await client.get(f"{A}/admin/data/users/{sid}/impact", headers=office)
    ).status_code == 403

    # a super admin can promote, but cannot drop their own rights or promote a non-admin
    up = await client.patch(f"{A}/users/{me}", headers=admin_headers, json={"is_superadmin": True})
    assert up.status_code == 200 and up.json()["is_superadmin"] is True
    assert (
        await client.patch(
            f"{A}/users/{boss_id}", headers=admin_headers, json={"is_superadmin": False}
        )
    ).status_code == 400
    assert (
        await client.patch(f"{A}/users/{sid}", headers=admin_headers, json={"is_superadmin": True})
    ).status_code == 400
    assert (await client.get(f"{A}/audit", headers=admin_headers)).status_code == 200


def test_bots_and_ai_assistants_are_not_contributors() -> None:
    def row(login: str, kind: str = "User") -> dict[str, Any]:
        return {"login": login, "type": kind}

    assert contributors.is_person(row("mithun"))
    for bot in ("claude", "Claude-Code", "dependabot[bot]", "github-actions[bot]", "copilot"):
        assert not contributors.is_person(row(bot)), bot
    assert not contributors.is_person(row("some-app", "Bot"))
    assert not contributors.is_person(row(""))


async def test_contributors_are_fetched_stored_and_served(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    empty = await client.get(f"{A}/site/contributors")  # public: no sign-in
    assert empty.status_code == 200 and empty.json()["people"] == []
    assert empty.headers["cache-control"] == "no-store"  # an empty list is never kept

    calls: list[str] = []
    people = [
        {
            "login": "asha",
            "name": "Asha K",
            "avatar": "data:image/png;base64,AAAA",
            "url": "https://github.com/asha",
            "contributions": 12,
        }
    ]

    def fake(repo: str) -> list[dict[str, Any]]:
        calls.append(repo)
        return people

    monkeypatch.setattr(contributors, "fetch_contributors", fake)
    monkeypatch.setattr(contributors.get_settings(), "github_repo", "OSSC-DBIT/openqz")
    async with SessionLocal() as s:
        assert await contributors.refresh(s) == 1
    async with SessionLocal() as s:
        assert await contributors.refresh(s) == -1  # fresh: GitHub is not asked again
    assert calls == ["OSSC-DBIT/openqz"]

    got = await client.get(f"{A}/site/contributors")
    assert got.json()["people"] == people and got.json()["updated_at"]
    assert "max-age" in got.headers["cache-control"]

    # GitHub down: the stored list stays
    def broken(repo: str) -> list[dict[str, Any]]:
        raise OSError("no network")

    monkeypatch.setattr(contributors, "fetch_contributors", broken)
    async with SessionLocal() as s:
        assert await contributors.refresh(s, force=True) == -1
    assert (await client.get(f"{A}/site/contributors")).json()["people"] == people


async def test_an_empty_store_fills_itself_on_the_first_visit(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A new server or a restored database has no list: the first visitor triggers the fetch
    (once), and the next one sees it. Nobody waits for the worker's twice-a-day run."""
    from app.core.redis import get_redis

    await get_redis().delete("site:contributors:refresh")
    calls: list[str] = []

    def fake(repo: str) -> list[dict[str, Any]]:
        calls.append(repo)
        return [{"login": "asha", "name": "Asha", "avatar": None, "url": "u", "contributions": 1}]

    monkeypatch.setattr(contributors, "fetch_contributors", fake)
    monkeypatch.setattr(contributors.get_settings(), "github_repo", "OSSC-DBIT/openqz")
    await client.get(f"{A}/site/contributors")
    await client.get(f"{A}/site/contributors")
    got = await client.get(f"{A}/site/contributors")
    assert [p["login"] for p in got.json()["people"]] == ["asha"]
    assert calls == ["OSSC-DBIT/openqz"]  # asked once, not on every visit
    await get_redis().delete("site:contributors:refresh")
