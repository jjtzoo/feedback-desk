"""Sig writes what the person who raised an item reads when it moves (D105), and the first wording of
each Friday release item (D111).

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
RELEASE_TITLE = (
    "You are Sig, the assistant in REDADAIR's feedback app. Write the headline of one entry in this week's "
    "Fixes and updates, read by all staff. The Digital team has finished this item. Say what is better now for "
    "the people who use the tool, using only the facts given: never add a cause, a number, a date or a detail "
    "that isn't in them. Under 10 words, sentence case, no full stop, no emoji, no markdown, Australian English."
)
RELEASE_BODY = (
    "You are Sig, the assistant in REDADAIR's feedback app. Write the one-line description of an entry in this "
    "week's Fixes and updates, read by all staff. The Digital team has finished this item. In one plain sentence "
    "under 30 words, say what used to go wrong or was missing and what happens now, using only the facts given: "
    "never add a cause, a number, a date or a detail that isn't in them. No emoji, no markdown, Australian English."
)


async def say(db: AsyncSession, template: str, facts: str, instruction: str = INSTRUCTION) -> str:
    """Sig's words for a move (or, with another instruction, a release item), or the template."""
    from app.agent_runtime import model_choice

    choice = model_choice()
    if choice.provider not in ("gemini", "vertex") or not choice.configured or await usage.over_budget(db):
        return template
    try:
        text, input_tokens, output_tokens = await asyncio.wait_for(
            _generate(choice.name, facts, instruction), TIMEOUT_SECONDS
        )
    except Exception:
        log.warning("Sig's update failed; the template is used", exc_info=True)
        return template
    await usage.record(kind="chat", model=choice.name, input_tokens=input_tokens, output_tokens=output_tokens)
    text = " ".join(text.split())
    return text[:MAX_CHARS] if text else template


async def _generate(model: str, facts: str, instruction: str) -> tuple[str, int, int]:
    def call() -> tuple[str, int, int]:
        from google import genai
        from google.genai import types

        result = genai.Client().models.generate_content(
            model=model,
            contents=facts,
            config=types.GenerateContentConfig(
                system_instruction=instruction, temperature=0.3, max_output_tokens=MAX_OUTPUT_TOKENS
            ),
        )
        meta = result.usage_metadata
        return (
            result.text or "",
            (meta.prompt_token_count or 0) if meta else 0,
            (meta.candidates_token_count or 0) if meta else 0,
        )

    return await asyncio.to_thread(call)
