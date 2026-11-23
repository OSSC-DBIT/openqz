"""Uploaded images, made small before they are stored.

A phone photo is often 3 to 5 MB; every student in a quiz downloads it, all at once, from a
server that keeps media on a hard disk. So each upload is re-encoded as WebP, at most
MAX_SIDE pixels on its long side, turned the right way up, and stripped of hidden photo data
(EXIF: camera, time, GPS position). Screenshots and diagrams use lossless WebP when that is not
much bigger, so text stays sharp. Animated GIF or WebP files are kept as they are, and a file is
never made bigger than the original when it needed no resizing.
"""

import io
from dataclasses import dataclass

from PIL import Image, ImageOps

MAX_SIDE = 1600
PHOTO_QUALITY = 80
GRAPHIC_QUALITY = 85
# A small file that unpacks to a gigantic picture (a "decompression bomb") is refused.
MAX_PIXELS = 40_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


class BadImage(ValueError):
    """The bytes are not an image we can read safely."""


@dataclass(frozen=True)
class Prepared:
    data: bytes
    content_type: str
    ext: str


def _webp(im: Image.Image, *, lossless: bool, quality: int) -> bytes:
    out = io.BytesIO()
    icc = im.info.get("icc_profile")
    # no exif= argument: the photo's hidden data is not written
    im.save(
        out,
        "WEBP",
        lossless=lossless,
        quality=quality,
        method=4,
        **({"icc_profile": icc} if icc else {}),
    )
    return out.getvalue()


def prepare(data: bytes, content_type: str, ext: str) -> Prepared:
    """Shrink one upload. `content_type` and `ext` come from the file's own first bytes."""
    original = Prepared(data, content_type, ext)
    im: Image.Image
    try:
        opened = Image.open(io.BytesIO(data))
        # The size comes from the header: refuse a giant picture before decoding a single pixel
        # (Pillow itself only warns below twice its limit).
        if opened.width * opened.height > MAX_PIXELS:
            raise BadImage("This image is too large to process")
        opened.load()
        im = opened
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as e:
        raise BadImage("This image is too large to process") from e
    except (OSError, SyntaxError, ValueError) as e:
        raise BadImage("This image could not be read") from e

    if getattr(im, "is_animated", False) and getattr(im, "n_frames", 1) > 1:
        return original  # keep animations moving

    im = ImageOps.exif_transpose(im) or im
    has_alpha = im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info)
    im = im.convert("RGBA" if has_alpha else "RGB")
    resized = max(im.size) > MAX_SIDE
    if resized:
        im.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)

    if content_type == "image/jpeg":
        small = _webp(im, lossless=False, quality=PHOTO_QUALITY)
    else:
        # screenshots, diagrams, drawings: lossless keeps text sharp, unless it costs much more
        lossy = _webp(im, lossless=False, quality=GRAPHIC_QUALITY)
        lossless = _webp(im, lossless=True, quality=100)
        small = lossless if len(lossless) <= len(lossy) * 1.5 else lossy

    if not resized and len(small) >= len(data) and content_type != "image/jpeg":
        return original  # already small; a JPEG is always re-encoded so its EXIF goes
    return Prepared(small, "image/webp", ".webp")
