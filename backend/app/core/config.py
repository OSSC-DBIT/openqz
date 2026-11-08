from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    debug: bool = False
    public_url: str = "http://localhost"

    jwt_secret: str = Field(min_length=16)
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 7
    cookie_secure: bool = True
    refresh_cookie_name: str = "openqz_refresh"

    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost"]
    allowed_hosts: Annotated[list[str], NoDecode] = ["localhost"]

    login_max_failures: int = 5
    login_lock_minutes: int = 15
    # Per client address. A classroom often shares one Wi-Fi address, so keep this generous;
    # account lockout (login_max_failures) is what stops password guessing.
    login_rate_per_minute: int = 60

    # Google sign-in. Blank client id = button hidden and endpoint disabled.
    google_client_id: str = ""
    # Optional allow-list of email domains for Google sign-in (blank = any Google account
    # whose email matches an imported user).
    google_allowed_domains: Annotated[list[str], NoDecode] = []

    # Email (optional). Blank SMTP_HOST = no emails; "forgot password" is then hidden.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "OpenQZ <no-reply@openqz.local>"
    smtp_starttls: bool = True
    smtp_ssl: bool = False
    password_reset_ttl_minutes: int = 30

    database_url: str = "postgresql+asyncpg://openqz:openqz@db:5432/openqz"
    # Connections per process. Keep (pool + overflow) x (api workers + worker) below
    # Postgres max_connections (200 in compose.prod.yaml): 8 workers x 10 = 80 is safe.
    db_pool_size: int = 5
    db_max_overflow: int = 5
    redis_url: str = "redis://redis:6379/0"

    media_dir: Path = Path("/data/media")
    max_upload_mb: int = 10

    @field_validator("cors_origins", "allowed_hosts", "google_allowed_domains", mode="before")
    @classmethod
    def _split_csv(cls, v: object) -> object:
        if isinstance(v, str) and not v.strip().startswith("["):
            return [item.strip() for item in v.split(",") if item.strip()]
        return v

    @property
    def email_enabled(self) -> bool:
        return bool(self.smtp_host)

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in {"production", "staging"}


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
