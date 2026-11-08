import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict

from app.models import ImportKind, ImportStatus


class ImportJobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: ImportKind
    status: ImportStatus
    original_filename: str
    academic_year: str
    header_map: dict[str, Any] | None
    source_headers: list[str] | None
    preview_rows: list[dict[str, Any]] | None
    error_rows: list[dict[str, Any]] | None
    total_rows: int
    valid_rows: int
    created_count: int
    updated_count: int
    message: str | None
    has_credentials: bool = False
    created_at: datetime


class HeaderMapIn(BaseModel):
    # target field -> source column header
    header_map: dict[str, str]


class ImportFieldsOut(BaseModel):
    kind: ImportKind
    required: list[str]
    optional: list[str]
