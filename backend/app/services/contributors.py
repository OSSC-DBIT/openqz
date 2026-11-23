"""People who built OpenQZ, read from the repository's contributor list on GitHub.

Fetched twice a day by the worker and stored (table `site_cache`), so the landing page never
waits on GitHub and visitors' browsers never talk to it: each avatar is stored as a small
image inside the saved list. Bots and AI assistants are left out."""

import base64
import json
import urllib.error
import urllib.request
from datetime import UTC, datetime, timedelta
from typing import Any

import anyio
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import SiteCache

KEY = "contributors"
STALE_AFTER = timedelta(hours=12)
MAX_PEOPLE = 60
AVATAR_PX = 96
MAX_AVATAR_BYTES = 200 * 1024
# Not people: automation accounts and AI coding assistants.
EXCLUDED_WORDS = ("claude", "copilot", "dependabot", "github-actions", "renovate", "codex", "devin")


def is_person(row: dict[str, Any]) -> bool:
    login = str(row.get("login") or "").lower()
    if not login or row.get("type") != "User":
        return False
    return not login.endswith("[bot]") and not any(w in login for w in EXCLUDED_WORDS)


def _get(url: str, *, accept: str = "application/vnd.github+json", limit: int = 2_000_000) -> bytes:
    s = get_settings()
    headers = {"Accept": accept, "User-Agent": "OpenQZ"}
    if s.github_token:
        headers["Authorization"] = f"Bearer {s.github_token}"
    req = urllib.request.Request(url, headers=headers)  # noqa: S310 - fixed https hosts below
    with urllib.request.urlopen(req, timeout=15) as resp:  # noqa: S310
        return bytes(resp.read(limit + 1)[:limit])


def fetch_contributors(repo: str) -> list[dict[str, Any]]:
    """Blocking: run in a thread. Raises on any network or GitHub problem."""
    rows = json.loads(_get(f"https://api.github.com/repos/{repo}/contributors?per_page=100"))
    people = []
    for row in [r for r in rows if isinstance(r, dict) and is_person(r)][:MAX_PEOPLE]:
        login = str(row["login"])
        name = login
        try:
            profile = json.loads(_get(f"https://api.github.com/users/{login}"))
            name = str(profile.get("name") or "").strip() or login
        except (urllib.error.URLError, ValueError, OSError):
            pass  # the login is a fine name
        if any(w in name.lower() for w in EXCLUDED_WORDS):
            continue
        avatar = None
        url = str(row.get("avatar_url") or "")
        if url.startswith("https://avatars.githubusercontent.com/"):
            try:
                sep = "&" if "?" in url else "?"
                data = _get(f"{url}{sep}s={AVATAR_PX}", accept="image/*", limit=MAX_AVATAR_BYTES)
                kind = "png" if data[:4] == b"\x89PNG" else "jpeg"
                avatar = f"data:image/{kind};base64,{base64.b64encode(data).decode()}"
            except (urllib.error.URLError, OSError):
                avatar = None
        people.append(
            {
                "login": login,
                "name": name[:80],
                "avatar": avatar,
                "url": f"https://github.com/{login}",
                "contributions": int(row.get("contributions") or 0),
            }
        )
    return people


async def stored(session: AsyncSession) -> tuple[list[dict[str, Any]], datetime | None]:
    row = await session.get(SiteCache, KEY)
    if row is None:
        return [], None
    return list(row.value.get("people", [])), row.updated_at


async def refresh(session: AsyncSession, *, force: bool = False) -> int:
    """Fetch and store the list. A failed fetch keeps the list we already have.

    Returns the number of people stored, or -1 when nothing was fetched."""
    repo = get_settings().github_repo
    row = await session.get(SiteCache, KEY)
    fresh = row is not None and datetime.now(UTC) - row.updated_at < STALE_AFTER
    if not repo or (fresh and not force):
        return -1
    try:
        people = await anyio.to_thread.run_sync(fetch_contributors, repo)
    except (urllib.error.URLError, ValueError, OSError):
        return -1
    if row is None:
        session.add(SiteCache(key=KEY, value={"people": people}, updated_at=datetime.now(UTC)))
    else:
        row.value = {"people": people}
        row.updated_at = datetime.now(UTC)
    await session.commit()
    return len(people)
