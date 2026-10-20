"""feedback_agent: one LlmAgent with narrow, guarded tools (D7, D22)."""

import json
from pathlib import Path

from google.adk.agents import LlmAgent
from google.adk.agents.readonly_context import ReadonlyContext

from agent import callbacks, tools
from agent.model import ModelChoice, build_model

INSTRUCTION = (Path(__file__).parent / "instruction.md").read_text(encoding="utf-8")


def instruction(ctx: ReadonlyContext) -> str:
    """The versioned instruction plus this conversation's state, so the model knows what it has."""
    draft = ctx.state.get("draft") or {}
    hint = ctx.state.get("project_hint")
    context = ctx.state.get("context") or {}
    lines = ["", "## This conversation"]
    if hint:
        lines.append(f"The page was opened for project {hint!r}; it is already in the draft.")
    if context.get("source"):
        lines.append(f"They came from: {context['source']}.")
    lines.append(f"Questions asked so far: {int(ctx.state.get('questions') or 0)} of 3.")
    lines.append("Current draft: " + json.dumps(draft, ensure_ascii=False))
    return INSTRUCTION + "\n".join(lines)


def build_agent(choice: ModelChoice) -> LlmAgent:
    return LlmAgent(
        name="feedback_agent",
        model=build_model(choice),
        instruction=instruction,
        tools=[tools.list_projects, tools.update_draft, tools.find_duplicates, tools.submit_feedback],
        before_tool_callback=callbacks.before_tool,
        before_model_callback=callbacks.before_model,
        after_model_callback=callbacks.after_model,
    )
