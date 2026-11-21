"""Import questions into an activity: from a public Google Form, a spreadsheet or pasted text.

The three preview endpoints only read and return what they found; `questions/bulk` stores the
questions the teacher kept after reviewing them (all of them or none)."""

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

import anyio
from fastapi import APIRouter, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from app.api.v1.activities import (
    _apply,
    _assignment_count,
    _check_images,
    _editable,
    _validate_for_kind,
    full,
    get_owned,
)
from app.core.deps import CreatorUser, SessionDep
from app.core.redis import get_redis
from app.models import Question, User
from app.schemas.activities import ActivityOut, QuestionIn
from app.services import audit
from app.services import question_import as qi

router = APIRouter(tags=["question import"])

MAX_SHEET_BYTES = 2 * 1024 * 1024
PREVIEWS_PER_MINUTE = 12


def _problem(exc: qi.ImportProblem) -> HTTPException:
    return HTTPException(
        status.HTTP_400_BAD_REQUEST, detail={"code": "import_failed", "message": str(exc)}
    )


async def _rate_limit(user: User) -> None:
    """Fetching a form makes the server call Google: nobody gets to do that at speed."""
    r = get_redis()
    key = f"rl:qimport:{user.id}:{int(datetime.now(UTC).timestamp() // 60)}"
    n = await r.incr(key)
    if n == 1:
        await r.expire(key, 70)
    if n > PREVIEWS_PER_MINUTE:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many imports, wait a minute")


class FormIn(BaseModel):
    url: str = Field(min_length=10, max_length=500)


@router.post("/question-import/google-form")
async def from_google_form(body: FormIn, user: CreatorUser) -> dict[str, Any]:
    """Read a form anyone with the link can open. The page has no answer key, so choice
    questions come back with `needs_key` and the teacher marks the right answers."""
    await _rate_limit(user)
    try:
        qi.check_form_url(body.url)
        html = await anyio.to_thread.run_sync(qi.fetch_form_html, body.url)
        return qi.parse_google_form(html).as_dict()
    except qi.ImportProblem as exc:
        raise _problem(exc) from exc


@router.post("/question-import/file")
async def from_file(file: Annotated[UploadFile, File()], user: CreatorUser) -> dict[str, Any]:
    await _rate_limit(user)
    data = await file.read(MAX_SHEET_BYTES + 1)
    if len(data) > MAX_SHEET_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "That file is too large (2 MB at most)"
        )
    try:
        preview = await anyio.to_thread.run_sync(qi.parse_sheet, data, file.filename or "")
    except qi.ImportProblem as exc:
        raise _problem(exc) from exc
    return preview.as_dict()


class TextIn(BaseModel):
    text: str = Field(min_length=1, max_length=200_000)


@router.post("/question-import/text")
async def from_text(body: TextIn, user: CreatorUser) -> dict[str, Any]:
    await _rate_limit(user)
    try:
        return qi.parse_text(body.text).as_dict()
    except qi.ImportProblem as exc:
        raise _problem(exc) from exc


class BulkIn(BaseModel):
    questions: list[QuestionIn] = Field(min_length=1, max_length=qi.MAX_QUESTIONS)


@router.post(
    "/activities/{activity_id}/questions/bulk", response_model=ActivityOut, status_code=201
)
async def add_questions(
    activity_id: uuid.UUID, body: BulkIn, session: SessionDep, user: CreatorUser
) -> ActivityOut:
    """Append several questions at once. One bad question refuses the lot, and the message
    says which one, so a half-imported set never has to be cleaned up by hand."""
    act = await get_owned(session, activity_id, user)
    await _editable(session, act)
    start = len(act.questions)
    if start + len(body.questions) > 500:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "An activity holds at most 500 questions")
    for i, item in enumerate(body.questions):
        try:
            _validate_for_kind(act, item)
        except HTTPException as exc:
            raise HTTPException(
                exc.status_code,
                detail={"code": "bad_question", "message": f"Question {i + 1}: {exc.detail}"},
            ) from exc
        await _check_images(session, item)
        q = Question(activity_id=act.id, position=start + i)
        _apply(q, item)
        act.questions.append(q)
    act.updated_at = datetime.now(UTC)
    audit.record(
        session,
        "questions_imported",
        actor_id=user.id,
        target=str(act.id),
        meta={"count": len(body.questions)},
    )
    await session.commit()
    return await full(session, act, await _assignment_count(session, act.id))
