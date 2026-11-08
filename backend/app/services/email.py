"""Outgoing email (optional). Disabled unless SMTP_HOST is set.

Messages are sent from the ARQ worker, never inside a web request, so a slow mail server
cannot slow the site down. In development, Mailpit (http://localhost:8025) catches them.
"""

import html
import logging
from dataclasses import dataclass
from email.message import EmailMessage

import aiosmtplib

from app.core.config import get_settings

log = logging.getLogger(__name__)


@dataclass
class Mail:
    to: str
    subject: str
    text: str
    html: str


# Tests replace this to capture messages instead of sending them.
outbox: list[Mail] | None = None


async def send(mail: Mail) -> bool:
    s = get_settings()
    if outbox is not None:
        outbox.append(mail)
        return True
    if not s.email_enabled:
        log.info("email disabled; would send %r to %s", mail.subject, mail.to)
        return False
    msg = EmailMessage()
    msg["From"] = s.smtp_from
    msg["To"] = mail.to
    msg["Subject"] = mail.subject
    msg.set_content(mail.text)
    msg.add_alternative(mail.html, subtype="html")
    try:
        await aiosmtplib.send(
            msg,
            hostname=s.smtp_host,
            port=s.smtp_port,
            username=s.smtp_user or None,
            password=s.smtp_password or None,
            start_tls=s.smtp_starttls and not s.smtp_ssl,
            use_tls=s.smtp_ssl,
            timeout=20,
        )
        return True
    except (aiosmtplib.SMTPException, OSError) as exc:
        log.warning("email to %s failed: %s", mail.to, exc)
        return False


def _layout(title: str, body_html: str, button: tuple[str, str] | None = None) -> str:
    btn = ""
    if button:
        label, url = button
        btn = (
            f'<p style="margin:24px 0"><a href="{html.escape(url)}" '
            'style="background:#5b3fd6;color:#fff;padding:12px 20px;border-radius:10px;'
            f'text-decoration:none;font-weight:600">{html.escape(label)}</a></p>'
        )
    return (
        '<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:520px;'
        'margin:auto;color:#1d1b2c">'
        f'<h2 style="color:#5b3fd6">OpenQZ</h2><h3>{html.escape(title)}</h3>{body_html}{btn}'
        '<p style="color:#6b6880;font-size:12px">You received this because you have an '
        "OpenQZ account at your college.</p></div>"
    )


def password_reset(to: str, name: str, link: str, minutes: int) -> Mail:
    text = (
        f"Hi {name},\n\nSomeone (hopefully you) asked to reset your OpenQZ password.\n"
        f"Open this link within {minutes} minutes to choose a new password:\n\n{link}\n\n"
        "If you did not ask for this, ignore this email; your password stays the same.\n"
    )
    body = (
        f"<p>Hi {html.escape(name)},</p><p>Someone (hopefully you) asked to reset your OpenQZ "
        f"password. The link works for {minutes} minutes and only once.</p>"
        "<p>If you did not ask for this, ignore this email.</p>"
    )
    return Mail(
        to,
        "Reset your OpenQZ password",
        text,
        _layout("Reset your password", body, ("Choose a new password", link)),
    )


def assigned(to: str, name: str, title: str, teacher: str, due: str | None, link: str) -> Mail:
    due_txt = f"Due: {due}" if due else "No deadline"
    text = f'Hi {name},\n\n{teacher} assigned you "{title}".\n{due_txt}\n\nOpen OpenQZ: {link}\n'
    body = (
        f"<p>Hi {html.escape(name)},</p><p><b>{html.escape(teacher)}</b> assigned you "
        f"<b>{html.escape(title)}</b>.</p><p>{html.escape(due_txt)}</p>"
    )
    return Mail(
        to, f"New on OpenQZ: {title}", text, _layout("New activity", body, ("Open OpenQZ", link))
    )


def scores_released(to: str, name: str, title: str, link: str) -> Mail:
    text = f'Hi {name},\n\nYour marks for "{title}" are now available.\n\n{link}\n'
    body = f"<p>Hi {html.escape(name)},</p><p>Your marks for <b>{html.escape(title)}</b> are now available.</p>"
    return Mail(
        to,
        f"Marks released: {title}",
        text,
        _layout("Marks released", body, ("See your result", link)),
    )
