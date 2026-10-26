"""Runs the agent for the API: ADK Runner with sessions in Postgres schema `adk` (D10).

Locally the agent runs in this process. In production it runs on Vertex AI Agent Engine (D7);
this module is the one place to swap in the Agent Engine client.
"""

import logging
from collections.abc import AsyncIterator
from typing import Any

from google.adk.events import Event, EventActions
from google.adk.runners import Runner
from google.adk.sessions import BaseSessionService, DatabaseSessionService
from google.genai import types

from agent.agent import build_agent
from agent.model import ModelChoice, export_credentials, resolve
from app.config import get_settings
from app.services import usage
from app.services.actors import User

log = logging.getLogger(__name__)

APP_NAME = "feedback"
GREETING = "G'day, I'm Sig, Smoke Signal's AI assistant. Spotted something?"

_runner: Runner | None = None
_sessions: BaseSessionService | None = None
_choice: ModelChoice | None = None


def model_choice() -> ModelChoice:
    global _choice
    if _choice is None:
        _choice = resolve()
        if _choice.provider in ("gemini", "vertex"):
            export_credentials(_choice)  # embeddings may call Gemini before the agent is built
    return _choice


def _session_service() -> BaseSessionService:
    global _sessions
    if _sessions is None:
        _sessions = DatabaseSessionService(
            db_url=get_settings().database_url,
            connect_args={"server_settings": {"search_path": "adk"}},
            pool_pre_ping=True,
        )
    return _sessions


def get_runner() -> Runner:
    global _runner
    if _runner is None:
        choice = model_choice()
        if choice.provider == "none":
            raise RuntimeError("No model configured")
        _runner = Runner(agent=build_agent(choice), app_name=APP_NAME, session_service=_session_service())
        log.info("agent ready: provider=%s model=%s", choice.provider, choice.name)
    return _runner


def reset(sessions: bool = False) -> None:
    """Forget the runner and model choice (tests). sessions=True mimics a process restart."""
    global _runner, _sessions, _choice
    _runner = None
    _choice = None
    if sessions:
        _sessions = None


async def create_session(user: User, project_hint: str | None, context: dict[str, Any]) -> str:
    """A chat session owned by the signed-in user; only the API writes user and context."""
    state: dict[str, Any] = {
        "user": {"email": user.email, "name": user.name, "role": user.role},
        "context": context,
        "draft": {"project_slug": project_hint, "project_confidence": 1.0} if project_hint else {},
        "draft_confirmed": False,
        "user_turns": 0,
        "messages": 0,
        "questions": 0,
    }
    if project_hint:
        state["project_hint"] = project_hint
    service = _session_service()
    session = await service.create_session(app_name=APP_NAME, user_id=user.email, state=state)
    greeting = types.Content(role="model", parts=[types.Part(text=GREETING)])
    await service.append_event(session, Event(author="feedback_agent", content=greeting))
    return session.id


async def get_state(user: User, session_id: str) -> dict[str, Any] | None:
    session = await _session_service().get_session(app_name=APP_NAME, user_id=user.email, session_id=session_id)
    return dict(session.state) if session else None


async def run_turn(
    user: User, session_id: str, parts: list[types.Part], state_delta: dict[str, Any]
) -> AsyncIterator[str]:
    """Send one user message (text and file parts); yield each piece of text the agent says.
    The tokens each model call reports are recorded once the turn ends, even if it is cut short (D36)."""
    message = types.Content(role="user", parts=parts)
    calls = input_tokens = output_tokens = 0
    try:
        async for event in get_runner().run_async(
            user_id=user.email, session_id=session_id, new_message=message, state_delta=state_delta
        ):
            if not event.partial and event.usage_metadata is not None:
                calls += 1
                input_tokens += int(event.usage_metadata.prompt_token_count or 0)
                output_tokens += int(event.usage_metadata.candidates_token_count or 0)
            if event.partial or not event.content or event.author == "user":
                continue
            for part in event.content.parts or []:
                if part.text and not part.thought:
                    yield part.text
    finally:
        if calls:
            await usage.record(
                kind="chat",
                model=model_choice().name,
                calls=calls,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                user_email=user.email,
                session_id=session_id,
            )


async def update_state(user: User, session_id: str, delta: dict[str, Any]) -> None:
    service = _session_service()
    session = await service.get_session(app_name=APP_NAME, user_id=user.email, session_id=session_id)
    if session is None:
        raise KeyError(session_id)
    await service.append_event(session, Event(author="user", actions=EventActions(state_delta=delta)))
