"""Google sign-in for everyone, redadair.com.au only (D1).

The domain is checked when the session starts and again on every request. A development-only
sign-in picker stands in while the OAuth client is pending (D23); it is refused outside local
and test, whatever the settings say.
"""

import asyncio
import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.errors import Forbidden, ServiceError
from app.models import DigitalStaff, UserSession
from app.seed import demo_staff
from app.services.actors import User

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"

_EXTEND_EVERY = timedelta(minutes=5)


def _now() -> datetime:
    return datetime.now(UTC)


# --- OAuth flow -------------------------------------------------------------------


def new_state() -> tuple[str, str]:
    """A random state for the OAuth round trip, and its signature for a short-lived cookie."""
    state = secrets.token_urlsafe(24)
    return state, sign(state)


def sign(value: str) -> str:
    key = get_settings().secret_key.encode()
    return hmac.new(key, value.encode(), hashlib.sha256).hexdigest()


def state_matches(state: str, signature: str | None) -> bool:
    return bool(signature) and hmac.compare_digest(sign(state), signature or "")


def authorize_url(state: str, redirect_uri: str) -> str:
    s = get_settings()
    if not s.google_oauth_client_id:
        raise ServiceError("oauth_not_configured", "Google sign-in isn't set up yet.", 503)
    params = {
        "client_id": s.google_oauth_client_id,
        "response_type": "code",
        "scope": "openid email profile",
        "redirect_uri": redirect_uri,
        "state": state,
        "hd": s.domains[0],  # a hint for the account picker; the claim is still checked below
        "prompt": "select_account",
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


async def exchange_code(code: str, redirect_uri: str) -> dict[str, Any]:
    """Swap the code for tokens and verify the ID token's signature, audience and expiry."""
    s = get_settings()
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": s.google_oauth_client_id,
                "client_secret": s.google_oauth_client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
    if response.status_code != 200:
        raise Forbidden("Google sign-in failed. Please try again.")
    id_token = response.json().get("id_token", "")

    def verify() -> dict[str, Any]:
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token as google_id_token

        claims: dict[str, Any] = google_id_token.verify_oauth2_token(  # type: ignore[no-untyped-call]
            id_token, google_requests.Request(), s.google_oauth_client_id
        )
        return claims

    return await asyncio.to_thread(verify)


def identity_from_claims(claims: dict[str, Any]) -> tuple[str, str, str]:
    """(email, name, hosted domain), or Forbidden for anyone outside the allowed domains."""
    email = str(claims.get("email", "")).lower()
    hosted = str(claims.get("hd", "")).lower()
    if not claims.get("email_verified"):
        raise Forbidden("Your Google account email isn't verified.")
    if not domain_allowed(email, hosted):
        raise Forbidden("Feedback is only for REDADAIR Google accounts.")
    return email, str(claims.get("name") or email.split("@")[0]), hosted


def domain_allowed(email: str, hosted_domain: str) -> bool:
    domains = get_settings().domains
    return hosted_domain in domains and email.rsplit("@", 1)[-1] in domains


# --- sessions ---------------------------------------------------------------------


async def start_session(db: AsyncSession, email: str, name: str, hosted_domain: str) -> UserSession:
    s = get_settings()
    session = UserSession(
        email=email.lower(),
        name=name,
        hosted_domain=hosted_domain.lower(),
        expires_at=_now() + timedelta(hours=s.session_hours),
    )
    db.add(session)
    await db.flush()
    return session


async def dev_sign_in(db: AsyncSession, email: str, name: str | None) -> UserSession:
    """The local stand-in for Google sign-in (D23). Same domain rule, never outside local and test."""
    s = get_settings()
    if not (s.dev_login and s.is_dev):
        raise Forbidden("Development sign-in is switched off.")
    email = email.strip().lower()
    domain = email.rsplit("@", 1)[-1]
    if not domain_allowed(email, domain):
        raise Forbidden("Feedback is only for REDADAIR Google accounts.")
    staff = await db.scalar(select(DigitalStaff).where(DigitalStaff.google_email == email))
    demo = next((d["name"] for d in demo_staff() if d["email"] == email), None)
    display = name or (staff.name if staff else demo or email.split("@")[0].replace(".", " ").title())
    return await start_session(db, email, display, domain)


async def user_for_session(db: AsyncSession, session_id: str | None) -> User | None:
    """The signed-in user for a cookie value. Re-checks the domain and looks up the role."""
    if not session_id:
        return None
    try:
        sid = uuid.UUID(session_id)
    except ValueError:
        return None
    now = _now()
    session = await db.get(UserSession, sid)
    if session is None or session.revoked_at is not None or session.expires_at <= now:
        return None
    if not domain_allowed(session.email, session.hosted_domain):
        return None
    new_expiry = now + timedelta(hours=get_settings().session_hours)
    if new_expiry - session.expires_at > _EXTEND_EVERY:
        session.expires_at = new_expiry
    return await user_for_email(db, session.email, session.name)


async def user_for_email(db: AsyncSession, email: str, name: str) -> User:
    staff = await db.scalar(
        select(DigitalStaff).where(DigitalStaff.google_email == email.lower(), DigitalStaff.active.is_(True))
    )
    if staff is None:
        return User(email=email.lower(), name=name, role="staff")
    return User(
        email=staff.google_email,
        name=staff.name,
        role="admin" if staff.role == "admin" else "digital",
        staff_id=staff.id,
        is_triage_lead=staff.is_triage_lead,
    )


async def revoke(db: AsyncSession, session_id: str | None) -> None:
    try:
        sid = uuid.UUID(session_id or "")
    except ValueError:
        return
    await db.execute(update(UserSession).where(UserSession.id == sid).values(revoked_at=_now()))
