"""Google sign-in (D1) and the local development stand-in (D23)."""

from typing import Annotated

from fastapi import APIRouter, Cookie, Query, Request
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import SESSION_COOKIE, CurrentUser, Db
from app.config import get_settings
from app.errors import ServiceError
from app.models import DigitalStaff
from app.schemas import MeOut
from app.services import auth as auth_service

router = APIRouter(tags=["auth"])
STATE_COOKIE = "fb_oauth_state"


def _redirect_uri(request: Request) -> str:
    return f"{get_settings().app_base_url}/api/auth/google/callback"


def _set_session(response: Response, session_id: str) -> None:
    s = get_settings()
    response.set_cookie(
        SESSION_COOKIE,
        session_id,
        max_age=s.session_hours * 3600,
        httponly=True,
        secure=s.cookie_secure,
        samesite="lax",
        path="/",
    )


def _safe_next(next_path: str | None) -> str:
    return next_path if next_path and next_path.startswith("/") and not next_path.startswith("//") else "/"


@router.get("/auth/google/start")
async def google_start(request: Request, next: str | None = None) -> Response:
    state, signature = auth_service.new_state()
    response = RedirectResponse(auth_service.authorize_url(state, _redirect_uri(request)), status_code=303)
    response.set_cookie(
        STATE_COOKIE,
        f"{state}.{signature}.{_safe_next(next)}",
        max_age=600,
        httponly=True,
        secure=get_settings().cookie_secure,
        samesite="lax",
        path="/api/auth",
    )
    return response


@router.get("/auth/google/callback")
async def google_callback(
    request: Request,
    db: Db,
    code: str = Query(default=""),
    state: str = Query(default=""),
    fb_oauth_state: Annotated[str | None, Cookie()] = None,
) -> Response:
    base = get_settings().app_base_url
    saved_state, _, rest = (fb_oauth_state or "..").partition(".")
    signature, _, next_path = rest.partition(".")
    if not code or not state or state != saved_state or not auth_service.state_matches(state, signature):
        return RedirectResponse(f"{base}/sign-in?error=state", status_code=303)
    try:
        claims = await auth_service.exchange_code(code, _redirect_uri(request))
        email, name, hosted = auth_service.identity_from_claims(claims)
    except ServiceError:
        return RedirectResponse(f"{base}/sign-in?error=domain", status_code=303)
    except Exception:
        return RedirectResponse(f"{base}/sign-in?error=google", status_code=303)
    session = await auth_service.start_session(db, email, name, hosted)
    response = RedirectResponse(f"{base}{_safe_next(next_path)}", status_code=303)
    _set_session(response, str(session.id))
    response.delete_cookie(STATE_COOKIE, path="/api/auth")
    return response


class DevSignInIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    name: str | None = Field(default=None, max_length=200)


class DevUserOut(BaseModel):
    email: str
    name: str
    role: str


@router.get("/auth/dev/users", response_model=list[DevUserOut])
async def dev_users(db: Db) -> list[DevUserOut]:
    """Seeded people to sign in as, for the local stand-in only."""
    s = get_settings()
    if not (s.dev_login and s.is_dev):
        return []
    staff = await db.scalars(
        select(DigitalStaff).where(DigitalStaff.active.is_(True)).order_by(DigitalStaff.role, DigitalStaff.name)
    )
    people = [
        DevUserOut(email=p.google_email, name=p.name, role="admin" if p.role == "admin" else "digital") for p in staff
    ]
    domain = s.domains[-1]
    people += [
        DevUserOut(email=f"sam.lee@{domain}", name="Sam Lee", role="staff"),
        DevUserOut(email=f"priya.nair@{domain}", name="Priya Nair", role="staff"),
    ]
    return people


@router.post("/auth/dev/sign-in", status_code=204)
async def dev_sign_in(body: DevSignInIn, db: Db) -> Response:
    session = await auth_service.dev_sign_in(db, body.email, body.name)
    response = Response(status_code=204)
    _set_session(response, str(session.id))
    return response


@router.post("/auth/signout", status_code=204)
async def signout(db: Db, fb_session: Annotated[str | None, Cookie()] = None) -> Response:
    await auth_service.revoke(db, fb_session)
    response = Response(status_code=204)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


@router.get("/me", response_model=MeOut)
async def me(user: CurrentUser) -> MeOut:
    s = get_settings()
    return MeOut(
        email=user.email,
        name=user.name,
        role=user.role,
        is_triage_lead=user.is_triage_lead,
        dev_login=s.dev_login and s.is_dev,
    )


@router.get("/auth/options")
async def options() -> dict[str, bool]:
    s = get_settings()
    return {"google": bool(s.google_oauth_client_id), "dev_login": s.dev_login and s.is_dev}
