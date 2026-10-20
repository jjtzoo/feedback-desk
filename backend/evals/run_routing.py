"""Score the agent on the labelled routing set (brief §9 Sprint 2 gate).

Runs each item through the real chat API (sign in, describe, answer questions, confirm) with
whatever model the settings choose, then compares the saved item with its labels.

    uv run python -m evals.run_routing             # against .env's model (Gemini once the key lands)
    uv run python -m evals.run_routing --limit 5

Gate: 85 % project, 85 % work type, 80 % assignee, and every item has a developer brief.
With the stub model the scores only show the keyword baseline; the gate is judged on Gemini.
"""

import argparse
import asyncio
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
import yaml
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.db import session_scope
from app.main import app
from app.models import Feedback

SET = Path(__file__).resolve().parent / "routing_set.yaml"
GATE = {"project": 0.85, "work_type": 0.85, "assignee": 0.80}


@dataclass
class Score:
    total: int = 0
    correct: dict[str, int] = field(default_factory=lambda: dict.fromkeys(GATE, 0))
    misses: list[str] = field(default_factory=list)
    incomplete_briefs: int = 0

    def rate(self, key: str) -> float:
        return self.correct[key] / self.total if self.total else 0.0

    def passed(self) -> bool:
        return all(self.rate(k) >= v for k, v in GATE.items()) and self.incomplete_briefs == 0


def load_items(limit: int | None = None) -> list[dict[str, Any]]:
    items = list(yaml.safe_load(SET.read_text(encoding="utf-8"))["items"])
    return items[:limit] if limit else items


def _events(body: str) -> dict[str, dict[str, Any]]:
    """Last payload of each server-sent event name in a response."""
    out: dict[str, dict[str, Any]] = {}
    for block in body.replace("\r\n", "\n").split("\n\n"):
        name, data = "message", None
        for line in block.split("\n"):
            if line.startswith("event:"):
                name = line[6:].strip()
            elif line.startswith("data:"):
                data = line[5:].strip()
        if data is not None:
            out[name] = json.loads(data)
    return out


async def _converse(client: httpx.AsyncClient, item: dict[str, Any]) -> str | None:
    r = await client.post("/api/chat/sessions", json={"context": {"source": "routing eval"}})
    sid = r.json().get("session_id")
    if not sid:
        return None
    card = None
    # Out of scripted answers, reply the way a person would rather than leave it hanging.
    for text in [item["message"], *item.get("answers", []), "That's all I know.", "That's all I know."]:
        card = _events((await client.post(f"/api/chat/sessions/{sid}/messages", json={"text": text})).text).get("draft")
        if card:
            break
    if card is None:
        return None
    done = _events(
        (await client.post(f"/api/chat/sessions/{sid}/confirm", json={"draft_hash": card["hash"]})).text
    ).get("done")
    return str(done["reference"]) if done else None


async def _saved(ref: str) -> tuple[dict[str, Any], bool]:
    async with session_scope() as db:
        fb = await db.scalar(
            select(Feedback)
            .options(selectinload(Feedback.project), selectinload(Feedback.assignee))
            .where(Feedback.ref_no == ref)
        )
        assert fb is not None
        assignee = "needs review" if fb.status == "needs_review" else (fb.assignee.name if fb.assignee else None)
        got = {"project": fb.project.slug if fb.project else "general", "work_type": fb.work_type, "assignee": assignee}
        return got, bool(fb.dev_brief.get("problem") or fb.dev_brief.get("open_gaps"))


async def run(items: list[dict[str, Any]], domain: str = "redadair.example") -> Score:
    score = Score()
    for n, item in enumerate(items, 1):
        score.total += 1
        # One test person per item, as real staff would be (and under the per-person chat limit).
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://eval") as client:
            (await client.post("/api/auth/dev/sign-in", json={"email": f"eval.staff{n}@{domain}"})).raise_for_status()
            ref = await _converse(client, item)
        if ref is None:
            score.misses.append(f"no item saved: {item['message'][:60]!r}")
            continue
        got, brief_ok = await _saved(ref)
        score.incomplete_briefs += 0 if brief_ok else 1
        for key in GATE:
            if got[key] == item[key]:
                score.correct[key] += 1
            else:
                score.misses.append(f"{key}: wanted {item[key]!r}, got {got[key]!r} for {item['message'][:60]!r}")
    return score


def report(score: Score) -> str:
    lines = [f"Routing set: {score.total} items"]
    lines += [f"  {key:<10} {score.rate(key):6.1%}  (gate {target:.0%})" for key, target in GATE.items()]
    lines.append(f"  incomplete developer briefs: {score.incomplete_briefs}")
    lines.append("PASS" if score.passed() else "FAIL")
    lines += [f"  - {m}" for m in score.misses[:40]]
    return "\n".join(lines)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    print(report(asyncio.run(run(load_items(args.limit)))))
