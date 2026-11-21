"""Public facts about the site, for the landing page. No sign-in needed."""

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Request, Response

from app.core.config import get_settings
from app.core.deps import SessionDep
from app.core.jobs import enqueue
from app.core.redis import get_redis
from app.services import contributors

router = APIRouter(prefix="/site", tags=["site"])

# While a refresh is on its way (or GitHub is down), do not ask for another one.
RETRY_AFTER_SECONDS = 600


@router.get("/contributors")
async def site_contributors(
    request: Request, session: SessionDep, response: Response
) -> dict[str, Any]:
    """The people who built OpenQZ, from the copy kept in the database.

    GitHub is asked twice a day by the worker. If the stored copy is missing or older than
    that (a new server, a restored database, a worker that was down), this request asks the
    worker to fetch it now, at most once every ten minutes; it never waits for GitHub."""
    people, updated_at = await contributors.stored(session)
    stale = updated_at is None or datetime.now(UTC) - updated_at > contributors.STALE_AFTER
    if stale and get_settings().github_repo:
        if await get_redis().set("site:contributors:refresh", "1", nx=True, ex=RETRY_AFTER_SECONDS):
            await enqueue(request, "refresh_contributors")
    # the same for everyone; browsers may keep a filled list for an hour, an empty one not at all
    response.headers["Cache-Control"] = "public, max-age=3600" if people else "no-store"
    return {"people": people, "updated_at": updated_at}
