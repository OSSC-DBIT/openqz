import enum
import uuid
from typing import Any

from sqlalchemy import Enum, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.base import Timestamped, UUIDPk


class ImportKind(enum.StrEnum):
    students = "students"
    faculty = "faculty"
    mapping = "mapping"


class ImportStatus(enum.StrEnum):
    uploaded = "uploaded"
    parsing = "parsing"
    preview = "preview"
    committing = "committing"
    done = "done"
    failed = "failed"


class ImportJob(UUIDPk, Timestamped, Base):
    __tablename__ = "import_jobs"

    kind: Mapped[ImportKind] = mapped_column(Enum(ImportKind, name="import_kind"))
    status: Mapped[ImportStatus] = mapped_column(
        Enum(ImportStatus, name="import_status"), default=ImportStatus.uploaded
    )
    original_filename: Mapped[str] = mapped_column(String(255))
    file_path: Mapped[str] = mapped_column(String(500))
    academic_year: Mapped[str] = mapped_column(String(9))
    header_map: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    source_headers: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    preview_rows: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    error_rows: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    total_rows: Mapped[int] = mapped_column(Integer, default=0)
    valid_rows: Mapped[int] = mapped_column(Integer, default=0)
    created_count: Mapped[int] = mapped_column(Integer, default=0)
    updated_count: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    credential_pdf_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
