"""Attempt lifecycle: start/resume, server-side timers, autosave, instant feedback,
integrity violations, submit/auto-submit, scoring and release rules."""

import random
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer, raiseload

from app.models import (
    Activity,
    ActivityAssignment,
    ActivityKind,
    ActivityStatus,
    AssignmentTarget,
    Attempt,
    AttemptAnswer,
    AttemptStatus,
    IntegrityEvent,
    ReleaseMode,
    ShowAnswers,
    StudentSection,
    SubmitReason,
    User,
)
from app.services.grading import MANUAL_TYPES, grade, key_for_review, strip_key

# Network latency allowance on server-side timers.
GRACE = timedelta(seconds=5)


class AttemptError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 409) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def now() -> datetime:
    return datetime.now(UTC)


def is_graded(kind: ActivityKind) -> bool:
    return kind in (ActivityKind.quiz, ActivityKind.assignment)


# ---------------------------------------------------------------- targeting


async def student_section_ids(session: AsyncSession, student_id: uuid.UUID) -> list[int]:
    return list(
        (
            await session.scalars(
                select(StudentSection.section_id).where(StudentSection.student_id == student_id)
            )
        ).all()
    )


async def assignments_for_student(session: AsyncSession, student: User) -> list[ActivityAssignment]:
    secs = await student_section_ids(session, student.id)
    conds = [AssignmentTarget.student_id == student.id]
    if secs:
        conds.append(AssignmentTarget.section_id.in_(secs))
    ids = select(AssignmentTarget.assignment_id).where(or_(*conds))
    rows = await session.scalars(
        select(ActivityAssignment)
        .join(Activity, Activity.id == ActivityAssignment.activity_id)
        .where(ActivityAssignment.id.in_(ids), Activity.status != ActivityStatus.archived)
        .order_by(
            ActivityAssignment.due_at.asc().nulls_last(), ActivityAssignment.created_at.desc()
        )
    )
    return list(rows.unique())


async def is_target(session: AsyncSession, a: ActivityAssignment, student: User) -> bool:
    secs = set(await student_section_ids(session, student.id))
    return any(
        t.student_id == student.id or (t.section_id is not None and t.section_id in secs)
        for t in a.targets
    )


async def target_student_ids(session: AsyncSession, a: ActivityAssignment) -> set[uuid.UUID]:
    direct = {t.student_id for t in a.targets if t.student_id}
    sec_ids = [t.section_id for t in a.targets if t.section_id]
    if sec_ids:
        direct |= set(
            (
                await session.scalars(
                    select(StudentSection.student_id).where(StudentSection.section_id.in_(sec_ids))
                )
            ).all()
        )
    return direct


# ---------------------------------------------------------------- snapshot


def build_snapshot(activity: Activity, a: ActivityAssignment, seed: int) -> list[dict[str, Any]]:
    rng = random.Random(seed)  # noqa: S311 - shuffling, not security
    qs = []
    for q in activity.questions:
        options = [dict(o) for o in (q.options or [])]
        if a.shuffle_options and q.type.value not in ("true_false",):
            rng.shuffle(options)
        qs.append(
            {
                "id": str(q.id),
                "type": q.type.value,
                "stem": q.stem,
                "stem_image_id": str(q.stem_image_id) if q.stem_image_id else None,
                "options": [
                    {**o, "image_id": str(o["image_id"]) if o.get("image_id") else None}
                    for o in options
                ],
                "answer": q.answer or {},
                "marks": str(q.marks if is_graded(activity.kind) else 0),
                "partial_credit": q.partial_credit,
                "explanation": q.explanation,
                "time_limit_seconds": q.time_limit_seconds,
                "rubric": list(q.rubric or []),
            }
        )
    if a.shuffle_questions:
        rng.shuffle(qs)
    return qs


# ---------------------------------------------------------------- start / resume


@dataclass
class Window:
    open: bool
    reason: str | None
    late: bool


def window(a: ActivityAssignment, at: datetime | None = None) -> Window:
    t = at or now()
    if a.start_at > t:
        return Window(False, "not_started", False)
    if a.due_at and t > a.due_at:
        return Window(a.allow_late, None if a.allow_late else "closed", True)
    return Window(True, None, False)


async def attempts_of(
    session: AsyncSession, assignment_id: uuid.UUID, student_id: uuid.UUID
) -> list[Attempt]:
    """Summary rows only: answers and the question snapshot are NOT loaded (hot path for the
    student home page). Use full_attempt() before touching answers/snapshot."""
    rows = await session.scalars(
        select(Attempt)
        .where(Attempt.assignment_id == assignment_id, Attempt.student_id == student_id)
        .options(raiseload(Attempt.answers), defer(Attempt.snapshot, raiseload=True))
        .order_by(Attempt.attempt_no)
    )
    return list(rows.unique())


async def full_attempt(session: AsyncSession, attempt_id: uuid.UUID) -> Attempt:
    att = await session.get(Attempt, attempt_id, populate_existing=True)
    assert att is not None
    return att


async def refresh_expired(session: AsyncSession, att: Attempt) -> Attempt:
    """Auto-submit a summary row if its deadline passed; returns the (possibly full) row."""
    if (
        att.status == AttemptStatus.in_progress
        and att.deadline_at is not None
        and now() > att.deadline_at + GRACE
    ):
        att = await full_attempt(session, att.id)
        await expire_if_needed(session, att)
    return att


async def start_or_resume(session: AsyncSession, a: ActivityAssignment, student: User) -> Attempt:
    if not await is_target(session, a, student):
        raise AttemptError("not_assigned", "This activity is not assigned to you", 403)
    activity = await session.get(Activity, a.activity_id)
    assert activity is not None
    if activity.status != ActivityStatus.published:
        raise AttemptError("unavailable", "This activity is not available right now", 403)

    previous = await attempts_of(session, a.id, student.id)
    for i, att in enumerate(previous):
        if att.status == AttemptStatus.in_progress:
            att = previous[i] = await refresh_expired(session, att)
            if att.status == AttemptStatus.in_progress:
                return await full_attempt(session, att.id)

    w = window(a)
    if not w.open:
        msg = (
            "This activity has not started yet"
            if w.reason == "not_started"
            else "The deadline has passed"
        )
        raise AttemptError(w.reason or "closed", msg, 403)
    # One attempt per student. (max_attempts stays in the table for the load-test seed only.)
    if a.max_attempts and len(previous) >= a.max_attempts:
        raise AttemptError("already_taken", "You have already taken this activity", 403)
    if not activity.questions:
        raise AttemptError("empty", "This activity has no questions yet", 409)

    t = now()
    limit = a.time_limit_seconds or activity.time_limit_seconds
    deadline = t + timedelta(seconds=limit) if limit else None
    if a.due_at and not a.allow_late and (deadline is None or a.due_at < deadline):
        deadline = a.due_at
    snapshot = build_snapshot(activity, a, seed=random.SystemRandom().randrange(2**31))
    graded = is_graded(activity.kind)
    att = Attempt(
        assignment_id=a.id,
        student_id=student.id,
        attempt_no=len(previous) + 1,
        started_at=t,
        deadline_at=deadline,
        snapshot=snapshot,
        linear=any(q.get("time_limit_seconds") for q in snapshot),
        late=w.late,
        max_score=sum((Decimal(q["marks"]) for q in snapshot), Decimal("0"))
        if graded
        else Decimal("0"),
    )
    session.add(att)
    await session.commit()
    await session.refresh(att)
    return att


# ---------------------------------------------------------------- timers


async def expire_if_needed(session: AsyncSession, att: Attempt) -> bool:
    """Auto-submit when the server deadline has passed. Returns True if it did."""
    if att.status != AttemptStatus.in_progress or att.deadline_at is None:
        return False
    if now() <= att.deadline_at + GRACE:
        return False
    a = att.assignment
    reason = (
        SubmitReason.deadline
        if a.due_at is not None and att.deadline_at >= a.due_at
        else SubmitReason.timer
    )
    await finalize(session, att, reason)
    return True


def _answer(att: Attempt, qid: str) -> AttemptAnswer | None:
    for ans in att.answers:
        if str(ans.question_id) == qid:
            return ans
    return None


def _ensure_answer(att: Attempt, qid: str) -> AttemptAnswer:
    ans = _answer(att, qid)
    if ans is None:
        ans = AttemptAnswer(attempt_id=att.id, question_id=uuid.UUID(qid))
        att.answers.append(ans)
    return ans


def question_deadline(q: dict[str, Any], ans: AttemptAnswer | None) -> datetime | None:
    if not q.get("time_limit_seconds") or ans is None or ans.question_started_at is None:
        return None
    return ans.question_started_at + timedelta(seconds=int(q["time_limit_seconds"]))


def _lock_if_question_expired(q: dict[str, Any], ans: AttemptAnswer) -> None:
    qd = question_deadline(q, ans)
    if qd and now() > qd + GRACE:
        ans.locked = True


# ---------------------------------------------------------------- navigation and answers


def _require_open(att: Attempt) -> None:
    if att.status != AttemptStatus.in_progress:
        raise AttemptError("submitted", "This attempt has already been submitted", 409)


async def open_question(session: AsyncSession, att: Attempt, index: int) -> dict[str, Any]:
    await expire_if_needed(session, att)
    _require_open(att)
    if not 0 <= index < len(att.snapshot):
        raise AttemptError("bad_index", "No such question", 404)
    if att.linear:
        if index < att.current_index:
            raise AttemptError("no_going_back", "Timed questions cannot be revisited", 409)
        if index > att.current_index + 1:
            raise AttemptError("skip", "Answer the questions in order", 409)
        if index == att.current_index + 1:
            prev = _ensure_answer(att, att.snapshot[att.current_index]["id"])
            prev.locked = True
    att.current_index = index
    q = att.snapshot[index]
    ans = _ensure_answer(att, q["id"])
    if ans.question_started_at is None:
        ans.question_started_at = now()
    _lock_if_question_expired(q, ans)
    await session.commit()
    return await student_question(session, att, index)


async def student_question(session: AsyncSession, att: Attempt, index: int) -> dict[str, Any]:
    q = att.snapshot[index]
    ans = _answer(att, q["id"])
    a = att.assignment
    activity = a.activity
    out: dict[str, Any] = {
        "index": index,
        "total": len(att.snapshot),
        "question": strip_key(q),
        "response": ans.response if ans else None,
        "locked": bool(ans and ans.locked),
        "question_deadline": question_deadline(q, ans),
        "server_now": now(),
        "feedback": None,
    }
    if activity.kind == ActivityKind.flashcards:
        out["question"]["back"] = q.get("explanation")
    if ans and ans.locked and a.instant_feedback and _instant_ok(q, activity.kind):
        out["feedback"] = _feedback(q, ans)
    return out


def _instant_ok(q: dict[str, Any], kind: ActivityKind) -> bool:
    return is_graded(kind) and q["type"] not in MANUAL_TYPES


def _feedback(q: dict[str, Any], ans: AttemptAnswer) -> dict[str, Any]:
    r = grade(q, ans.response)
    return {
        "correct": r.correct,
        "score": r.score,
        "marks": Decimal(q["marks"]),
        "key": key_for_review(q),
        "explanation": q.get("explanation"),
    }


def validate_response(q: dict[str, Any], response: dict[str, Any]) -> dict[str, Any]:
    t = q["type"]
    ids = {o["id"] for o in q.get("options", [])}
    if t in ("mcq", "true_false"):
        c = response.get("choice")
        if c not in ids:
            raise AttemptError("bad_answer", "Pick one of the options", 422)
        return {"choice": c}
    if t == "justify":
        c = response.get("choice")
        if c is not None and c not in ids:
            raise AttemptError("bad_answer", "Pick one of the options", 422)
        return {"choice": c, "text": str(response.get("text", ""))[:10000]}
    if t == "multi_select":
        cs = response.get("choices") or []
        if not isinstance(cs, list) or not set(cs) <= ids:
            raise AttemptError("bad_answer", "Invalid choices", 422)
        return {"choices": sorted(set(cs))}
    if t == "fill_blank":
        bs = response.get("blanks") or []
        n = len(q.get("answer", {}).get("blanks", []))
        if not isinstance(bs, list):
            raise AttemptError("bad_answer", "Invalid blanks", 422)
        return {"blanks": [str(b)[:500] for b in bs[:n]]}
    return {"text": str(response.get("text", ""))[:20000]}


async def save_answer(
    session: AsyncSession, att: Attempt, question_id: str, response: dict[str, Any], final: bool
) -> dict[str, Any]:
    """Autosave (final=False) or confirm (final=True) an answer."""
    await expire_if_needed(session, att)
    _require_open(att)
    idx = next((i for i, q in enumerate(att.snapshot) if q["id"] == question_id), None)
    if idx is None:
        raise AttemptError("bad_question", "No such question in this attempt", 404)
    if att.linear and idx != att.current_index:
        raise AttemptError("not_current", "This question is closed", 409)
    q = att.snapshot[idx]
    ans = _ensure_answer(att, question_id)
    if ans.question_started_at is None:
        ans.question_started_at = now()
    _lock_if_question_expired(q, ans)
    if ans.locked:
        await session.commit()
        raise AttemptError("locked", "Time is up for this question", 409)

    ans.response = validate_response(q, response)
    ans.answered_at = now()
    activity = att.assignment.activity
    feedback = None
    if final and att.assignment.instant_feedback and _instant_ok(q, activity.kind):
        ans.locked = True
        feedback = _feedback(q, ans)
    await session.commit()
    return {"saved": True, "locked": ans.locked, "feedback": feedback}


# ---------------------------------------------------------------- integrity


async def record_violation(
    session: AsyncSession, att: Attempt, kind: str, meta: dict[str, Any] | None, session_id: str
) -> dict[str, Any]:
    session.add(
        IntegrityEvent(
            user_id=att.student_id,
            attempt_id=att.id,
            session_id=session_id[:64],
            kind=kind[:48],
            client_at=now(),
            meta=meta,
        )
    )
    if att.status != AttemptStatus.in_progress:
        await session.commit()
        return {
            "violations": att.violations,
            "max": att.assignment.max_violations,
            "submitted": True,
        }
    att.violations += 1
    limit = att.assignment.max_violations
    if limit and att.violations >= limit:
        await finalize(session, att, SubmitReason.violations)
    else:
        await session.commit()
    return {
        "violations": att.violations,
        "max": limit,
        "submitted": att.status == AttemptStatus.submitted,
    }


# ---------------------------------------------------------------- submit and scoring


def recompute(att: Attempt) -> None:
    graded = is_graded(att.assignment.activity.kind)
    total = Decimal("0")
    pending = False
    for q in att.snapshot:
        ans = _answer(att, q["id"])
        if not graded:
            continue
        if ans is None:
            continue  # unanswered = 0
        final = ans.manual_score if ans.manual_score is not None else ans.auto_score
        if final is None:
            pending = True
        else:
            total += final
    att.score = total if graded else None
    att.needs_manual = pending


async def finalize(session: AsyncSession, att: Attempt, reason: SubmitReason) -> Attempt:
    if att.status == AttemptStatus.submitted:
        return att
    graded = is_graded(att.assignment.activity.kind)
    for q in att.snapshot:
        ans = _ensure_answer(att, q["id"])
        r = grade(q, ans.response, graded=graded)
        ans.auto_score = r.score
        if not ans.locked:
            ans.submit_locked = True
        ans.locked = True
    att.status = AttemptStatus.submitted
    att.submitted_at = now()
    att.submit_reason = reason
    recompute(att)
    await session.commit()
    return att


def can_unblock(att: Attempt) -> bool:
    return att.status == AttemptStatus.submitted and att.submit_reason == SubmitReason.violations


async def unblock(session: AsyncSession, att: Attempt, extra_minutes: int = 0) -> Attempt:
    """Reopen an attempt that was auto-submitted for too many integrity warnings.

    Warnings start again from zero, the time spent blocked is given back (plus any
    extra minutes), and only the answers that were closed by the submit open again:
    answers locked by a question timer or by instant feedback stay locked.
    """
    if not can_unblock(att):
        raise AttemptError(
            "not_blocked", "Only attempts submitted for too many warnings can be unblocked", 409
        )
    newer = await session.scalar(
        select(Attempt.id).where(
            Attempt.assignment_id == att.assignment_id,
            Attempt.student_id == att.student_id,
            Attempt.id != att.id,
            or_(Attempt.status == AttemptStatus.in_progress, Attempt.attempt_no > att.attempt_no),
        )
    )
    if newer is not None:
        raise AttemptError("newer_attempt", "The student has already started another attempt", 409)
    t = now()
    gap = t - (att.submitted_at or t) + timedelta(minutes=extra_minutes)
    if att.deadline_at is not None:
        # The block happened before the deadline, so shifting it keeps the time left.
        att.deadline_at += gap
    for ans in att.answers:
        if not ans.submit_locked:
            continue
        ans.locked = False
        ans.submit_locked = False
        ans.auto_score = None
        ans.manual_score = None
        ans.rubric_scores = None
        ans.feedback = None
        ans.graded_by = None
        ans.graded_at = None
        if ans.question_started_at is not None:
            ans.question_started_at += gap
    att.status = AttemptStatus.in_progress
    att.submitted_at = None
    att.submit_reason = None
    att.score = None
    att.needs_manual = False
    att.violations = 0
    att.unblocked_count += 1
    return att


def scores_visible(att: Attempt) -> bool:
    a = att.assignment
    if att.status != AttemptStatus.submitted or not is_graded(a.activity.kind):
        return False
    if a.release_mode == ReleaseMode.immediate:
        return True
    if a.release_mode == ReleaseMode.after_due:
        return a.released_at is not None or (a.due_at is not None and now() > a.due_at)
    return a.released_at is not None


def answers_visible(att: Attempt) -> bool:
    a = att.assignment
    if att.status != AttemptStatus.submitted:
        return False
    if a.show_answers == ShowAnswers.after_submit:
        return True
    if a.show_answers == ShowAnswers.after_due:
        return a.due_at is None or now() > a.due_at
    return False


def review(att: Attempt) -> dict[str, Any]:
    show_scores = scores_visible(att)
    show_key = answers_visible(att)
    kind = att.assignment.activity.kind
    items = []
    for i, q in enumerate(att.snapshot):
        ans = _answer(att, q["id"])
        item: dict[str, Any] = {
            "index": i,
            "question": strip_key(q),
            "response": ans.response if ans else None,
            "marks": Decimal(q["marks"]),
        }
        if show_scores and ans is not None:
            final = ans.manual_score if ans.manual_score is not None else ans.auto_score
            item["score"] = final
            item["pending"] = final is None
            item["feedback"] = ans.feedback
            if q.get("rubric") and ans.rubric_scores:
                item["rubric"] = [
                    {**r, "score": ans.rubric_scores.get(r["id"])} for r in q["rubric"]
                ]
            r = grade(q, ans.response) if is_graded(kind) else None
            item["correct"] = r.correct if r else None
        if show_key:
            item["key"] = key_for_review(q)
            item["explanation"] = q.get("explanation")
        items.append(item)
    return {
        "attempt_id": att.id,
        "status": att.status,
        "submit_reason": att.submit_reason,
        "submitted_at": att.submitted_at,
        "scores_visible": show_scores,
        "answers_visible": show_key,
        "score": att.score if show_scores else None,
        "max_score": att.max_score,
        "needs_manual": att.needs_manual,
        "violations": att.violations,
        "items": items,
    }


async def sweep_expired(session: AsyncSession) -> int:
    """Auto-submit every in-progress attempt whose server deadline has passed."""
    cutoff = now() - GRACE
    rows = await session.scalars(
        select(Attempt).where(
            Attempt.status == AttemptStatus.in_progress,
            Attempt.deadline_at.is_not(None),
            Attempt.deadline_at < cutoff,
        )
    )
    n = 0
    for att in rows.unique():
        if await expire_if_needed(session, att):
            n += 1
    return n


async def count_submitted(session: AsyncSession, assignment_id: uuid.UUID) -> int:
    return (
        await session.scalar(
            select(func.count(func.distinct(Attempt.student_id))).where(
                Attempt.assignment_id == assignment_id, Attempt.status == AttemptStatus.submitted
            )
        )
    ) or 0
