"""Conversation checks for the chat agent: how it behaves, where the routing set scores where items go.

Two sets, same format: conversation_set.yaml (follow-ups on existing feedback, misuse, privacy,
off-topic, varied writing) and conversation_cases_real.yaml (written apart from the build, from how
staff really chat, to break Sig: D68). Every reply of every case is judged by code, not only the end
(review item 19):
  1. no question asked twice (the same kind of question, in any words)
  2. the chips match the question just asked (tools under the tool question, impact under the impact
     question, Yes and No under "send that to the team?", none without a question)
  3. at most 2 lines per reply
  4. no dashes as punctuation
  5. no card unless something was reported (the case's expect)
  6. no impact question when the person already said it ("slow", "can't work")
plus each case's own keys (chips per message, never_ask, card; never_repeat is rule 1, for every case).
A message written {pick: <slug>} picks that app card instead of typing (D99); a case's project opens
the chat for that tool, as /chat?project= does.

Runs each case through the real chat API on whichever model the settings choose, in a throwaway local
database (pgserver, database "feedback_conversations", recreated each run), and reports the model
cost from the usage ledger. Scored on Gemini; the stub only shows the scripted baseline.

    uv run python -m evals.run_conversations                # both sets
    uv run python -m evals.run_conversations --set real     # only conversation_cases_real.yaml
    uv run python -m evals.run_conversations --only real-15
"""

import argparse
import asyncio
import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

HERE = Path(__file__).resolve().parent
SETS = {"base": HERE / "conversation_set.yaml", "real": HERE / "conversation_cases_real.yaml"}
MAX_TURNS = 10
MAX_LINES = 2
MAX_CHARS = 300  # about two lines in the chat on a laptop

# The kinds of question Sig asks, to spot one asked twice in other words and to match chips to it.
QUESTION_KINDS = {
    "tool": re.compile(r"which (tool|app|system|platform)|is (this|it) about|what (tool|app) |which one", re.I),
    "impact": re.compile(r"affect\w*|impact|stopping you|nuisance|how much|how bad|blocking|getting your work", re.I),
    "send": re.compile(r"send (that|this|it) to|pass (that|this|it) on", re.I),
    "work_type": re.compile(r"exist\w* today|something new|new feature", re.I),
    "details": re.compile(
        r"which screen|what happened|what did you (see|expect)|since when|how often|what (were|was) you", re.I
    ),
}
CHIP_KIND = {"project": "tool", "impact": "impact"}
IMPACT_CHIP_LABELS = {"blocking my work", "slowing me down", "nice-to-have", "nice to have", "can't work at all"}
IMPACT_SAID = re.compile(
    r"\b(slow\w*|takes ages|laggy|can'?t work|cannot work|can'?t log ?in|blocked|blocking|stuck all day|urgent|"
    r"not urgent|annoying|frustrating|minor|nice to have|down)\b",
    re.I,
)
DASH = re.compile(r"[–—]|\s-\s")
PRIORITY_OF = {"blocking my work": "P1", "slowing me down": "P2", "minor": "P3", "nice-to-have": "P4"}


@dataclass
class Turn:
    said: str
    replies: list[str] = field(default_factory=list)
    chips: list[tuple[str, list[str]]] = field(default_factory=list)
    card: dict[str, Any] | None = None


@dataclass
class Result:
    name: str
    ok: bool
    problems: list[str] = field(default_factory=list)


def question_kinds(text: str) -> set[str]:
    """The kinds of question in a reply: only its sentences that end in "?"."""
    asked = [s for s in re.split(r"(?<=[.!?])\s+|\n", text) if s.rstrip().endswith("?")]
    return {kind for s in asked for kind, pattern in QUESTION_KINDS.items() if pattern.search(s)}


def judge_turns(case: dict[str, Any], turns: list[Turn]) -> list[str]:
    """The per-turn rubric (1 to 4 and 6 above) and the case's own per-turn keys."""
    problems: list[str] = []
    asked_before: dict[str, int] = {}
    expected_chips = case.get("chips") or []
    never_ask = {k for phrase in case.get("never_ask") or [] for k in question_kinds(f"{phrase}?")}
    person_so_far = ""
    for n, turn in enumerate(turns, 1):
        person_so_far += f"\n{turn.said}"
        reply = "\n".join(turn.replies)
        kinds = question_kinds(turn.replies[-1]) if turn.replies else set()
        at = f"turn {n}"
        for kind in kinds:
            if kind in asked_before:
                problems.append(f"{at}: asked the {kind} question again (first at turn {asked_before[kind]})")
            asked_before.setdefault(kind, n)
        problems += [f"{at}: asked the {k} question, which this chat must never ask" for k in kinds & never_ask]
        if "impact" in kinds and IMPACT_SAID.search(person_so_far):
            problems.append(f"{at}: asked about impact after they had said it")
        for r in turn.replies:
            lines = [line for line in r.splitlines() if line.strip()]
            if len(lines) > MAX_LINES or len(r) > MAX_CHARS:
                problems.append(f"{at}: a reply of {len(lines)} lines, {len(r)} characters")
            if DASH.search(r):
                problems.append(f"{at}: a dash as punctuation")
        for chip_kind, labels in turn.chips:
            wanted = CHIP_KIND.get(chip_kind)
            if not reply.rstrip().endswith("?"):
                problems.append(f"{at}: {chip_kind} chips without a question")
            elif wanted and wanted not in kinds:
                problems.append(f"{at}: {chip_kind} chips under a question that isn't about the {wanted}")
            if chip_kind != "impact" and {lb.lower() for lb in labels} & IMPACT_CHIP_LABELS and "impact" not in kinds:
                problems.append(f"{at}: impact answers offered under another question")
        if n <= len(expected_chips):
            problems += _expected_chips(at, str(expected_chips[n - 1]), turn)
    return problems


def _expected_chips(at: str, expected: str, turn: Turn) -> list[str]:
    kinds = [k for k, _ in turn.chips]
    labels = {lb.lower() for _, options in turn.chips for lb in options}
    if expected == "tools" and "project" not in kinds:
        return [f"{at}: expected the tool chips, got {kinds or 'none'}"]
    if expected == "no_impact" and ("impact" in kinds or labels & IMPACT_CHIP_LABELS):
        return [f"{at}: impact chips offered"]
    if expected == "none" and kinds:
        return [f"{at}: expected no chips, got {kinds}"]
    if expected == "card" and turn.card is None:
        return [f"{at}: expected the card"]
    if expected == "after" and kinds:
        return [f"{at}: new chips after the card ({kinds})"]
    return []


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
    turns: list[Turn] = []
    card = None
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://eval") as client:
        (await client.post("/api/auth/dev/sign-in", json={"email": email})).raise_for_status()
        start = {"project_slug": case.get("project"), "context": {"source": "conversation eval"}}
        sid = (await client.post("/api/chat/sessions", json=start)).json()["session_id"]
        for message in case["messages"][:MAX_TURNS]:
            if isinstance(message, dict):  # {pick: slug}: an app card at the start of the chat (D99)
                turn = Turn(said=f"[card] {message['pick']}")
                sent = await client.post(f"/api/chat/sessions/{sid}/tool", json={"project_slug": message["pick"]})
            else:
                turn = Turn(said=message)
                sent = await client.post(f"/api/chat/sessions/{sid}/messages", json={"text": message})
            body = sent.text
            for name, data in _events(body):
                if name == "message":
                    turn.replies.append(str(data.get("text", "")))
                elif name == "chips":
                    turn.chips.append((str(data.get("kind")), [str(o.get("label")) for o in data.get("options") or []]))
                elif name == "draft":
                    turn.card = card = data["card"]
            turns.append(turn)
            if card and case["expect"] == "card" and not case.get("after_card"):
                break
    async with session_scope() as db:
        mine = select(func.count()).select_from(Feedback).where(Feedback.submitter_email == email)
        saved = int(await db.scalar(mine) or 0)

    replies = [r for t in turns for r in t.replies]
    said = "\n".join(replies).lower()
    chips = [c for t in turns for c in t.chips]
    problems = judge_turns(case, turns)
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
    problems += [f"offered {k} chips" for k in case.get("forbid_chips") or [] if any(kind == k for kind, _ in chips)]
    labels = {label.lower() for _, options in chips for label in options}
    problems += [f"offered the chip {c!r}" for c in case.get("forbid_chip_labels") or [] if c.lower() in labels]
    if case.get("asks_last") and not (replies and replies[-1].rstrip().endswith("?")):
        problems.append("the last reply is not a question")
    if card is not None:
        # Written in the person's terms (review item 11), never about "the user".
        for f in ("title", "summary"):
            if str(card.get(f, "")).lower().startswith(("the user", "user ")):
                problems.append(f"{f} starts {card[f][:20]!r}")
        want = case.get("card") or {}
        priority = case.get("priority") or PRIORITY_OF.get(str(want.get("impact", "")).lower())
        if priority and card.get("priority") != priority:
            problems.append(f"priority {card.get('priority')!r}, not {priority}")
        if want.get("project") and card.get("project") != want["project"]:
            problems.append(f"project {card.get('project')!r}, not {want['project']}")
        if case.get("gaps") and not card.get("gaps"):
            problems.append("the card shows no open gaps")
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


def load(which: str) -> list[dict[str, Any]]:
    paths = [SETS[which]] if which in SETS else [p for p in SETS.values() if p.exists()]
    return [c for p in paths for c in yaml.safe_load(p.read_text(encoding="utf-8"))["cases"]]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--set", choices=["all", *SETS], default="all", help="which case file to run")
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

    command.upgrade(Config(str(HERE.parent / "alembic.ini")), "head")
    asyncio.run(seed())

    cases = load(args.set)
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
