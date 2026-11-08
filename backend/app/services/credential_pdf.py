"""Printable credential slips: one slip per new user, grouped by section, cut lines between."""

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


@dataclass
class Credential:
    group: str  # e.g. "CSE Sem 5 A (2026-27)" or "Faculty - CSE"
    username: str
    full_name: str
    password: str
    email: str = ""


COLS, ROWS = 2, 6
MARGIN = 12 * mm


def build_credential_pdf(path: Path, creds: list[Credential], login_url: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(path), pagesize=A4)
    c.setTitle("OpenQZ credentials")
    width, height = A4
    slip_w = (width - 2 * MARGIN) / COLS
    slip_h = (height - 2 * MARGIN - 10 * mm) / ROWS
    stamp = datetime.now(UTC).strftime("%d %b %Y")

    groups: dict[str, list[Credential]] = defaultdict(list)
    for cred in creds:
        groups[cred.group].append(cred)

    first_page = True
    for group in sorted(groups):
        items = sorted(groups[group], key=lambda x: x.username)
        for start in range(0, len(items), COLS * ROWS):
            if not first_page:
                c.showPage()
            first_page = False
            c.setFont("Helvetica-Bold", 11)
            c.drawString(MARGIN, height - MARGIN, f"OpenQZ login slips  |  {group}")
            c.setFont("Helvetica", 8)
            c.drawRightString(
                width - MARGIN, height - MARGIN, f"Generated {stamp}  |  Confidential"
            )
            for i, cred in enumerate(items[start : start + COLS * ROWS]):
                col, row = i % COLS, i // COLS
                x = MARGIN + col * slip_w
                y = height - MARGIN - 10 * mm - (row + 1) * slip_h
                c.setDash(3, 3)
                c.setLineWidth(0.4)
                c.rect(x, y, slip_w, slip_h)
                c.setDash()
                pad = 5 * mm
                top = y + slip_h - pad
                c.setFont("Helvetica-Bold", 10)
                c.drawString(x + pad, top - 3 * mm, cred.full_name[:40])
                c.setFont("Helvetica", 8)
                c.drawRightString(x + slip_w - pad, top - 3 * mm, cred.username)
                c.setFont("Helvetica", 9)
                c.drawString(x + pad, top - 9 * mm, f"Site:  {login_url}")
                c.drawString(x + pad, top - 14 * mm, "Email:")
                c.drawString(x + pad, top - 19 * mm, "Temporary password:")
                # Never truncate the login email: shrink the font until it fits.
                avail = slip_w - 2 * pad - 34 * mm
                size = 10.0
                while size > 5 and stringWidth(cred.email, "Courier-Bold", size) > avail:
                    size -= 0.5
                c.setFont("Courier-Bold", size)
                c.drawString(x + pad + 34 * mm, top - 14 * mm, cred.email)
                c.setFont("Courier-Bold", 11)
                c.drawString(x + pad + 34 * mm, top - 19 * mm, cred.password)
                c.setFont("Helvetica-Oblique", 7)
                c.drawString(
                    x + pad,
                    y + pad + 3 * mm,
                    "Or tap 'Continue with Google' using this email.",
                )
                c.drawString(
                    x + pad,
                    y + pad,
                    "Change the password at first login. Do not share it.",
                )
    if first_page:
        c.setFont("Helvetica", 11)
        c.drawString(MARGIN, height - MARGIN, "No new accounts were created in this import.")
    c.save()
