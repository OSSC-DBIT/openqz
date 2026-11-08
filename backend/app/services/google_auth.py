"""Verify Google Identity Services ID tokens (the credential from "Sign in with Google").

The browser gets a signed JWT from Google; we check its signature against Google's public
keys, the audience (our client id), issuer and expiry. Only then do we trust the email.
"""

from typing import Any

import anyio
import jwt

from app.core.config import get_settings

GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ("accounts.google.com", "https://accounts.google.com")

_jwks: jwt.PyJWKClient | None = None


class GoogleTokenError(Exception):
    pass


def _client() -> jwt.PyJWKClient:
    global _jwks
    if _jwks is None:
        # Keys are cached in memory; Google rotates them every few days.
        _jwks = jwt.PyJWKClient(GOOGLE_CERTS_URL, cache_keys=True, lifespan=3600, timeout=10)
    return _jwks


def _verify_sync(token: str, client_id: str) -> dict[str, Any]:
    try:
        key = _client().get_signing_key_from_jwt(token)
        claims: dict[str, Any] = jwt.decode(
            token,
            key.key,
            algorithms=["RS256"],
            audience=client_id,
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
            leeway=30,
        )
    except jwt.PyJWTError as exc:
        raise GoogleTokenError(str(exc)) from exc
    if claims.get("iss") not in GOOGLE_ISSUERS:
        raise GoogleTokenError("wrong issuer")
    return claims


async def verify_google_id_token(token: str) -> dict[str, Any]:
    client_id = get_settings().google_client_id
    if not client_id:
        raise GoogleTokenError("Google sign-in is not configured")
    # PyJWKClient fetches keys with blocking urllib: keep it off the event loop.
    return await anyio.to_thread.run_sync(_verify_sync, token, client_id)
