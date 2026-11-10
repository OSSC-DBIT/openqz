import re
import uuid
from datetime import datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.models import Role

T = TypeVar("T")

PHONE_PATTERN = r"^\+?[0-9][0-9 ()-]{5,18}$"


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    size: int


class UserOut(BaseModel):
    id: uuid.UUID
    username: str
    full_name: str
    email: str | None
    phone: str | None = None
    designation: str | None = None
    role: Role
    # Main department, and every department the user belongs to (faculty may have several).
    department_id: int | None
    department_ids: list[int] = []
    # Students: their section in the latest academic year.
    section_id: int | None = None
    section_label: str | None = None
    is_active: bool
    must_change_password: bool
    google_linked: bool
    locked_until: datetime | None
    last_login_at: datetime | None
    created_at: datetime


def _blank_to_none(v: str | None) -> str | None:
    return (v or "").strip() or None


class UserCreate(BaseModel):
    username: str = Field(min_length=2, max_length=64, pattern=r"^[A-Za-z0-9._-]+$")
    full_name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    role: Role
    phone: str | None = Field(default=None, max_length=20)
    designation: str | None = Field(default=None, max_length=120)
    department_id: int | None = None
    # Faculty may belong to several departments; the first is the main one.
    department_ids: list[int] | None = Field(default=None, max_length=20)
    # Students: the section they study in.
    section_id: int | None = None

    _clean = field_validator("phone", "designation")(_blank_to_none)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str | None) -> str | None:
        if v is not None and not re.fullmatch(PHONE_PATTERN, v):
            raise ValueError("Enter a phone number with digits only, for example +91 98765 43210")
        return v


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=20)
    designation: str | None = Field(default=None, max_length=120)
    department_id: int | None = None
    department_ids: list[int] | None = Field(default=None, max_length=20)
    section_id: int | None = None
    is_active: bool | None = None

    _clean = field_validator("phone", "designation")(_blank_to_none)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str | None) -> str | None:
        if v is not None and not re.fullmatch(PHONE_PATTERN, v):
            raise ValueError("Enter a phone number with digits only, for example +91 98765 43210")
        return v


class UserCreatedOut(BaseModel):
    user: UserOut
    temporary_password: str


class PasswordResetOut(BaseModel):
    username: str
    email: str | None
    temporary_password: str
