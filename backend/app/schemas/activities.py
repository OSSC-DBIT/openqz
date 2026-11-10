import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models import (
    ActivityKind,
    ActivityStatus,
    QuestionType,
    ReleaseMode,
    ShowAnswers,
)

# Wayground-style timer presets (seconds); any value 5..3600 is accepted.
TIMER_PRESETS = [5, 10, 20, 30, 45, 60, 90, 120, 180, 300, 600]
BLANK_MARK = "___"


class OptionIn(BaseModel):
    id: str | None = Field(default=None, max_length=8)
    text: str = Field(default="", max_length=1000)
    image_id: uuid.UUID | None = None
    correct: bool = False


class RubricItem(BaseModel):
    id: str | None = Field(default=None, max_length=8)
    criterion: str = Field(min_length=1, max_length=300)
    max: Decimal = Field(gt=0, le=100)


class QuestionIn(BaseModel):
    type: QuestionType
    stem: str = Field(min_length=1, max_length=5000)
    stem_image_id: uuid.UUID | None = None
    options: list[OptionIn] = Field(default_factory=list, max_length=10)
    answer: dict[str, Any] = Field(default_factory=dict)
    marks: Decimal = Field(default=Decimal("1"), ge=0, le=100)
    partial_credit: bool = True
    explanation: str | None = Field(default=None, max_length=5000)
    tags: list[str] = Field(default_factory=list, max_length=10)
    time_limit_seconds: int | None = Field(default=None, ge=5, le=3600)
    rubric: list[RubricItem] = Field(default_factory=list, max_length=10)

    @field_validator("tags")
    @classmethod
    def _tags(cls, v: list[str]) -> list[str]:
        return [t.strip()[:40] for t in v if t.strip()]

    @model_validator(mode="after")
    def _shape(self) -> "QuestionIn":
        t = self.type
        if self.rubric:
            if t not in (QuestionType.open_ended, QuestionType.justify):
                raise ValueError("Rubrics are for open-ended and justify questions")
            for i, r in enumerate(self.rubric):
                r.id = r.id or f"c{i + 1}"
            if len({r.id for r in self.rubric}) != len(self.rubric):
                raise ValueError("Rubric criteria ids must be unique")
            total = sum((r.max for r in self.rubric), Decimal("0"))
            if total != self.marks:
                raise ValueError(
                    f"Rubric criteria add up to {total} but the question is worth {self.marks} marks"
                )
        if t == QuestionType.true_false:
            value = self.answer.get("value")
            if not isinstance(value, bool):
                # accept options with a correct flag as well
                flagged = [o for o in self.options if o.correct]
                if len(flagged) == 1 and flagged[0].id in ("true", "false"):
                    value = flagged[0].id == "true"
            if not isinstance(value, bool):
                raise ValueError("True/False needs answer.value true or false")
            self.answer = {"value": value}
            self.options = [
                OptionIn(id="true", text="True", correct=value),
                OptionIn(id="false", text="False", correct=not value),
            ]
        elif t in (QuestionType.mcq, QuestionType.justify, QuestionType.multi_select):
            filled = [o for o in self.options if o.text.strip() or o.image_id]
            if len(filled) < 2:
                raise ValueError("Add at least two answer options")
            self.options = filled
            for i, o in enumerate(self.options):
                o.id = o.id or "abcdefghij"[i]
            if len({o.id for o in self.options}) != len(self.options):
                raise ValueError("Option ids must be unique")
            self.answer = {}
        elif t == QuestionType.fill_blank:
            blanks = self.answer.get("blanks")
            if not isinstance(blanks, list) or not blanks:
                raise ValueError("Fill-in-the-blanks needs at least one blank with an answer")
            clean: list[list[str]] = []
            for b in blanks:
                alts = [
                    str(a).strip() for a in (b if isinstance(b, list) else [b]) if str(a).strip()
                ]
                if not alts:
                    raise ValueError("Every blank needs at least one accepted answer")
                clean.append(alts[:10])
            markers = self.stem.count(BLANK_MARK)
            if markers and markers != len(clean):
                raise ValueError(
                    f"The question has {markers} '{BLANK_MARK}' blanks but {len(clean)} answers"
                )
            self.answer = {
                "blanks": clean,
                "case_sensitive": bool(self.answer.get("case_sensitive", False)),
            }
            self.options = []
        else:  # open_ended
            self.options = []
            self.answer = {}
        return self


class QuestionOut(QuestionIn):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    position: int

    @model_validator(mode="after")
    def _shape(self) -> "QuestionOut":  # stored data is already valid
        return self


class ActivityIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    kind: ActivityKind = ActivityKind.quiz
    subject_id: int | None = None
    # Classes it is for: any number of sections (several semesters allowed). Faculty may
    # pick only sections they teach; the department is always their own.
    section_ids: list[int] = Field(default_factory=list, max_length=50)
    time_limit_seconds: int | None = Field(default=None, ge=30, le=6 * 3600)


class ActivityUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    subject_id: int | None = None
    section_ids: list[int] | None = Field(default=None, max_length=50)
    time_limit_seconds: int | None = Field(default=None, ge=30, le=6 * 3600)


class ActivitySummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: str | None
    kind: ActivityKind
    status: ActivityStatus
    subject_id: int | None
    department_id: int | None = None
    section_ids: list[int] = []
    semesters: list[int] = []
    class_labels: list[str] = []
    time_limit_seconds: int | None
    question_count: int = 0
    total_marks: Decimal = Decimal("0")
    assignment_count: int = 0
    created_at: datetime
    updated_at: datetime


class ActivityOut(ActivitySummary):
    questions: list[QuestionOut] = []


class ReorderIn(BaseModel):
    question_ids: list[uuid.UUID]


class BulkApplyIn(BaseModel):
    """Wayground's 'apply to all': set the timer and/or marks on every question."""

    time_limit_seconds: int | None = Field(default=None, ge=5, le=3600)
    clear_timer: bool = False
    marks: Decimal | None = Field(default=None, ge=0, le=100)


class AssignIn(BaseModel):
    section_ids: list[int] = Field(default_factory=list)
    student_ids: list[uuid.UUID] = Field(default_factory=list)
    start_at: datetime | None = None
    due_at: datetime | None = None
    allow_late: bool = False
    # One attempt per student, always (no retakes). A blocked student is reopened with Unblock.
    shuffle_questions: bool = False
    shuffle_options: bool = False
    instant_feedback: bool = True
    show_answers: ShowAnswers = ShowAnswers.after_submit
    release_mode: ReleaseMode = ReleaseMode.immediate
    time_limit_seconds: int | None = Field(default=None, ge=30, le=6 * 3600)
    max_violations: int = Field(default=3, ge=0, le=50)
    require_fullscreen: bool = True
    notify: bool = True
    # Optional note shown to students before they start.
    instructions: str | None = Field(default=None, max_length=5000)
    # Room: open to any signed-in student who enters the join code.
    room: bool = False

    @model_validator(mode="after")
    def _check(self) -> "AssignIn":
        if not self.room and not self.section_ids and not self.student_ids:
            raise ValueError("Pick at least one section or student, or open it as a room")
        if self.start_at and self.due_at and self.due_at <= self.start_at:
            raise ValueError("Deadline must be after the start time")
        self.instructions = (self.instructions or "").strip() or None
        return self


class AssignUpdate(BaseModel):
    due_at: datetime | None = None
    allow_late: bool | None = None
    shuffle_questions: bool | None = None
    shuffle_options: bool | None = None
    instant_feedback: bool | None = None
    show_answers: ShowAnswers | None = None
    release_mode: ReleaseMode | None = None
    max_violations: int | None = Field(default=None, ge=0, le=50)
    require_fullscreen: bool | None = None
    notify: bool | None = None
    instructions: str | None = Field(default=None, max_length=5000)
    accepting_joins: bool | None = None


class AssignmentOut(BaseModel):
    id: uuid.UUID
    activity_id: uuid.UUID
    activity_title: str
    activity_kind: ActivityKind
    start_at: datetime
    due_at: datetime | None
    allow_late: bool
    max_attempts: int
    shuffle_questions: bool
    shuffle_options: bool
    instant_feedback: bool
    show_answers: ShowAnswers
    release_mode: ReleaseMode
    released_at: datetime | None
    time_limit_seconds: int | None
    max_violations: int
    require_fullscreen: bool
    notify: bool
    instructions: str | None = None
    is_room: bool = False
    join_code: str | None = None
    accepting_joins: bool = True
    host_name: str | None = None
    section_ids: list[int]
    student_ids: list[uuid.UUID]
    target_labels: list[str] = []
    student_count: int = 0
    submitted_count: int = 0
    created_at: datetime
