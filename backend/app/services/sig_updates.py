"""Sig writes what the person who raised an item reads when it moves (D105).

The model gets the move's facts only and writes one or two plain sentences. The template, which says
the same facts, is used when the model is the stub, isn't configured, is over budget (D36), fails or is
slow, so a move never waits long and never goes out without its update.
"""

import asyncio
import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import usage

log = logging.getLogger(__name__)

TIMEOUT_SECONDS = 6
MAX_CHARS = 300
MAX_OUTPUT_TOKENS = 120
INSTRUCTION = (
    "You are Sig, the assistant in REDADAIR's feedback app. Write to the staff member who raised this item, "
    "telling them what just happened to it. Use only the facts given: never add a date, a promise, a cause, "
    "a person or a next step that isn't in them. One or two short, plain sentences, under 40 words, in "
    "Australian English. No greeting, no sign-off, no emoji, no markdown. Quote a reason given in the facts "
    "in full."
)


async def say(db: AsyncSession, template: str, facts: str) -> str:
    """Sig's words for a move, or the template."""
    from app.agent_runtime import model_choice

    choice = model_choice()
    if choice.provider not in ("gemini", "vertex") or not choice.configured or await usage.over_budget(db):
        return template
    try:
        text, input_tokens, output_tokens = await asyncio.wait_for(_generate(choice.name, facts), TIMEOUT_SECONDS)
    except Exception:
        log.warning("Sig's update failed; the template is used", exc_info=True)
        return template
    await usage.record(kind="chat", model=choice.name, input_tokens=input_tokens, output_tokens=output_tokens)
    text = " ".join(text.split())
    return text[:MAX_CHARS] if text else template


async def _generate(model: str, facts: str) -> tuple[str, int, int]:
    def call() -> tuple[str, int, int]:
        from google import genai
        from google.genai import types

        result = genai.Client().models.generate_content(
            model=model,
            contents=facts,
            config=types.GenerateContentConfig(
                system_instruction=INSTRUCTION, temperature=0.3, max_output_tokens=MAX_OUTPUT_TOKENS
            ),
        )
        meta = result.usage_metadata
        return (
            result.text or "",
            (meta.prompt_token_count or 0) if meta else 0,
            (meta.candidates_token_count or 0) if meta else 0,
        )

    return await asyncio.to_thread(call)
