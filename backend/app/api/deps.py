"""Shared request dependencies. Roles are checked here, server-side, on every call (D1)."""

from typing import Annotated

from fastapi import Cookie, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.errors import Forbidden, ServiceError
from app.services import auth as auth_service
from app.services.actors import User

SESSION_COOKIE = "fb_session"

Db = Annotated[AsyncSession, Depends(get_db)]


async def current_user(db: Db, fb_session: Annotated[str | None, Cookie()] = None) -> User:
    user = await auth_service.user_for_session(db, fb_session)
    if user is None:
        raise ServiceError("signed_out", "Please sign in with your REDADAIR Google account.", 401)
    return user


async def digital_user(user: Annotated[User, Depends(current_user)]) -> User:
    if not user.is_digital:
        raise Forbidden("The console is for the Digital team.")
    return user


async def admin_user(user: Annotated[User, Depends(current_user)]) -> User:
    if not user.is_admin:
        raise Forbidden("Only Admins can do that.")
    return user


CurrentUser = Annotated[User, Depends(current_user)]
DigitalUser = Annotated[User, Depends(digital_user)]
AdminUser = Annotated[User, Depends(admin_user)]
