"""Uploaded images are shrunk, cleaned and served cheaply (services/images.py, api/v1/media.py)."""

import io
from pathlib import Path

import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select

from app.cli import optimize_media
from app.core.config import get_settings
from app.core.db import SessionLocal
from app.models import Media
from app.services.images import MAX_SIDE, BadImage, prepare
from tests.test_activities import A, setup_class


def png_bytes(w: int, h: int, color: tuple[int, int, int] = (200, 30, 120)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (w, h), color).save(out, "PNG")
    return out.getvalue()


def photo_bytes(w: int = 4000, h: int = 3000, *, gps: bool = True, rotated: bool = False) -> bytes:
    """A camera-like JPEG: noisy, with EXIF (camera model, GPS) and maybe an orientation flag."""
    im = Image.effect_noise((w, h), 60).convert("RGB")
    exif = Image.Exif()
    exif[0x0110] = "Phone camera"  # model
    if gps:
        exif[0x8825] = {1: "N", 2: (12.0, 58.0, 0.0)}  # GPS position
    if rotated:
        exif[0x0112] = 6  # "turn 90 degrees to show"
    out = io.BytesIO()
    im.save(out, "JPEG", quality=95, exif=exif)
    return out.getvalue()


def test_a_phone_photo_becomes_a_small_clean_webp() -> None:
    raw = photo_bytes()
    small = prepare(raw, "image/jpeg", ".jpg")
    assert small.content_type == "image/webp" and small.ext == ".webp"
    assert len(small.data) < len(raw) / 3
    im = Image.open(io.BytesIO(small.data))
    assert max(im.size) == MAX_SIDE and im.size == (1600, 1200)
    assert not im.getexif()  # no camera, no GPS


def test_a_sideways_photo_is_turned_upright() -> None:
    small = prepare(photo_bytes(800, 600, gps=False, rotated=True), "image/jpeg", ".jpg")
    assert Image.open(io.BytesIO(small.data)).size == (600, 800)


def test_small_graphics_and_animations_are_kept() -> None:
    tiny = png_bytes(4, 4)
    kept = prepare(tiny, "image/png", ".png")
    assert kept.data == tiny or len(kept.data) < len(tiny)

    frames = [Image.new("RGB", (40, 40), c) for c in ((255, 0, 0), (0, 0, 255))]
    out = io.BytesIO()
    frames[0].save(out, "GIF", save_all=True, append_images=frames[1:], duration=200, loop=0)
    gif = out.getvalue()
    assert prepare(gif, "image/gif", ".gif").data == gif

    # a big screenshot is resized but stays a sharp (lossless) webp
    shot = prepare(png_bytes(3200, 1800), "image/png", ".png")
    assert shot.content_type == "image/webp"
    assert Image.open(io.BytesIO(shot.data)).size == (1600, 900)


def test_giant_or_broken_images_are_refused() -> None:
    out = io.BytesIO()
    Image.new("1", (8000, 6000)).save(out, "PNG")  # 48 million pixels, a few KB on disk
    with pytest.raises(BadImage):
        prepare(out.getvalue(), "image/png", ".png")
    with pytest.raises(BadImage):
        prepare(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64, "image/png", ".png")


async def test_upload_stores_the_small_version_and_serving_can_go_through_nginx(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = await setup_class(client)
    raw = photo_bytes(2400, 1800)
    r = await client.post(
        f"{A}/media", headers=c["fac"], files={"file": ("cam.jpg", raw, "image/jpeg")}
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["content_type"] == "image/webp" and body["size"] < len(raw) / 3
    async with SessionLocal() as s:
        m = await s.get(Media, body["id"])
        assert (
            m is not None
            and m.path.endswith(".webp")
            and Path(m.path).stat().st_size == body["size"]
        )

    got = await client.get(f"{A}/media/{body['id']}", headers=c["s1"])
    assert got.status_code == 200 and got.headers["content-type"] == "image/webp"
    assert "immutable" in got.headers["cache-control"] and len(got.content) == body["size"]

    # with MEDIA_ACCEL the API only checks the request; nginx sends the file
    monkeypatch.setattr(get_settings(), "media_accel", True)
    acc = await client.get(f"{A}/media/{body['id']}", headers=c["s1"])
    assert acc.status_code == 200 and acc.content == b""
    assert acc.headers["x-accel-redirect"].startswith("/_media/images/")
    assert acc.headers["x-accel-redirect"].endswith(".webp")
    assert (await client.get(f"{A}/media/{body['id']}")).status_code == 401

    broken = await client.post(
        f"{A}/media",
        headers=c["fac"],
        files={"file": ("x.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)},
    )
    assert broken.status_code == 400


async def test_optimize_media_shrinks_images_stored_before() -> None:
    folder = get_settings().media_dir / "images" / "zz"
    folder.mkdir(parents=True, exist_ok=True)
    old = folder / "legacy-photo.jpg"
    raw = photo_bytes(3000, 2000)
    old.write_bytes(raw)
    async with SessionLocal() as s:
        m = Media(path=str(old), content_type="image/jpeg", size=len(raw), sha256="x")
        s.add(m)
        await s.commit()
        mid = m.id

    assert await optimize_media(dry_run=True) == 0
    assert old.exists()  # a dry run changes nothing
    assert await optimize_media(dry_run=False) == 0
    async with SessionLocal() as s:
        m2 = (await s.scalars(select(Media).where(Media.id == mid))).one()
        assert m2.content_type == "image/webp" and m2.size < len(raw) / 3
        assert Path(m2.path).exists() and not old.exists()
