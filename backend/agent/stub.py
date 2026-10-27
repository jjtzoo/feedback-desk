"""A scripted stand-in for Gemini (D8, D23), used until the AI Studio key arrives and in tests.

It is a real ADK BaseLlm: it reads the conversation, calls the same tools a real model would
(list_projects, update_draft, find_duplicates, submit_feedback) and goes through the same
guards. Classification is simple keyword matching, deliberately; the routing test set is
scored against Gemini, not this.
"""

import re
from collections.abc import AsyncGenerator
from datetime import date
from typing import Any

from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from app.services.drafts import first_sentence

ASK_PROJECT = "Which tool is this about?"
ASK_IMPACT = "How much is this affecting your work?"
ASK_EXPECTED = "What did you expect to happen, and what happened instead?"
SHOW_SUMMARY = "Here's what I'll send. Check it and press Confirm, or tell me what to change."
PRESS_CONFIRM = "Press Confirm on the summary to send it, or tell me what to change."
CHECK_SEND = "Want me to send that to the team?"
ABOUT_SIG = (
    "I'm Sig. I pass what you tell me about our intranet tools to the Digital team; RAKE answers policy questions.\n"
    "Anything you'd like to tell the team about?"
)
NOT_SENT = "No worries, I won't send it. Anything else you'd like to tell the team about?"
NOISE = (
    "I'm here for feedback on our intranet tools: something broken, slow or confusing, an idea, "
    "an access request, a question or a bit of praise. What's on your mind?"
)
EXISTING = (
    "Sounds like that one's already in. I can't look up or change existing items from here, but you "
    "can follow it up yourself: open My feedback, pick the item and use Reply or add details. "
    "If it's a new problem, tell me about it and I'll start a fresh report."
)
OFF_TOPIC = (
    "That one's outside what I can help with. For policy questions, RAKE is your best bet. "
    "Got feedback on one of our tools?"
)

CATEGORY_WORDS: list[tuple[str, tuple[str, ...]]] = [
    (
        "praise",
        (
            "love ",
            "loving",
            "great job",
            "thank you",
            "thanks for",
            "awesome",
            "brilliant",
            "well done",
            "works great",
            "really good",
        ),
    ),
    (
        "access_request",
        (
            "access to",
            "need access",
            "permission",
            "need a login",
            "need an account",
            "add me to",
            "give me access",
            "can't get into",
            "role",
        ),
    ),
    ("question", ("how do i", "how can i", "where do i", "where can i", "is there a way", "how to ")),
    ("performance", ("slow", "takes ages", "takes forever", "timeout", "timed out", "loading forever", "laggy", "lag")),
    (
        "data_issue",
        (
            "wrong data",
            "incorrect",
            "wrong ",
            "missing record",
            "duplicate record",
            "out of date",
            "doesn't match",
            "data is",
        ),
    ),
    (
        "feature_request",
        (
            "would be nice",
            "could you add",
            "can you add",
            "please add",
            "feature",
            "wish",
            "it would help",
            "can we have",
            "would love",
            "add an option",
            "add a ",
        ),
    ),
    ("usability", ("confusing", "hard to find", "can't find", "unclear", "clunky", "too many clicks", "hard to use")),
    (
        "bug",
        (
            "error",
            "broken",
            "crash",
            "doesn't work",
            "does not work",
            "not working",
            "bug",
            "fails",
            "failed",
            "blank",
            "stuck",
            "won't",
            "loops",
            "500",
            "404",
            "can't log in",
            "cannot log in",
        ),
    ),
]
BLOCKING = (
    "blocking",
    "blocked",
    "can't work",
    "cannot work",
    "can't do my job",
    "urgent",
    "asap",
    "can't log in",
    "cannot log in",
    "stopped",
    "nobody can",
    "no one can",
)
# Words that already say how much it hurts (review item 16): "slow" is slowing them down, so no impact question.
ANNOYING = (
    "slow",
    "takes ages",
    "takes forever",
    "laggy",
    "annoying",
    "frustrating",
    "painful",
    "major",
)
MINOR = ("minor", "typo", "cosmetic", "small thing", "a bit", "save me time")
NICE = ("nice to have", "nice-to-have", "idea", "would be nice", "someday")
# Questions about Sig itself are chat, never a report (review item 18).
ABOUT_SIG_WORDS = (
    "your role",
    "who are you",
    "what are you",
    "are you a bot",
    "are you a robot",
    "are you real",
    "are you human",
    "who made you",
    "who built you",
    "why do we need you",
    "what do you do",
    "what is smoke signal",
    "what's smoke signal",
)
DECLINE_RE = re.compile(r"^(no|nah|nope|not now|don't|dont)\b")
CONFIRM_WORDS = ("yes", "yep", "yeah", "correct", "looks good", "that's right", "send it", "submit", "ok", "okay")
EXPECT_RE = re.compile(
    r"expect(?:ed|ing)?\s+(?:it\s+)?(?:to\s+)?(?P<exp>.+?)"
    r"(?:(?:\s*,?\s*(?:but|and instead|instead)\s+|\s*,\s*)(?P<act>.+))?$",
    re.I | re.S,
)


class StubLlm(BaseLlm):
    model: str = "stub"

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        yield _respond(llm_request.contents or [])


# --- turn logic -------------------------------------------------------------------------


def _respond(contents: list[types.Content]) -> LlmResponse:
    last = contents[-1] if contents else None
    responses = [p.function_response for p in (last.parts or []) if p.function_response] if last else []
    if responses:
        r = responses[-1]
        data: dict[str, Any] = dict(r.response or {})
        if r.name == "list_projects":
            return _describe(contents, data.get("projects", []))
        if r.name == "update_draft":
            return _next_step(contents, data)
        if r.name == "find_duplicates":
            return _after_duplicates(data.get("candidates", []))
        if r.name == "submit_feedback":
            if data.get("reference"):
                who = data.get("assigned_to") or "the Digital team"
                where = (
                    f", who looks after {data['project']}" if data.get("project") and who != "the Digital team" else ""
                )
                return _say(
                    f"Done. Your reference is {data['reference']} and it's with {who}{where}. "
                    "You'll see updates on your tracker and by email."
                )
            if data.get("error") == "not_confirmed":
                return _say(PRESS_CONFIRM)
            return _say("Sorry, I couldn't save that. Please try the form below.")
        return _say("Sorry, something went wrong.")

    text = _last_user_text(contents)
    if text.strip() == "Confirmed":
        return _call("submit_feedback", {})
    projects = _latest_response(contents, "list_projects")
    if projects is None:
        return _call("list_projects", {})
    return _describe(contents, projects.get("projects", []))


def _describe(contents: list[types.Content], projects: list[dict[str, Any]]) -> LlmResponse:
    """Handle the user's latest message, given what the agent last asked."""
    text = _last_user_text(contents)
    low = text.lower().strip()
    asked = _last_model_text(contents)
    draft = (_latest_response(contents, "update_draft") or {}).get("draft", {})

    if asked.startswith(ASK_PROJECT):
        slug = _match_project(low, projects)
        return _call("update_draft", {"project_slug": slug or "general", "project_confidence": 0.95 if slug else 0.3})
    if asked.startswith(ASK_IMPACT):
        # "I already said it's slow": take what they said earlier instead of asking again.
        priority = _priority(low) or _priority(_all_user_text(contents).lower()) or "P3"
        return _call("update_draft", {"priority": priority, "priority_confidence": 0.9})
    if asked.startswith(ASK_EXPECTED):
        exp, act = _expected_actual(text)
        return _call("update_draft", {"expected": exp or text.strip(), "actual": act})
    if asked.startswith(CHECK_SEND):
        if DECLINE_RE.search(low):
            return _say(NOT_SENT)
        return _call("update_draft", {"next_step": "show_card"})
    if asked.startswith((SHOW_SUMMARY, PRESS_CONFIRM)) or "Here's what I'll send" in asked:
        if any(low == w or low.startswith(w + " ") for w in CONFIRM_WORDS) or "submit" in low:
            return _say(PRESS_CONFIRM)
        if DECLINE_RE.search(low) or "never mind" in low:
            return _call("update_draft", {"next_step": "chat"})
        return _call("update_draft", _correction(text, projects, draft))

    # A new description, unless it is about Sig or an item that already exists.
    if any(w in low for w in ABOUT_SIG_WORDS):
        return _say(ABOUT_SIG)
    if _about_existing(low):
        return _say(EXISTING)
    category = _category(low)
    slug = _match_project(low, projects)
    if slug and not category and len(low.split()) <= 3:
        # A tool's name on its own reports nothing yet (review item 20): ask, don't start a draft.
        name = next(p["name"] for p in projects if p["slug"] == slug)
        return _say(f"What's happening with {name}?")
    if not category and not slug:
        if len(low.split()) < 4 or _is_noise(low):
            return _say(NOISE)
        if any(w in low for w in ("policy", "leave entitlement", "weather", "joke", "recipe")):
            return _say(OFF_TOPIC)
    return _call("update_draft", _classify(text, category or "bug", slug))


REFERENCE_RE = re.compile(r"\bfb-?\d{3,6}\b")
EXISTING_WORDS = (
    "already raised",
    "already reported",
    "already logged",
    "already submitted",
    "my ticket",
    "my report",
    "existing report",
    "existing ticket",
    "existing feedback",
    "follow up on",
    "update on my",
    "status of",
)


def _about_existing(low: str) -> bool:
    """A follow-up on feedback that already exists: an FB reference, or words like "my ticket"."""
    return bool(REFERENCE_RE.search(low)) or any(w in low for w in EXISTING_WORDS)


def _next_step(contents: list[types.Content], data: dict[str, Any]) -> LlmResponse:
    """Pick the next message, and signal its step through update_draft first, as Gemini does."""
    if data.get("errors"):
        return _say("Sorry, I couldn't use that: " + " ".join(data["errors"]))
    draft: dict[str, Any] = data.get("draft", {})
    if data.get("next_step") == "chat":
        return _say(NOT_SENT)
    step, line = None, SHOW_SUMMARY
    if _questions_asked(contents) < 3:
        brief = draft.get("brief", {})
        if not draft.get("project_slug"):
            step, line = "ask_tool", ASK_PROJECT
        elif not draft.get("priority"):
            step, line = "ask_impact", ASK_IMPACT
        elif (
            draft.get("category") == "bug"
            and not brief.get("expected")
            and ASK_EXPECTED not in _all_model_text(contents)
        ):
            step, line = "ask_details", ASK_EXPECTED
    if step is None:
        if not draft.get("project_slug"):
            return _call("update_draft", {"project_slug": "general", "project_confidence": 0.3})
        if not draft.get("priority"):
            return _call("update_draft", {"priority": "P3", "priority_confidence": 0.4})
        # A question or praise is checked once before the card (review item 18).
        asks_first = draft.get("category") in ("question", "praise")
        step, line = (
            ("check_send", CHECK_SEND)
            if asks_first and CHECK_SEND not in _all_model_text(contents)
            else ("show_card", SHOW_SUMMARY)
        )
    if data.get("next_step") != step:
        return _call("update_draft", {"next_step": step})
    no_search_yet = _latest_response(contents, "find_duplicates") is None
    if step == "show_card" and no_search_yet and draft.get("project_slug") != "general":
        return _call("find_duplicates", {})
    return _say(line)


def _after_duplicates(candidates: list[dict[str, Any]]) -> LlmResponse:
    fixed = next((c for c in candidates if c.get("fixed_on")), None)
    if fixed:
        when = date.fromisoformat(fixed["fixed_on"]).strftime("%d %b").lstrip("0")
        return _say(f"This was fixed on {when} ({fixed['reference']}), so I'll note it may be back.\n\n{SHOW_SUMMARY}")
    if candidates:
        c = candidates[0]
        return _say(
            f"Looks like someone may have raised this already: {c['reference']}, {c['title']}. "
            f"You can add your comment to that one instead.\n\n{SHOW_SUMMARY}"
        )
    return _say(SHOW_SUMMARY)


# --- classification ---------------------------------------------------------------------


def _classify(text: str, category: str, slug: str | None) -> dict[str, Any]:
    low = text.lower()
    work_type = _work_type(category, low)
    priority = _priority(low) or {
        "feature_request": "P4",
        "access_request": "P2",
        "question": "P3",
        "praise": "P4",
        "usability": "P3",
    }.get(category)
    summary = first_sentence(text, 200)
    title = first_sentence(text, 80)
    exp, act = _expected_actual(text)
    gaps: list[str] = []
    upd: dict[str, Any] = {
        "category": category,
        "category_confidence": 0.8,
        "work_type": work_type,
        "work_type_confidence": 0.75,
        "summary": summary,
        "title": title,
        "problem": summary,
        "submitter_quote": first_sentence(text, 200),
        "sentiment": "positive"
        if category == "praise"
        else "negative"
        if category in ("bug", "performance", "data_issue")
        else "neutral",
        "impact": "company"
        if any(w in low for w in ("everyone", "all staff", "whole company"))
        else "team"
        if any(w in low for w in ("whole team", "our team", "the team"))
        else "one_person",
        "effort": {"fix": "S", "improvement": "M", "new_feature": "L"}.get(work_type),
        "recommendation": "implement" if work_type in ("fix", "improvement", "new_feature") else "needs_info",
        "recommendation_reason": "Raised by staff; see the brief."
        if work_type != "no_change"
        else "No build work; reply or acknowledge.",
    }
    if slug:
        upd["project_slug"] = slug
        upd["project_confidence"] = 0.9
    if priority:
        upd["priority"] = priority
        upd["priority_confidence"] = 0.8
    if category in ("bug", "performance", "data_issue"):
        if exp:
            upd["expected"], upd["actual"] = exp, act
        gaps.append("Steps to reproduce")
    if category in ("feature_request", "usability"):
        upd["asking_for"] = text.strip()[:500]
        gaps.append("How often this comes up and how many people need it")
    if gaps:
        upd["open_gaps"] = gaps
    return upd


def _correction(text: str, projects: list[dict[str, Any]], draft: dict[str, Any]) -> dict[str, Any]:
    low = text.lower()
    upd: dict[str, Any] = {}
    p = re.search(r"\bp([1-4])\b", low)
    if p:
        upd["priority"] = f"P{p.group(1)}"
    elif _priority(low):
        upd["priority"] = _priority(low)
    slug = _match_project(low, projects)
    if slug and slug != draft.get("project_slug"):
        upd["project_slug"], upd["project_confidence"] = slug, 0.95
    category = _category(low)
    if category and category != draft.get("category"):
        upd["category"], upd["work_type"] = category, _work_type(category, low)
    if not upd:
        brief = draft.get("brief", {})
        upd["problem"] = f"{brief.get('problem', draft.get('summary', ''))} {text.strip()}".strip()[:2000]
        # Something added at the card answers its first open gap (D63).
        if brief.get("open_gaps"):
            upd["open_gaps"] = brief["open_gaps"][1:]
    return upd


def _category(low: str) -> str | None:
    for category, words in CATEGORY_WORDS:
        if any(w in low for w in words):
            return category
    return None


def _work_type(category: str, low: str) -> str:
    if category in ("bug", "performance", "data_issue"):
        return "fix"
    if category == "usability":
        return "improvement"
    if category == "feature_request":
        return (
            "improvement" if any(w in low for w in ("better", "also", "more ", "faster", "easier")) else "new_feature"
        )
    return "no_change"


def _priority(low: str) -> str | None:
    if any(w in low for w in BLOCKING):
        return "P1"
    if any(w in low for w in ANNOYING):
        return "P2"
    if any(w in low for w in MINOR):
        return "P3"
    if any(w in low for w in NICE):
        return "P4"
    return None


def _match_project(low: str, projects: list[dict[str, Any]]) -> str | None:
    # A name or alias beats a keyword; within each, the longest match wins.
    best: tuple[int, str] | None = None
    for p in projects:
        names = [p["name"], p["slug"].replace("-", " "), *p.get("aliases", [])]
        for weight, words in ((1000, names), (0, p.get("keywords", []))):
            for word in words:
                word = str(word).lower().strip()
                found = word and re.search(r"(?<!\w)" + re.escape(word) + r"(?!\w)", low)
                if found and (best is None or weight + len(word) > best[0]):
                    best = (weight + len(word), p["slug"])
    return best[1] if best else None


def _expected_actual(text: str) -> tuple[str | None, str | None]:
    m = EXPECT_RE.search(text)
    if not m:
        return None, None
    return m.group("exp").strip(" .") or None, (m.group("act") or "").strip(" .") or None


def _is_noise(low: str) -> bool:
    letters = sum(c.isalpha() for c in low)
    return letters < 3 or low in ("test", "testing", "hi", "hello", "hey", "g'day") or "http" in low


# --- conversation helpers ------------------------------------------------------------------


def _say(text: str) -> LlmResponse:
    return LlmResponse(content=types.Content(role="model", parts=[types.Part(text=text)]))


def _call(name: str, args: dict[str, Any]) -> LlmResponse:
    return LlmResponse(
        content=types.Content(role="model", parts=[types.Part(function_call=types.FunctionCall(name=name, args=args))])
    )


def _last_user_text(contents: list[types.Content]) -> str:
    for c in reversed(contents):
        if c.role == "user":
            for p in c.parts or []:
                if p.text:
                    return p.text
    return ""


def _last_model_text(contents: list[types.Content]) -> str:
    """The agent's last message before the latest user message."""
    seen_user = False
    for c in reversed(contents):
        if c.role == "user" and any(p.text for p in c.parts or []):
            if seen_user:
                return ""
            seen_user = True
            continue
        if seen_user and c.role == "model":
            for p in c.parts or []:
                if p.text:
                    return p.text
    return ""


def _all_user_text(contents: list[types.Content]) -> str:
    return "\n".join(p.text or "" for c in contents if c.role == "user" for p in c.parts or [] if p.text)


def _all_model_text(contents: list[types.Content]) -> str:
    return "\n".join(p.text or "" for c in contents if c.role == "model" for p in c.parts or [] if p.text)


def _questions_asked(contents: list[types.Content]) -> int:
    questions = (ASK_PROJECT, ASK_IMPACT, ASK_EXPECTED)
    return sum(
        1 for c in contents if c.role == "model" for p in c.parts or [] if p.text and p.text.startswith(questions)
    )


def _latest_response(contents: list[types.Content], name: str) -> dict[str, Any] | None:
    for c in reversed(contents):
        for p in c.parts or []:
            if p.function_response and p.function_response.name == name:
                return dict(p.function_response.response or {})
    return None
