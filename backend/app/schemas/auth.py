import uuid

from pydantic import BaseModel, Field

from app.models import Role


class LoginIn(BaseModel):
    # Plain str (not EmailStr) so a typo returns the same "incorrect email or password"
    # error as any other failure instead of a validation error.
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)


class GoogleLoginIn(BaseModel):
    credential: str = Field(min_length=20, max_length=4096)


class AuthConfigOut(BaseModel):
    google_client_id: str | None
    password_login: bool = True
    password_reset_email: bool = False


class ForgotIn(BaseModel):
    email: str = Field(min_length=3, max_length=254)


class ResetIn(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    new_password: str = Field(min_length=8, max_length=256)


class MeOut(BaseModel):
    id: uuid.UUID
    username: str
    full_name: str
    email: str | None
    role: Role
    department_code: str | None = None
    must_change_password: bool
    google_linked: bool = False


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: MeOut


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=8, max_length=256)
