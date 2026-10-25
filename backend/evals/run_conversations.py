"""Conversation checks for the chat agent (conversation_set.yaml): follow-ups on existing feedback,
misuse, privacy, off-topic and the varied ways people write. The routing set scores where items
go; this checks how the agent behaves.

Runs each case through the real chat API on whichever model the settings choose, in a throwaway
local database (pgserver, database "feedback_conversations", recreated each run), and reports the
model cost from the usage ledger.

    uv run python -m evals.run_conversations            # every case
    uv run python -m evals.run_conversations --only existing
"""

import argparse
import asyncio
import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

SET = Path(__file__).resolve().parent / "conversation_set.yaml"
MAX_TURNS = 6


@dataclass
class Result:
    name: str
    ok: bool
    problems: list[str] = field(default_factory=list)


def _events(body: str) -> list[tuple[str, dict[str, Any]]]:
    out: list[tuple[str, dict[str, Any]]] = []
    for block in body.replace("\r\n", "\n").split("\n\n"):
        name, data = "message", None
        for line in block.split("\n"):
            if line.startswith("event:"):
                name = line[6:].strip()
            elif line.startswith("data:"):
                data = line[5:].strip()
        if data is not None:
            out.append((name, json.loads(data)))
    return out


async def run_case(n: int, case: dict[str, Any]) -> Result:
    import httpx
    from sqlalchemy import func, select

    from app.db import session_scope
    from app.main import app
    from app.models import Feedback

    email = f"eval.chat{n}@redadair.example"
    replies: list[str] = []
    card = None
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://eval") as client:
        (await client.post("/api/auth/dev/sign-in", json={"email": email})).raise_for_status()
        sid = (await client.post("/api/chat/sessions", json={"context": {"source": "conversation eval"}})).json()[
            "session_id"
        ]
        for text in case["messages"][:MAX_TURNS]:
            body = (await client.post(f"/api/chat/sessions/{sid}/messages", json={"text": text})).text
            for name, data in _events(body):
                if name == "message":
                    replies.append(str(data.get("text", "")))
                elif name == "draft":
                    card = data
            if card and case["expect"] == "card":
                break
    async with session_scope() as db:
        mine = select(func.count()).select_from(Feedback).where(Feedback.submitter_email == email)
        saved = int(await db.scalar(mine) or 0)

    said = "\n".join(replies).lower()
    problems: list[str] = []
    if case["expect"] == "card" and card is None:
        problems.append("no confirm card")
    if case["expect"] == "no_card" and (card is not None or saved):
        problems.append("started or saved a report")
    if saved and case["expect"] == "card":
        problems.append("saved without the confirm button")
    require = case.get("require") or []
    if require and not any(r.lower() in said for r in require):
        problems.append(f"none of {require} in the replies")
    problems += [f"said {f!r}" for f in case.get("forbid") or [] if f.lower() in said]
    if problems:
        problems.append("replies: " + " | ".join(r.replace("\n", " ")[:160] for r in replies))
    return Result(case["name"], not problems, problems)


async def cost() -> tuple[int, float]:
    from sqlalchemy import func, select

    from app.db import session_scope
    from app.models import ModelUsage

    async with session_scope() as db:
        row = (await db.execute(select(func.count(), func.coalesce(func.sum(ModelUsage.cost_aud), 0)))).one()
        return int(row[0]), float(row[1])


async def run(cases: list[dict[str, Any]]) -> list[Result]:
    return [await run_case(n, case) for n, case in enumerate(cases, 1)]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", help="run only cases whose name starts with this")
    args = parser.parse_args()

    from scripts.local_db import start

    # The same local setup as scripts.dev_server, in a database of its own that each run recreates.
    os.environ["DATABASE_URL"] = start(database="feedback_conversations", fresh=True)
    os.environ.setdefault("APP_ENV", "local")
    os.environ.setdefault("DEV_LOGIN", "true")
    os.environ.setdefault("ALLOWED_DOMAINS", "redadair.com.au,redadair.example")
    os.environ.setdefault("EMAIL_BACKEND", "off")

    from alembic.config import Config

    from alembic import command
    from app.agent_runtime import model_choice
    from app.seed import run as seed

    command.upgrade(Config(str(Path(__file__).resolve().parent.parent / "alembic.ini")), "head")
    asyncio.run(seed())

    cases = list(yaml.safe_load(SET.read_text(encoding="utf-8"))["cases"])
    if args.only:
        cases = [c for c in cases if c["name"].startswith(args.only)]
    choice = model_choice()

    async def go() -> tuple[list[Result], tuple[int, float]]:
        results = await run(cases)
        return results, await cost()

    results, (calls, aud) = asyncio.run(go())
    passed = sum(r.ok for r in results)
    print(f"Conversation set: {passed}/{len(results)} passed on {choice.provider} ({choice.name})")
    print(f"Model calls: {calls}, cost about A${aud:.4f}")
    for r in results:
        print(f"  {'ok  ' if r.ok else 'FAIL'} {r.name}")
        for p in r.problems:
            print(f"         {p}")


if __name__ == "__main__":
    main()
