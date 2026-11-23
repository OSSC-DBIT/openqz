"""Helpers shared by every file download: spreadsheet-safe cells and header-safe file names."""

import re
from typing import Any
from urllib.parse import quote

# A cell starting with one of these is read as a formula by Excel, LibreOffice and Sheets.
_FORMULA_START = ("=", "+", "-", "@", "\t", "\r")


def safe_cell(v: Any) -> Any:
    """Names, titles and answers come from people: never let a spreadsheet read one as a
    formula. Numbers are left alone, so marks stay numeric."""
    if isinstance(v, str) and v[:1] in _FORMULA_START:
        return "'" + v
    return v


def safe_row(row: list[Any]) -> list[Any]:
    return [safe_cell(v) for v in row]


def attachment(title: str, suffix: str, prefix: str = "openqz-") -> dict[str, str]:
    """Content-Disposition for a download named after an activity.

    HTTP headers are latin-1, so a Kannada or Hindi title cannot go into `filename=` as it is:
    that copy keeps ASCII letters and digits only, and `filename*` (RFC 5987) carries the full
    name for browsers that read it."""
    full = re.sub(r"[^\w]+", "-", title, flags=re.UNICODE).strip("-")[:50] or "activity"
    ascii_name = re.sub(r"[^A-Za-z0-9]+", "-", title).strip("-")[:50] or "activity"
    return {
        "Content-Disposition": (
            f'attachment; filename="{prefix}{ascii_name}{suffix}"; '
            f"filename*=UTF-8''{quote(prefix + full + suffix)}"
        )
    }
