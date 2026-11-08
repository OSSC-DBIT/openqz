import uuid
from datetime import datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models import Role

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    size: int


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    full_name: str
    email: str | None
    role: Role
    department_id: int | None
    is_active: bool
    must_change_password: bool
    google_linked: bool
    locked_until: datetime | None
    last_login_at: datetime | None
    created_at: datetime


class UserCreate(BaseModel):
    username: str = Field(min_length=2, max_length=64, pattern=r"^[A-Za-z0-9._-]+$")
    full_name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    role: Role
    department_id: int | None = None


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    email: EmailStr | None = None
    department_id: int | None = None
    is_active: bool | None = None


class UserCreatedOut(BaseModel):
    user: UserOut
    temporary_password: str


class PasswordResetOut(BaseModel):
    username: str
    email: str | None
    temporary_password: str
