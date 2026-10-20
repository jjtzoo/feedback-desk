"""Health check and scheduled-job endpoints (Cloud Scheduler calls these in staging and production)."""

import hmac
from typing import Annotated

from fastapi import APIRouter, Header
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app import agent_runtime as runtime
from app.api.deps import Db
from app.config import get_settings
from app.db import session_scope
from app.errors import Forbidden
from app.schemas import HealthOut
from app.services import jobs

router = APIRouter(tags=["ops"])


@router.get("/health", response_model=HealthOut)
async def health() -> JSONResponse:
    database, migration = "ok", None
    try:
        async with session_scope() as db:
            migration = await db.scalar(text("SELECT version_num FROM app.alembic_version"))
    except Exception as exc:
        database = f"error: {type(exc).__name__}"
    choice = runtime.model_choice()
    body = HealthOut(
        status="ok" if database == "ok" else "degraded",
        environment=get_settings().app_env,
        database=database,
        migration=migration,
        model={
            "provider": choice.provider,
            "name": choice.name,
            "credentials_set": choice.configured,
            "detail": choice.detail,
        },
    )
    # A missing model is not unhealthy: the backup form still takes feedback.
    return JSONResponse(body.model_dump(mode="json"), status_code=200 if database == "ok" else 503)


def _check_job_token(token: str | None) -> None:
    expected = get_settings().job_token
    if not expected or not token or not hmac.compare_digest(expected, token):
        raise Forbidden("Not allowed.")


@router.post("/jobs/daily-digest")
async def daily_digest(db: Db, x_job_token: Annotated[str | None, Header()] = None) -> dict[str, int]:
    _check_job_token(x_job_token)
    return {"notifications": await jobs.run_digest(db)}


@router.post("/jobs/release-drafts")
async def release_drafts(db: Db, x_job_token: Annotated[str | None, Header()] = None) -> dict[str, int]:
    _check_job_token(x_job_token)
    return {"drafts": await jobs.run_release_drafter(db)}
