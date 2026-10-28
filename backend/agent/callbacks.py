"""Guardrails enforced in code, not only in the instruction (spec v3 "Tools")."""

import logging
from typing import Any

from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.tools.base_tool import BaseTool
from google.adk.tools.tool_context import ToolContext
from google.genai import types

from app.config import get_settings

log = logging.getLogger("agent.tools")

TOOL_LIMITS = {"submit_feedback": 1, "find_duplicates": 3, "list_projects": 3}
TOO_LONG = "Sorry, this is taking longer than it should. Use the form below and we'll still get your feedback."


def before_tool(tool: BaseTool, args: dict[str, Any], tool_context: ToolContext) -> dict[str, Any] | None:
    state = tool_context.state
    counts: dict[str, int] = dict(state.get("tool_counts") or {})
    used = counts.get(tool.name, 0)

    refusal: dict[str, Any] | None = None
    limit = TOOL_LIMITS.get(tool.name)
    if limit is not None and used >= limit:
        refusal = {"error": "limit_reached", "message": f"{tool.name} can't be used again in this chat."}
    elif tool.name == "submit_feedback":
        if args:
            refusal = {
                "error": "no_arguments",
                "message": "submit_feedback takes no arguments; it saves the confirmed draft.",
            }
        elif not state.get("draft_confirmed"):
            refusal = {"error": "not_confirmed", "message": "Ask the person to press Confirm on the summary."}
        elif state.get("saved"):
            refusal = {"error": "already_saved", "reference": state["saved"]["reference"]}

    # Arguments are logged by name only: they can hold what people typed.
    log.info(
        "tool_call session=%s tool=%s args=%s result=%s",
        tool_context.session.id,
        tool.name,
        sorted(args),
        refusal["error"] if refusal else "allowed",
    )
    if refusal is None:
        counts[tool.name] = used + 1
        state["tool_counts"] = counts
    return refusal


def after_model(callback_context: CallbackContext, llm_response: LlmResponse) -> LlmResponse | None:
    """Add each model call's tokens to the session, for the per-conversation cost log (brief §8)."""
    usage = llm_response.usage_metadata
    if usage is None:
        return None
    state = callback_context.state
    totals = dict(state.get("usage") or {"calls": 0, "input_tokens": 0, "output_tokens": 0})
    totals["calls"] += 1
    totals["input_tokens"] += int(usage.prompt_token_count or 0)
    totals["output_tokens"] += int(usage.candidates_token_count or 0) + int(usage.thoughts_token_count or 0)
    state["usage"] = totals
    return None


def cost_aud(usage: dict[str, int]) -> float:
    s = get_settings()
    return round(
        usage.get("input_tokens", 0) / 1e6 * s.model_price_input_aud_per_m
        + usage.get("output_tokens", 0) / 1e6 * s.model_price_output_aud_per_m,
        5,
    )


def before_model(callback_context: CallbackContext, llm_request: LlmRequest) -> LlmResponse | None:
    settings = get_settings()
    for content in llm_request.contents or []:
        if content.role == "user":
            for part in content.parts or []:
                if part.text and len(part.text) > settings.max_message_chars + 4000:
                    part.text = part.text[: settings.max_message_chars + 4000]
    state = callback_context.state
    if int(state.get("user_turns") or 0) > settings.max_agent_turns and not state.get("saved"):
        state["offer_fallback"] = True
        return LlmResponse(content=types.Content(role="model", parts=[types.Part(text=TOO_LONG)]))
    return None
