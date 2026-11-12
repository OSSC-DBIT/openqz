from typing import Annotated

from fastapi import APIRouter, Cookie, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.deps import PendingUser, SessionDep, client_ip
from app.core.jobs import enqueue
from app.core.redis import get_redis
from app.models import User
from app.schemas.auth import (
    AuthConfigOut,
    ChangePasswordIn,
    ForgotIn,
    GoogleLoginIn,
    LoginIn,
    MeOut,
    ResetIn,
    TokenOut,
)
from app.services import auth_service
from app.services.auth_service import AuthError, IssuedTokens
from app.services.google_auth import GoogleTokenError, verify_google_id_token

router = APIRouter(prefix="/auth", tags=["auth"])

COOKIE_PATH = "/api/v1/auth"
# "Forgot password" requests and reset-link uses per client address per minute (each email
# is also limited to 3 links an hour, in auth_service).
RESET_PER_ADDRESS_PER_MINUTE = 20


def me_out(user: User) -> MeOut:
    return MeOut(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        email=user.email,
        role=user.role,
        department_code=user.department.code if user.department else None,
        must_change_password=user.must_change_password,
        google_linked=bool(user.google_sub),
    )


def _token_response(tokens: IssuedTokens) -> JSONResponse:
    s = get_settings()
    body = TokenOut(
        access_token=tokens.access_token,
        expires_in=s.access_token_ttl_minutes * 60,
        user=me_out(tokens.user),
    )
    resp = JSONResponse(body.model_dump(mode="json"))
    resp.set_cookie(
        s.refresh_cookie_name,
        tokens.refresh_token,
        max_age=s.refresh_token_ttl_days * 86400,
        httponly=True,
        secure=s.cookie_secure,
        samesite="strict",
        path=COOKIE_PATH,
    )
    return resp


def _http(exc: AuthError) -> HTTPException:
    return HTTPException(exc.status_code, detail={"code": exc.code, "message": exc.message})


@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn, request: Request, session: SessionDep) -> JSONResponse:
    ip = client_ip(request)
    try:
        await auth_service.check_rate_limit(get_redis(), ip)
        user = await auth_service.authenticate(session, body.email, body.password, ip)
        tokens = await auth_service.issue_tokens(session, user)
    except AuthError as exc:
        raise _http(exc) from exc
    return _token_response(tokens)


@router.get("/config", response_model=AuthConfigOut)
async def auth_config() -> AuthConfigOut:
    """Public: tells the login page which sign-in methods are available."""
    s = get_settings()
    return AuthConfigOut(
        google_client_id=s.google_client_id or None,
        password_reset_email=s.email_enabled,
    )


@router.post("/forgot", status_code=202)
async def forgot(body: ForgotIn, request: Request, session: SessionDep) -> dict[str, str]:
    """Always answers the same way so nobody can probe which emails have accounts."""
    msg = {"message": "If that email has an OpenQZ account, a reset link is on its way."}
    if not get_settings().email_enabled:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail={"code": "email_disabled", "message": "Ask your admin to reset your password"},
        )
    ip = client_ip(request)
    try:
        await auth_service.check_rate_limit(
            get_redis(), ip, scope="forgot", limit=RESET_PER_ADDRESS_PER_MINUTE
        )
    except AuthError as exc:
        raise _http(exc) from exc
    found = await auth_service.request_password_reset(session, get_redis(), body.email, ip)
    if found:
        user, raw = found
        await enqueue(request, "send_password_reset", str(user.id), raw)
    return msg


@router.post("/reset", response_model=TokenOut)
async def reset(body: ResetIn, request: Request, session: SessionDep) -> JSONResponse:
    try:
        # Guessing a reset token is hopeless (256 random bits), but nobody gets to try at speed.
        await auth_service.check_rate_limit(
            get_redis(), client_ip(request), scope="reset_done", limit=RESET_PER_ADDRESS_PER_MINUTE
        )
        user = await auth_service.reset_password_with_token(session, body.token, body.new_password)
        tokens = await auth_service.issue_tokens(session, user)
    except AuthError as exc:
        raise _http(exc) from exc
    return _token_response(tokens)


@router.post("/google", response_model=TokenOut)
async def google(body: GoogleLoginIn, request: Request, session: SessionDep) -> JSONResponse:
    ip = client_ip(request)
    if not get_settings().google_client_id:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail={"code": "google_disabled", "message": "Google sign-in is not enabled"},
        )
    try:
        await auth_service.check_rate_limit(get_redis(), ip)
        try:
            claims = await verify_google_id_token(body.credential)
        except GoogleTokenError as exc:
            raise AuthError("google_invalid", "Google sign-in failed, please try again") from exc
        user = await auth_service.google_login(session, claims, ip)
        tokens = await auth_service.issue_tokens(session, user)
    except AuthError as exc:
        raise _http(exc) from exc
    return _token_response(tokens)


RefreshCookie = Annotated[str | None, Cookie(alias="openqz_refresh")]


@router.post("/refresh", response_model=TokenOut)
async def refresh(session: SessionDep, openqz_refresh: RefreshCookie = None) -> JSONResponse:
    if not openqz_refresh:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail={"code": "invalid_refresh", "message": "Not logged in"},
        )
    try:
        tokens = await auth_service.rotate_refresh(session, openqz_refresh)
    except AuthError as exc:
        raise _http(exc) from exc
    return _token_response(tokens)


@router.post("/logout", status_code=204)
async def logout(session: SessionDep, openqz_refresh: RefreshCookie = None) -> Response:
    if openqz_refresh:
        await auth_service.revoke_refresh(session, openqz_refresh)
    resp = Response(status_code=204)
    resp.delete_cookie(get_settings().refresh_cookie_name, path=COOKIE_PATH)
    return resp


@router.get("/me", response_model=MeOut)
async def me(user: PendingUser) -> MeOut:
    return me_out(user)


@router.post("/change-password", response_model=TokenOut)
async def change_password(
    body: ChangePasswordIn, user: PendingUser, session: SessionDep
) -> JSONResponse:
    try:
        await auth_service.change_password(session, user, body.current_password, body.new_password)
        tokens = await auth_service.issue_tokens(session, user)
    except AuthError as exc:
        raise _http(exc) from exc
    return _token_response(tokens)
