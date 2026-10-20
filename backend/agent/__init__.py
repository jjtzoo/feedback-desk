"""The Feedback intake agent, in its own package so it can deploy to Agent Engine (D7).

`root_agent` is exposed for `adk web` (run from backend/: `uv run adk web .`).
"""

from typing import Any


def __getattr__(name: str) -> Any:
    if name == "root_agent":
        from agent.agent import build_agent
        from agent.model import resolve

        return build_agent(resolve())
    raise AttributeError(name)
