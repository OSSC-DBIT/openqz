"""Image upload for questions and options, and authenticated image serving."""

import hashlib
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.deps import CreatorUser, CurrentUser, SessionDep
from app.models import Media

router = APIRouter(prefix="/media", tags=["media"])

MAX_IMAGE_BYTES = 5 * 1024 * 1024
# Detect type from the file's first bytes, never from the client's claim.
SIGNATURES = [
    (b"\x89PNG\r\n\x1a\n", "image/png", ".png"),
    (b"\xff\xd8\xff", "image/jpeg", ".jpg"),
    (b"GIF87a", "image/gif", ".gif"),
    (b"GIF89a", "image/gif", ".gif"),
]


def sniff(data: bytes) -> tuple[str, str] | None:
    for sig, ctype, ext in SIGNATURES:
        if data.startswith(sig):
            return ctype, ext
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", ".webp"
    return None


class MediaOut(BaseModel):
    id: uuid.UUID
    url: str
    content_type: str
    size: int


@router.post("", response_model=MediaOut, status_code=201)
async def upload(
    session: SessionDep, user: CreatorUser, file: Annotated[UploadFile, File()]
) -> MediaOut:
    data = await file.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Images must be 5 MB or smaller"
        )
    kind = sniff(data)
    if kind is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Upload a PNG, JPEG, GIF or WebP image")
    ctype, ext = kind
    mid = uuid.uuid4()
    folder = get_settings().media_dir / "images" / mid.hex[:2]
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{mid.hex}{ext}"
    path.write_bytes(data)
    m = Media(
        id=mid,
        owner_id=user.id,
        path=str(path),
        content_type=ctype,
        size=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
    )
    session.add(m)
    await session.commit()
    return MediaOut(id=mid, url=f"/api/v1/media/{mid}", content_type=ctype, size=len(data))


@router.get("/{media_id}")
async def get_media(media_id: uuid.UUID, session: SessionDep, _: CurrentUser) -> FileResponse:
    m = await session.get(Media, media_id)
    if m is None or not Path(m.path).exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")
    return FileResponse(
        m.path,
        media_type=m.content_type,
        headers={"Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff"},
    )
