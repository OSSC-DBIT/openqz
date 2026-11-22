"""Encryption of personal details in the database.

Email addresses, phone numbers and the rows of an uploaded people sheet are stored encrypted with
AES-256-GCM (a fresh random nonce each time, so the same email encrypts differently every time,
and any change to the stored bytes is detected). A stored value looks like "v1:<base64>"; the "v1"
names the key, so the key can be rotated later without guessing.

Encrypted values cannot be compared in SQL, so each looked-up field also has a "blind index": an
HMAC-SHA256 of the normalised value under a separate key (`email_hash`, `phone_hash`). Sign-in,
Google sign-in, password reset, imports and exact search use it; nobody can reverse it without the
key.

The key is DATA_KEY (32 random bytes, base64): `python -c "import secrets,base64;
print(base64.b64encode(secrets.token_bytes(32)).decode())"`. Staging and production refuse to start
without it. In development and tests it is derived from JWT_SECRET. Losing DATA_KEY means losing
every email and phone number: keep it with the database backups, in a different place.
"""

import base64
import hashlib
import hmac
import json
import os
import re
from functools import lru_cache
from typing import Any

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from sqlalchemy import Text
from sqlalchemy.engine import Dialect
from sqlalchemy.types import TypeDecorator

from app.core.config import get_settings

VERSION = "v1"
PREFIX = f"{VERSION}:"


class DecryptError(ValueError):
    """A stored value was changed, or was encrypted with another key."""


def _derive(master: bytes, info: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=b"openqz-data", info=info).derive(master)


@lru_cache
def _keys() -> tuple[AESGCM, bytes]:
    s = get_settings()
    if s.data_key:
        master = base64.b64decode(s.data_key)
        if len(master) != 32:
            raise ValueError("DATA_KEY must be 32 bytes, base64 encoded")
    else:
        # development and tests only (the settings refuse staging / production without DATA_KEY)
        master = hashlib.sha256(b"openqz-dev-data-key|" + s.jwt_secret.encode()).digest()
    return AESGCM(_derive(master, b"encrypt")), _derive(master, b"blind-index")


def reset_keys() -> None:
    """Forget the cached keys (tests that change DATA_KEY)."""
    _keys.cache_clear()


def encrypt(value: str) -> str:
    aes, _ = _keys()
    nonce = os.urandom(12)
    sealed = aes.encrypt(nonce, value.encode(), VERSION.encode())
    return PREFIX + base64.urlsafe_b64encode(nonce + sealed).decode()


def decrypt(stored: str) -> str:
    if not stored.startswith(PREFIX):
        return stored  # a row written before encryption (the migration encrypts them all)
    aes, _ = _keys()
    raw = base64.urlsafe_b64decode(stored[len(PREFIX) :])
    try:
        return aes.decrypt(raw[:12], raw[12:], VERSION.encode()).decode()
    except Exception as exc:  # cryptography raises InvalidTag
        raise DecryptError(
            "an encrypted value could not be read: wrong DATA_KEY or changed data"
        ) from exc


def normalize_email(email: str) -> str:
    return email.strip().lower()


def normalize_phone(phone: str) -> str:
    """Digits only, the last 10 (so "+91 98765 43210" and "9876543210" match)."""
    return re.sub(r"\D", "", phone)[-10:]


def blind_index(value: str, kind: str) -> str:
    _, key = _keys()
    return hmac.new(key, f"{kind}|{value}".encode(), hashlib.sha256).hexdigest()


def email_index(email: str | None) -> str | None:
    return blind_index(normalize_email(email), "email") if email and email.strip() else None


def phone_index(phone: str | None) -> str | None:
    digits = normalize_phone(phone) if phone else ""
    return blind_index(digits, "phone") if digits else None


def mask_email(email: str) -> str:
    """For logs: enough to recognise ("ra***@example.edu"), not the whole address."""
    e = normalize_email(email)
    name, _, domain = e.partition("@")
    return f"{name[:2]}***@{domain}" if domain else f"{e[:2]}***"


class Encrypted(TypeDecorator[str]):
    """A text column stored encrypted; the application reads and writes plain text."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value: str | None, dialect: Dialect) -> str | None:
        return None if value is None else encrypt(value)

    def process_result_value(self, value: str | None, dialect: Dialect) -> str | None:
        return None if value is None else decrypt(value)


class EncryptedJSON(TypeDecorator[Any]):
    """A JSON value stored encrypted as a whole (read and written in one piece)."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value: Any, dialect: Dialect) -> str | None:
        return None if value is None else encrypt(json.dumps(value, ensure_ascii=False))

    def process_result_value(self, value: str | None, dialect: Dialect) -> Any:
        return None if value is None else json.loads(decrypt(value))
