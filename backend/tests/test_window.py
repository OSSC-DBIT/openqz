"""The open / closed window of an assignment (pure function, no database)."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

from app.services.attempt_service import OPEN_EARLY, window

T = datetime(2026, 11, 9, 10, 0, tzinfo=UTC)


def asg(start: datetime, due: datetime | None = None, late: bool = False) -> Any:
    return SimpleNamespace(start_at=start, due_at=due, allow_late=late)


def test_open_a_moment_before_start_to_absorb_clock_steps() -> None:
    # assigned "now" on a server whose clock then stepped back a second: still open
    assert window(asg(T + timedelta(seconds=1)), at=T).open
    assert window(asg(T + OPEN_EARLY), at=T).open
    # a real future start stays closed
    w = window(asg(T + OPEN_EARLY + timedelta(seconds=1)), at=T)
    assert not w.open and w.reason == "not_started"
    assert not window(asg(T + timedelta(hours=1)), at=T).open


def test_due_and_late() -> None:
    assert window(asg(T - timedelta(hours=1), due=T + timedelta(minutes=1)), at=T).open
    closed = window(asg(T - timedelta(hours=1), due=T - timedelta(minutes=1)), at=T)
    assert not closed.open and closed.reason == "closed"
    late = window(asg(T - timedelta(hours=1), due=T - timedelta(minutes=1), late=True), at=T)
    assert late.open and late.late
