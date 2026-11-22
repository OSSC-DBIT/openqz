"""Personal details are stored encrypted (app/core/crypto.py) and everything still works."""

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from app.core import crypto
from app.core.config import Settings, get_settings
from app.core.db import SessionLocal
from app.models import Role
from tests.conftest import PASSWORD, email_for, login, make_user

A = "/api/v1"


async def _raw(sql: str, **params: object) -> list[tuple[object, ...]]:
    async with SessionLocal() as s:
        return [tuple(r) for r in (await s.execute(text(sql), params)).all()]


def test_encrypt_round_trip_is_random_and_detects_tampering() -> None:
    a, b = crypto.encrypt("asha@example.com"), crypto.encrypt("asha@example.com")
    assert a != b and a.startswith("v1:")  # a fresh nonce every time
    assert crypto.decrypt(a) == crypto.decrypt(b) == "asha@example.com"
    broken = a[:-4] + ("AAAA" if not a.endswith("AAAA") else "BBBB")
    with pytest.raises(crypto.DecryptError):
        crypto.decrypt(broken)
    assert crypto.decrypt("plain, from before encryption") == "plain, from before encryption"
    # the lookup hash ignores case and spaces in emails, and formatting in phone numbers
    assert crypto.email_index(" Asha@Example.COM ") == crypto.email_index("asha@example.com")
    assert crypto.phone_index("+91 98765 43210") == crypto.phone_index("9876543210")
    assert crypto.mask_email("rahul.shetty@example.edu") == "ra***@example.edu"


def test_a_different_key_cannot_read(monkeypatch: pytest.MonkeyPatch) -> None:
    sealed = crypto.encrypt("9876543210")
    monkeypatch.setattr(get_settings(), "data_key", "Zm9yLXRlc3RzLW9ubHktMzItYnl0ZXMtbG9uZy0hISE=")
    crypto.reset_keys()
    try:
        with pytest.raises(crypto.DecryptError):
            crypto.decrypt(sealed)
    finally:
        monkeypatch.undo()
        crypto.reset_keys()


def test_staging_and_production_refuse_to_start_without_a_data_key() -> None:
    base = {
        "jwt_secret": "x" * 32,
        "cors_origins": ["https://openqz.example.org"],
        "allowed_hosts": ["openqz.example.org"],
    }
    with pytest.raises(ValueError, match="DATA_KEY"):
        Settings(environment="production", data_key="", **base)  # type: ignore[arg-type]
    Settings(environment="production", data_key="a" * 44, **base)  # type: ignore[arg-type]


async def test_emails_and_phones_are_stored_encrypted_and_still_work(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    r = await client.post(
        f"{A}/users",
        headers=admin_headers,
        json={
            "username": "1DB23CS501",
            "full_name": "Asha K",
            "email": "Asha.K@Example.com",
            "phone": "+91 98765 43210",
            "role": "student",
        },
    )
    assert r.status_code == 201, r.text
    uid = r.json()["user"]["id"]
    temp = r.json()["temporary_password"]

    # on disk: ciphertext and keyed hashes, never the address or the number
    email, phone, eh, ph = (
        await _raw("select email, phone, email_hash, phone_hash from users where id = :i", i=uid)
    )[0]
    assert str(email).startswith("v1:") and "asha" not in str(email).lower()
    assert str(phone).startswith("v1:") and "98765" not in str(phone)
    assert eh == crypto.email_index("asha.k@example.com") and ph == crypto.phone_index("9876543210")

    # the API shows them as plain text to an admin
    got = (await client.get(f"{A}/users/{uid}", headers=admin_headers)).json()
    assert got["email"] == "asha.k@example.com" and got["phone"] == "+91 98765 43210"

    # sign-in by email, in any case
    ok = await client.post(
        f"{A}/auth/login",
        json={"email": "ASHA.K@example.COM", "password": temp, "privacy_accepted": True},
    )
    assert ok.status_code == 200

    # search: the whole email or phone number finds the person; names still match in part
    for q in ("asha.k@example.com", "9876543210", "Asha", "CS501"):
        res = (await client.get(f"{A}/users", headers=admin_headers, params={"q": q})).json()
        assert uid in [u["id"] for u in res["items"]], q

    # the same email in another case is still taken
    dup = await client.post(
        f"{A}/users",
        headers=admin_headers,
        json={
            "username": "1DB23CS502",
            "full_name": "Other",
            "email": "ASHA.K@EXAMPLE.COM",
            "role": "student",
        },
    )
    assert dup.status_code in (400, 409, 422)

    # changing the email moves the lookup hash with it
    upd = await client.patch(
        f"{A}/users/{uid}", headers=admin_headers, json={"email": "asha.new@example.com"}
    )
    assert upd.status_code == 200, upd.text
    (eh2,) = (await _raw("select email_hash from users where id = :i", i=uid))[0]
    assert eh2 == crypto.email_index("asha.new@example.com")


async def test_failed_sign_ins_are_logged_with_a_masked_email(client: AsyncClient) -> None:
    await make_user("ADM", Role.admin, superadmin=True)
    await client.post(
        f"{A}/auth/login", json={"email": "someone.secret@example.org", "password": "nope-nope"}
    )
    targets = [
        t for (t,) in await _raw("select target from audit_log where action = 'login_failed'")
    ]
    assert "so***@example.org" in targets and not any("someone.secret" in str(t) for t in targets)
    # and the right password still signs a known user in
    assert (
        await client.post(f"{A}/auth/login", json={"email": email_for("ADM"), "password": PASSWORD})
    ).status_code == 200
    assert await login(client, "ADM")


async def test_import_rows_are_stored_encrypted(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    sheet = "Roll No,Student Name,Branch,Sem,Section,Email ID\n1DB23CS777,Kiran Gowda,CSE,5,A,kiran.secret@example.edu\n"
    r = await client.post(
        f"{A}/imports",
        headers=admin_headers,
        data={"kind": "students", "academic_year": "2026-27"},
        files={"file": ("students.csv", sheet.encode(), "text/csv")},
    )
    assert r.status_code in (200, 201, 202), r.text
    job_id = r.json()["id"]
    rows = await _raw(
        "select coalesce(preview_rows, ''), coalesce(error_rows, '') from import_jobs where id = :i",
        i=job_id,
    )
    for value in rows[0]:
        assert "kiran.secret" not in str(value) and "Kiran Gowda" not in str(value)
