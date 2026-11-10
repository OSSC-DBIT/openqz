"""Activities (quiz, assignment, poll, flashcards), questions, media, assignment of activities
to students, attempts and answers."""

import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import Timestamped, UUIDPk, utcnow


class ActivityKind(enum.StrEnum):
    quiz = "quiz"
    assignment = "assignment"
    poll = "poll"
    flashcards = "flashcards"


class ActivityStatus(enum.StrEnum):
    draft = "draft"
    published = "published"
    archived = "archived"


class QuestionType(enum.StrEnum):
    mcq = "mcq"
    true_false = "true_false"
    fill_blank = "fill_blank"
    multi_select = "multi_select"
    justify = "justify"  # pick an option and justify it in text
    open_ended = "open_ended"


class Activity(UUIDPk, Timestamped, Base):
    __tablename__ = "activities"

    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    kind: Mapped[ActivityKind] = mapped_column(Enum(ActivityKind, name="activity_kind"))
    status: Mapped[ActivityStatus] = mapped_column(
        Enum(ActivityStatus, name="activity_status"), default=ActivityStatus.draft, index=True
    )
    subject_id: Mapped[int | None] = mapped_column(
        ForeignKey("subjects.id", ondelete="SET NULL"), nullable=True
    )
    # Which class it is for. Department is the teacher's own; semester/section are picked
    # from the classes they teach. Used to filter the library and pre-fill "Assign".
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Whole-activity timer (seconds); None = untimed.
    time_limit_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Classes it is for (any number of semesters / sections of the owner's department).
    sections: Mapped[list["ActivitySection"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin"
    )

    @property
    def section_ids(self) -> list[int]:
        return sorted(s.section_id for s in self.sections)

    questions: Mapped[list["Question"]] = relationship(
        back_populates="activity",
        order_by="Question.position",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class ActivitySection(Base):
    __tablename__ = "activity_sections"

    activity_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("activities.id", ondelete="CASCADE"), primary_key=True
    )
    section_id: Mapped[int] = mapped_column(
        ForeignKey("sections.id", ondelete="CASCADE"), primary_key=True, index=True
    )


class Question(UUIDPk, Base):
    __tablename__ = "questions"

    activity_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("activities.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0)
    type: Mapped[QuestionType] = mapped_column(Enum(QuestionType, name="question_type"))
    stem: Mapped[str] = mapped_column(Text)
    stem_image_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("media.id", ondelete="SET NULL"), nullable=True
    )
    # [{"id": "a", "text": "...", "image_id": null, "correct": true}]
    options: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    # Type specific key: fill_blank {"blanks": [["paris", "paris city"], ...], "case_sensitive": false}
    #                    true_false {"value": true}
    answer: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    marks: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=Decimal("1"))
    # Multi-select: award partial credit for partly correct answers.
    partial_credit: Mapped[bool] = mapped_column(Boolean, default=True)
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[list[str]] = mapped_column(ARRAY(String(40)), default=list)
    # Per-question timer (seconds); None = no question timer.
    time_limit_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Marking scheme for open / justify answers: [{"id": "c1", "criterion": "...", "max": 2}]
    rubric: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )

    activity: Mapped[Activity] = relationship(back_populates="questions")


class Media(UUIDPk, Timestamped, Base):
    __tablename__ = "media"

    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    path: Mapped[str] = mapped_column(String(500))
    content_type: Mapped[str] = mapped_column(String(60))
    size: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64), index=True)


class ShowAnswers(enum.StrEnum):
    never = "never"
    after_submit = "after_submit"
    after_due = "after_due"


class ReleaseMode(enum.StrEnum):
    immediate = "immediate"  # scores visible right after submit (manual items pending)
    after_due = "after_due"
    manual = "manual"  # faculty clicks "release"


class ActivityAssignment(UUIDPk, Timestamped, Base):
    """An activity handed to sections and/or individual students."""

    __tablename__ = "activity_assignments"

    activity_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("activities.id", ondelete="CASCADE"), index=True
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Always 1 for real assignments (no retakes); only the load-test seed uses 0 (unlimited).
    max_attempts: Mapped[int] = mapped_column(Integer, default=1)
    allow_late: Mapped[bool] = mapped_column(Boolean, default=False)
    # Show right/wrong + explanation right after each question (locks that answer).
    instant_feedback: Mapped[bool] = mapped_column(Boolean, default=True)
    shuffle_questions: Mapped[bool] = mapped_column(Boolean, default=False)
    shuffle_options: Mapped[bool] = mapped_column(Boolean, default=False)
    show_answers: Mapped[ShowAnswers] = mapped_column(
        Enum(ShowAnswers, name="show_answers"), default=ShowAnswers.after_submit
    )
    release_mode: Mapped[ReleaseMode] = mapped_column(
        Enum(ReleaseMode, name="release_mode"), default=ReleaseMode.immediate
    )
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Overrides the activity timer; None = use the activity's.
    time_limit_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Tab switches / Back / reload allowed before auto-submit. 0 = only log.
    max_violations: Mapped[int] = mapped_column(Integer, default=3)
    # Player hides the questions until the student is in full screen (where the browser supports it).
    require_fullscreen: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    # Email students when assigned / when scores are released (needs SMTP).
    notify: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    # Optional note from the teacher or club organiser, shown to students before they start.
    instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    # When the "it has started" email went out (set at once when there is nothing to wait for).
    start_notified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Room: anyone signed in as a student can join with this 6-digit code.
    join_code: Mapped[str | None] = mapped_column(String(8), nullable=True, unique=True)
    accepting_joins: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true")
    )

    @property
    def is_room(self) -> bool:
        return self.join_code is not None

    activity: Mapped[Activity] = relationship(lazy="joined")
    targets: Mapped[list["AssignmentTarget"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin"
    )


class AssignmentTarget(Base):
    __tablename__ = "assignment_targets"
    __table_args__ = (UniqueConstraint("assignment_id", "section_id", "student_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    assignment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("activity_assignments.id", ondelete="CASCADE"), index=True
    )
    section_id: Mapped[int | None] = mapped_column(
        ForeignKey("sections.id", ondelete="CASCADE"), nullable=True, index=True
    )
    student_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )


class AttemptStatus(enum.StrEnum):
    in_progress = "in_progress"
    submitted = "submitted"


class SubmitReason(enum.StrEnum):
    manual = "manual"
    timer = "timer"
    deadline = "deadline"
    violations = "violations"


class Attempt(UUIDPk, Base):
    __tablename__ = "attempts"
    __table_args__ = (UniqueConstraint("assignment_id", "student_id", "attempt_no"),)

    assignment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("activity_assignments.id", ondelete="CASCADE"), index=True
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    attempt_no: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[AttemptStatus] = mapped_column(
        Enum(AttemptStatus, name="attempt_status"), default=AttemptStatus.in_progress, index=True
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # Server-side hard deadline (activity timer and/or due date). None = untimed.
    deadline_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    submit_reason: Mapped[SubmitReason | None] = mapped_column(
        Enum(SubmitReason, name="submit_reason"), nullable=True
    )
    # Frozen copy of the questions (incl. keys) in the order this student sees them.
    snapshot: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    linear: Mapped[bool] = mapped_column(Boolean, default=False)  # no going back
    late: Mapped[bool] = mapped_column(Boolean, default=False)
    current_index: Mapped[int] = mapped_column(Integer, default=0)
    violations: Mapped[int] = mapped_column(Integer, default=0)
    # How many times a teacher reopened this attempt after a violations auto-submit.
    unblocked_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    score: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)
    max_score: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=Decimal("0"))
    needs_manual: Mapped[bool] = mapped_column(Boolean, default=False)

    assignment: Mapped[ActivityAssignment] = relationship(lazy="joined")
    answers: Mapped[list["AttemptAnswer"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin"
    )


class AttemptAnswer(Base):
    __tablename__ = "attempt_answers"

    attempt_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("attempts.id", ondelete="CASCADE"), primary_key=True
    )
    question_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    response: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    question_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    answered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Answer can no longer change (instant feedback shown, or question timer ran out).
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    # Locked only because the attempt was submitted (not by a timer or instant feedback),
    # so it can be opened again if the teacher unblocks the attempt.
    submit_locked: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    auto_score: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    manual_score: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    # Per-criterion marks when the question has a rubric: {"c1": 2, "c2": 1.5}
    rubric_scores: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    graded_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    graded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
