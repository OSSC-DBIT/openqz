"""Faculty: assignment settings, reports, CSV export, manual grading queue, score release."""

import csv
import io
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import CreatorUser, SessionDep
from app.core.jobs import enqueue
from app.models import (
    ActivityAssignment,
    ActivityKind,
    Attempt,
    AttemptStatus,
    Role,
    User,
)
from app.schemas.activities import AssignmentOut, AssignUpdate
from app.services import attempt_service as svc
from app.services import audit
from app.services.assignment_view import assignment_out
from app.services.grading import MANUAL_TYPES, grade, strip_key

router = APIRouter(prefix="/activity-assignments", tags=["results"])


async def owned(session: AsyncSession, assignment_id: uuid.UUID, user: User) -> ActivityAssignment:
    a = await session.get(ActivityAssignment, assignment_id)
    if a is None or (user.role != Role.admin and a.activity.owner_id != user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assignment not found")
    return a


@router.get("", response_model=list[AssignmentOut])
async def my_assignments(session: SessionDep, user: CreatorUser) -> list[AssignmentOut]:
    """Everything this teacher has assigned, newest first (admins: everything)."""
    from app.models import Activity

    stmt = (
        select(ActivityAssignment)
        .join(Activity, Activity.id == ActivityAssignment.activity_id)
        .order_by(ActivityAssignment.created_at.desc())
        .limit(200)
    )
    if user.role != Role.admin:
        stmt = stmt.where(Activity.owner_id == user.id)
    return [await assignment_out(session, a) for a in (await session.scalars(stmt)).unique()]


@router.get("/{assignment_id}", response_model=AssignmentOut)
async def get_assignment(
    assignment_id: uuid.UUID, session: SessionDep, user: CreatorUser
) -> AssignmentOut:
    return await assignment_out(session, await owned(session, assignment_id, user))


@router.patch("/{assignment_id}", response_model=AssignmentOut)
async def update_assignment(
    assignment_id: uuid.UUID, body: AssignUpdate, session: SessionDep, user: CreatorUser
) -> AssignmentOut:
    a = await owned(session, assignment_id, user)
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(a, k, v)
    if a.due_at and a.due_at <= a.start_at:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Deadline must be after the start time")
    if "instructions" in data:
        a.instructions = (a.instructions or "").strip() or None
    if {"due_at", "allow_late"} & data.keys():
        await svc.apply_new_deadline(session, a)
    await session.commit()
    return await assignment_out(session, a)


@router.delete("/{assignment_id}", status_code=204)
async def delete_assignment(
    assignment_id: uuid.UUID, session: SessionDep, user: CreatorUser
) -> Response:
    a = await owned(session, assignment_id, user)
    started = await session.scalar(select(Attempt.id).where(Attempt.assignment_id == a.id).limit(1))
    if started:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Students have already attempted it; close it by setting a deadline",
        )
    await session.delete(a)
    await session.commit()
    return Response(status_code=204)


@router.post("/{assignment_id}/new-code", response_model=AssignmentOut)
async def regenerate_code(
    assignment_id: uuid.UUID, session: SessionDep, user: CreatorUser
) -> AssignmentOut:
    """New join code for a room (the old one stops working; joined students stay)."""
    from app.api.v1.activities import new_join_code

    a = await owned(session, assignment_id, user)
    if not a.is_room:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This is not a room")
    a.join_code = await new_join_code(session)
    audit.record(session, "room_code_changed", actor_id=user.id, target=str(a.id))
    await session.commit()
    return await assignment_out(session, a)


@router.post("/{assignment_id}/release", response_model=AssignmentOut)
async def release(
    assignment_id: uuid.UUID, request: Request, session: SessionDep, user: CreatorUser
) -> AssignmentOut:
    a = await owned(session, assignment_id, user)
    first = a.released_at is None
    a.released_at = datetime.now(UTC)
    audit.record(session, "scores_released", actor_id=user.id, target=str(a.id))
    await session.commit()
    if first and a.notify and get_settings().email_enabled:
        await enqueue(request, "notify_released", str(a.id))
    return await assignment_out(session, a)


# ---------------------------------------------------------------- reports


def _pct(x: Decimal | None, y: Decimal) -> float | None:
    if x is None or not y:
        return None
    return round(float(x) / float(y) * 100, 1)


def best_attempt(attempts: list[Attempt]) -> Attempt | None:
    done = [a for a in attempts if a.status == AttemptStatus.submitted]
    if not done:
        return None
    return max(
        done,
        key=lambda a: (
            a.score or Decimal("-1"),
            a.submitted_at or datetime.min.replace(tzinfo=UTC),
        ),
    )


def cell_state(snap: dict[str, Any], ans: Any, graded: bool) -> str:
    """One square of the overview grid: correct, partial, wrong, pending, blank or answered."""
    if ans is None or not ans.response:
        return "blank"
    if not graded:
        return "answered"
    final = ans.manual_score if ans.manual_score is not None else ans.auto_score
    if final is None:
        return "pending"
    marks = Decimal(str(snap["marks"]))
    if marks <= 0:
        return "answered"
    if final >= marks:
        return "correct"
    return "partial" if final > 0 else "wrong"


async def build_report(session: AsyncSession, a: ActivityAssignment) -> dict[str, Any]:
    graded = svc.is_graded(a.activity.kind)
    student_ids = await svc.target_student_ids(session, a)
    attempts = list(
        (await session.scalars(select(Attempt).where(Attempt.assignment_id == a.id))).unique()
    )
    by_student: dict[uuid.UUID, list[Attempt]] = {}
    for att in attempts:
        by_student.setdefault(att.student_id, []).append(att)
        student_ids.add(att.student_id)  # someone later removed from the section still counts
    users = {
        u.id: u
        for u in (await session.scalars(select(User).where(User.id.in_(student_ids)))).unique()
    }

    students: list[dict[str, Any]] = []
    best_list: list[Attempt] = []
    for sid in student_ids:
        u = users.get(sid)
        atts = sorted(by_student.get(sid, []), key=lambda x: x.attempt_no)
        best = best_attempt(atts)
        if best:
            best_list.append(best)
        latest = atts[-1] if atts else None
        blocked = latest if latest is not None and svc.can_unblock(latest) else None
        st = (
            "submitted"
            if best
            else "in_progress"
            if any(x.status == AttemptStatus.in_progress for x in atts)
            else "not_started"
        )
        students.append(
            {
                "student_id": sid,
                "name": u.full_name if u else "?",
                "usn": u.username if u else "?",
                "email": u.email if u else None,
                "status": st,
                "attempts": len(atts),
                "attempt_id": best.id if best else (atts[-1].id if atts else None),
                "score": best.score if best else None,
                "max_score": best.max_score if best else None,
                "accuracy": _pct(best.score, best.max_score) if best and graded else None,
                "needs_manual": bool(best and best.needs_manual),
                "violations": max((x.violations for x in atts), default=0),
                "submit_reason": best.submit_reason if best else None,
                "late": bool(best and best.late),
                "submitted_at": best.submitted_at if best else None,
                "blocked_attempt_id": blocked.id if blocked else None,
                "unblocked": sum(x.unblocked_count for x in atts),
            }
        )
    students.sort(key=lambda s: (s["status"] != "submitted", s["name"]))

    # per question, from the best attempt of each student
    questions: dict[str, dict[str, Any]] = {}
    for q in sorted(a.activity.questions, key=lambda q: q.position):
        questions[str(q.id)] = {
            "question_id": str(q.id),
            "position": q.position,
            "type": q.type.value,
            "stem": q.stem,
            "marks": q.marks if graded else Decimal("0"),
            "answered": 0,
            "correct": 0,
            "score_sum": Decimal("0"),
            "pending": 0,
            # The key, for the staff who own this report (students never get this endpoint).
            "options": [
                {
                    "id": o["id"],
                    "text": o.get("text", ""),
                    "count": 0,
                    "correct": bool(o.get("correct")) and graded,
                }
                for o in q.options or []
            ],
            "answer": q.answer if graded and q.type.value == "fill_blank" else None,
        }
    # student x question grid (the report's Overview tab)
    cells: dict[uuid.UUID, dict[str, str]] = {}
    for att in best_list:
        answers = {str(x.question_id): x for x in att.answers}
        grid = cells.setdefault(att.student_id, {})
        for snap in att.snapshot:
            row = questions.get(snap["id"])
            ans = answers.get(snap["id"])
            grid[snap["id"]] = cell_state(snap, ans, graded)
            if row is None or ans is None or not ans.response:
                continue
            row["answered"] += 1
            chosen = set(ans.response.get("choices") or []) | {ans.response.get("choice")}
            for o in row["options"]:
                if o["id"] in chosen:
                    o["count"] += 1
            if graded:
                final = ans.manual_score if ans.manual_score is not None else ans.auto_score
                if final is None:
                    row["pending"] += 1
                else:
                    row["score_sum"] += final
                if grade(snap, ans.response).correct:
                    row["correct"] += 1
    qrows = []
    for row in questions.values():
        n = row["answered"]
        qrows.append(
            {
                **{k: v for k, v in row.items() if k != "score_sum"},
                "accuracy": round(row["correct"] / n * 100, 1)
                if graded and n and row["type"] not in MANUAL_TYPES
                else None,
                "avg_score": (row["score_sum"] / n).quantize(Decimal("0.01"))
                if graded and n
                else None,
            }
        )

    for srow in students:
        srow["cells"] = cells.get(srow["student_id"], {})

    accs: list[float] = [s["accuracy"] for s in students if s["accuracy"] is not None]
    scores: list[Decimal] = [s["score"] for s in students if s["score"] is not None]
    summary = {
        "assigned": len(student_ids),
        "started": sum(1 for s in students if s["status"] != "not_started"),
        "submitted": len(best_list),
        "completion": round(len(best_list) / len(student_ids) * 100, 1) if student_ids else 0.0,
        "avg_accuracy": round(sum(accs) / len(accs), 1) if accs else None,
        "avg_score": (sum(scores, Decimal("0")) / len(scores)).quantize(Decimal("0.01"))
        if scores
        else None,
        "high_score": max(scores) if scores else None,
        "low_score": min(scores) if scores else None,
        "max_score": sum((q.marks for q in a.activity.questions), Decimal("0"))
        if graded
        else Decimal("0"),
        "pending_grading": sum(1 for s in students if s["needs_manual"]),
        "graded": graded,
    }
    return {
        "assignment": await assignment_out(session, a),
        "summary": summary,
        "questions": qrows,
        "students": students,
    }


@router.get("/{assignment_id}/results")
async def results(
    assignment_id: uuid.UUID, session: SessionDep, user: CreatorUser
) -> dict[str, Any]:
    return await build_report(session, await owned(session, assignment_id, user))


@router.get("/{assignment_id}/results.csv")
async def results_csv(
    assignment_id: uuid.UUID, session: SessionDep, user: CreatorUser
) -> StreamingResponse:
    a = await owned(session, assignment_id, user)
    report = await build_report(session, a)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        [
            "USN/ID",
            "Name",
            "Email",
            "Status",
            "Attempts",
            "Marks obtained",
            "Max marks",
            "Accuracy %",
            "Pending grading",
            "Violations",
            "Submit reason",
            "Late",
            "Submitted at",
        ]
    )
    for s in report["students"]:
        w.writerow(
            [
                s["usn"],
                s["name"],
                s["email"] or "",
                s["status"],
                s["attempts"],
                s["score"] if s["score"] is not None else "",
                s["max_score"] or "",
                s["accuracy"] if s["accuracy"] is not None else "",
                "yes" if s["needs_manual"] else "",
                s["violations"],
                s["submit_reason"] or "",
                "yes" if s["late"] else "",
                s["submitted_at"].isoformat() if s["submitted_at"] else "",
            ]
        )
    name = "".join(c if c.isalnum() else "-" for c in a.activity.title)[:50]
    return StreamingResponse(
        iter(["﻿" + buf.getvalue()]),  # BOM so Excel opens UTF-8 correctly
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="openqz-{name}-results.csv"'},
    )


# ---------------------------------------------------------------- teacher view of an attempt


async def owned_attempt(session: AsyncSession, attempt_id: uuid.UUID, user: User) -> Attempt:
    att = await session.get(Attempt, attempt_id)
    if att is None or (user.role != Role.admin and att.assignment.activity.owner_id != user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attempt not found")
    return att


def teacher_view(att: Attempt, student: User | None) -> dict[str, Any]:
    answers = {str(x.question_id): x for x in att.answers}
    graded = svc.is_graded(att.assignment.activity.kind)
    items = []
    for i, q in enumerate(att.snapshot):
        ans = answers.get(q["id"])
        r = grade(q, ans.response if ans else None, graded=graded)
        items.append(
            {
                "index": i,
                "question": {
                    **strip_key(q),
                    "options": q.get("options", []),
                    "answer": q.get("answer"),
                },
                "rubric": q.get("rubric") or [],
                "rubric_scores": ans.rubric_scores if ans else None,
                "explanation": q.get("explanation"),
                "response": ans.response if ans else None,
                "marks": Decimal(q["marks"]),
                "auto_score": ans.auto_score if ans else None,
                "manual_score": ans.manual_score if ans else None,
                "feedback": ans.feedback if ans else None,
                "correct": r.correct,
                "needs_manual": q["type"] in MANUAL_TYPES and graded and bool(ans and ans.response),
            }
        )
    return {
        "attempt_id": att.id,
        "student": {"name": student.full_name, "usn": student.username} if student else None,
        "status": att.status,
        "submit_reason": att.submit_reason,
        "started_at": att.started_at,
        "submitted_at": att.submitted_at,
        "score": att.score,
        "max_score": att.max_score,
        "needs_manual": att.needs_manual,
        "violations": att.violations,
        "unblocked_count": att.unblocked_count,
        "can_unblock": svc.can_unblock(att),
        "late": att.late,
        "items": items,
    }


@router.get("/attempts/{attempt_id}")
async def attempt_detail(
    attempt_id: uuid.UUID, session: SessionDep, user: CreatorUser
) -> dict[str, Any]:
    att = await owned_attempt(session, attempt_id, user)
    return teacher_view(att, await session.get(User, att.student_id))


class UnblockIn(BaseModel):
    # On top of the time the student spent blocked, which is always given back.
    extra_minutes: int = Field(default=0, ge=0, le=180)


@router.post("/attempts/{attempt_id}/unblock")
async def unblock_attempt(
    attempt_id: uuid.UUID, body: UnblockIn, session: SessionDep, user: CreatorUser
) -> dict[str, Any]:
    """Let a student back into an attempt auto-submitted for too many warnings."""
    att = await owned_attempt(session, attempt_id, user)
    previous = att.violations
    try:
        await svc.unblock(session, att, body.extra_minutes)
    except svc.AttemptError as exc:
        raise HTTPException(exc.status_code, {"code": exc.code, "message": exc.message}) from exc
    audit.record(
        session,
        "attempt.unblock",
        actor_id=user.id,
        target=str(att.id),
        meta={
            "student_id": str(att.student_id),
            "assignment_id": str(att.assignment_id),
            "violations": previous,
            "extra_minutes": body.extra_minutes,
        },
    )
    await session.commit()
    return teacher_view(att, await session.get(User, att.student_id))


class GradeIn(BaseModel):
    # Either a single score, or per-criterion marks when the question has a rubric.
    score: Decimal | None = Field(default=None, ge=0)
    rubric_scores: dict[str, Decimal] | None = None
    feedback: str | None = Field(default=None, max_length=5000)


@router.put("/attempts/{attempt_id}/answers/{question_id}/grade")
async def grade_answer(
    attempt_id: uuid.UUID,
    question_id: uuid.UUID,
    body: GradeIn,
    session: SessionDep,
    user: CreatorUser,
) -> dict[str, Any]:
    att = await owned_attempt(session, attempt_id, user)
    if att.status != AttemptStatus.submitted:
        raise HTTPException(status.HTTP_409_CONFLICT, "The student has not submitted yet")
    if att.assignment.activity.kind not in (ActivityKind.quiz, ActivityKind.assignment):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This activity is not graded")
    q = next((x for x in att.snapshot if x["id"] == str(question_id)), None)
    ans = next((x for x in att.answers if x.question_id == question_id), None)
    if q is None or ans is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Answer not found")
    rubric = q.get("rubric") or []
    if rubric:
        given = body.rubric_scores or {}
        missing = [r["criterion"] for r in rubric if r["id"] not in given]
        if missing:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"Give marks for: {', '.join(missing)}"
            )
        for r in rubric:
            v = Decimal(str(given[r["id"]]))
            if v < 0 or v > Decimal(str(r["max"])):
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST, f"'{r['criterion']}' must be 0 to {r['max']}"
                )
        score = sum((Decimal(str(given[r["id"]])) for r in rubric), Decimal("0"))
        ans.rubric_scores = {r["id"]: str(given[r["id"]]) for r in rubric}
    else:
        if body.score is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Give a score")
        score = body.score
    if score > Decimal(q["marks"]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Score cannot exceed {q['marks']}")
    ans.manual_score = score
    ans.feedback = body.feedback
    ans.graded_by = user.id
    ans.graded_at = datetime.now(UTC)
    svc.recompute(att)
    await session.commit()
    return teacher_view(att, await session.get(User, att.student_id))


@router.get("/{assignment_id}/grading")
async def grading_queue(
    assignment_id: uuid.UUID, session: SessionDep, user: CreatorUser
) -> list[dict[str, Any]]:
    a = await owned(session, assignment_id, user)
    attempts = (
        await session.scalars(
            select(Attempt).where(
                Attempt.assignment_id == a.id,
                Attempt.status == AttemptStatus.submitted,
                Attempt.needs_manual.is_(True),
            )
        )
    ).unique()
    out = []
    for att in attempts:
        student = await session.get(User, att.student_id)
        answers = {str(x.question_id): x for x in att.answers}
        for q in att.snapshot:
            ans = answers.get(q["id"])
            if (
                ans
                and q["type"] in MANUAL_TYPES
                and ans.manual_score is None
                and ans.auto_score is None
            ):
                r = grade(q, ans.response)
                out.append(
                    {
                        "attempt_id": att.id,
                        "question_id": q["id"],
                        "student": student.full_name if student else "?",
                        "usn": student.username if student else "?",
                        "type": q["type"],
                        "stem": q["stem"],
                        "options": q.get("options", []),
                        "response": ans.response,
                        "marks": Decimal(q["marks"]),
                        "choice_correct": r.correct if q["type"] == "justify" else None,
                        "rubric": q.get("rubric") or [],
                        "explanation": q.get("explanation"),
                    }
                )
    return out


# ---------------------------------------------------------------- Excel export


def _xlsx(
    a: ActivityAssignment, report: dict[str, Any], marks_rows: list[list[Any]], qcount: int
) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    head_font = Font(bold=True, color="FFFFFF")
    head_fill = PatternFill("solid", fgColor="5B3FD6")

    def table(ws: Any, headers: list[str], rows: list[list[Any]], widths: list[int]) -> None:
        ws.append(headers)
        for c in ws[1]:
            c.font, c.fill = head_font, head_fill
            c.alignment = Alignment(vertical="center", wrap_text=True)
        for r in rows:
            ws.append(r)
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(i)].width = w
        ws.freeze_panes = "A2"
        if rows:
            ws.auto_filter.ref = ws.dimensions

    wb = Workbook()
    s = report["summary"]
    ws = wb.active
    ws.title = "Summary"
    info = [
        ("Activity", a.activity.title),
        ("Type", a.activity.kind.value),
        ("Assigned to", ", ".join(report["assignment"].target_labels)),
        ("Start", a.start_at.strftime("%Y-%m-%d %H:%M UTC")),
        ("Deadline", a.due_at.strftime("%Y-%m-%d %H:%M UTC") if a.due_at else "none"),
        ("Students assigned", s["assigned"]),
        ("Submitted", s["submitted"]),
        ("Completion %", s["completion"]),
        ("Average accuracy %", s["avg_accuracy"]),
        ("Average marks", float(s["avg_score"]) if s["avg_score"] is not None else None),
        ("Highest marks", float(s["high_score"]) if s["high_score"] is not None else None),
        ("Lowest marks", float(s["low_score"]) if s["low_score"] is not None else None),
        ("Maximum marks", float(s["max_score"])),
        ("Exported", datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")),
    ]
    for k, v in info:
        ws.append([k, v])
        ws.cell(ws.max_row, 1).font = Font(bold=True)
    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["B"].width = 60

    st_rows = [
        [
            x["usn"],
            x["name"],
            x["email"] or "",
            x["status"].replace("_", " "),
            x["attempts"],
            float(x["score"]) if x["score"] is not None else None,
            float(x["max_score"]) if x["max_score"] is not None else None,
            (x["accuracy"] / 100) if x["accuracy"] is not None else None,
            "yes" if x["needs_manual"] else "",
            x["violations"],
            x["submit_reason"] or "",
            "yes" if x["late"] else "",
            x["submitted_at"].strftime("%Y-%m-%d %H:%M") if x["submitted_at"] else "",
        ]
        for x in report["students"]
    ]
    ws2 = wb.create_sheet("Students")
    table(
        ws2,
        [
            "USN / ID",
            "Name",
            "Email",
            "Status",
            "Attempts",
            "Marks obtained",
            "Max marks",
            "Accuracy",
            "To grade",
            "Violations",
            "Submitted by",
            "Late",
            "Submitted at (UTC)",
        ],
        st_rows,
        [14, 26, 30, 12, 9, 9, 10, 10, 9, 10, 13, 6, 18],
    )
    for row in ws2.iter_rows(min_row=2, min_col=8, max_col=8):
        for c in row:
            c.number_format = "0.0%"

    ws3 = wb.create_sheet("Marks by question")
    table(
        ws3,
        ["USN / ID", "Name", *[f"Q{i + 1}" for i in range(qcount)], "Total"],
        marks_rows,
        [14, 26, *([7] * qcount), 9],
    )

    q_rows = [
        [
            i + 1,
            q["type"].replace("_", " "),
            q["stem"][:500],
            float(q["marks"]),
            q["answered"],
            (q["accuracy"] / 100) if q["accuracy"] is not None else None,
            float(q["avg_score"]) if q["avg_score"] is not None else None,
            q["pending"],
        ]
        for i, q in enumerate(report["questions"])
    ]
    ws4 = wb.create_sheet("Questions")
    table(
        ws4,
        ["#", "Type", "Question", "Marks", "Answered", "Accuracy", "Avg marks", "To grade"],
        q_rows,
        [5, 16, 70, 8, 10, 10, 10, 9],
    )
    for row in ws4.iter_rows(min_row=2, min_col=6, max_col=6):
        for c in row:
            c.number_format = "0.0%"
    for row in ws4.iter_rows(min_row=2, min_col=3, max_col=3):
        for c in row:
            c.alignment = Alignment(wrap_text=True, vertical="top")

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@router.get("/{assignment_id}/results.xlsx")
async def results_xlsx(
    assignment_id: uuid.UUID, session: SessionDep, user: CreatorUser
) -> Response:
    a = await owned(session, assignment_id, user)
    report = await build_report(session, a)
    qids = [str(q.id) for q in sorted(a.activity.questions, key=lambda q: q.position)]
    best_by_student = {
        s["student_id"]: s["attempt_id"] for s in report["students"] if s["status"] == "submitted"
    }
    marks_rows: list[list[Any]] = []
    for s in report["students"]:
        row: list[Any] = [s["usn"], s["name"]]
        att_id = best_by_student.get(s["student_id"])
        att = await session.get(Attempt, att_id) if att_id else None
        answers = {str(x.question_id): x for x in att.answers} if att else {}
        for qid in qids:
            ans = answers.get(qid)
            final = (
                None
                if ans is None
                else (ans.manual_score if ans.manual_score is not None else ans.auto_score)
            )
            row.append(float(final) if final is not None else None)
        row.append(float(s["score"]) if s["score"] is not None else None)
        marks_rows.append(row)
    data = _xlsx(a, report, marks_rows, len(qids))
    name = "".join(c if c.isalnum() else "-" for c in a.activity.title)[:50]
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="openqz-{name}-results.xlsx"'},
    )
