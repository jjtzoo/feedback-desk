"""FastAPI app: routers under /api, errors as {"error": {"code", "message"}}."""

import logging
import warnings
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from app.api import admin, auth, chat, console, notifications, ops, staff, workspace
from app.db import dispose_engine
from app.errors import ServiceError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
# ADK logs a warning per model call when the stub reports no token usage.
logging.getLogger("google_adk.google.adk.telemetry._metrics").setLevel(logging.ERROR)
warnings.filterwarnings("ignore", message=r"\[EXPERIMENTAL\]", category=UserWarning)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    await dispose_engine()


app = FastAPI(title="Feedback", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")

for module in (ops, auth, chat, staff, notifications, console, workspace, admin):
    app.include_router(module.router, prefix="/api")


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)


@app.exception_handler(ServiceError)
async def service_error(_: Request, exc: ServiceError) -> JSONResponse:
    return _error(exc.status_code, exc.code, exc.message)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    where = ".".join(str(p) for p in first.get("loc", []) if p != "body")
    return _error(422, "invalid", f"{where}: {first.get('msg', 'invalid value')}" if where else "Invalid request.")


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
    return _error(exc.status_code, "http_error", str(exc.detail))
