"""Model usage tracking and spend guards (D36)."""

import httpx
import pytest

from app.config import get_settings
from app.services import usage
from tests.conftest import MARC, STAFF, first, say, start_chat, texts


async def spend(email: str | None, input_tokens: int, output_tokens: int = 0) -> None:
    await usage.record(
        kind="chat", model="gemini-2.5-flash", input_tokens=input_tokens, output_tokens=output_tokens, user_email=email
    )


def limits(monkeypatch: pytest.MonkeyPatch, **values: str) -> None:
    for key, value in values.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()


async def test_allowance_reports_the_users_tokens_today(
    staff: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    limits(monkeypatch, DAILY_TOKENS_PER_USER="1000")
    await spend(STAFF, 200, 50)
    await spend(MARC, 900)  # someone else's use doesn't count against Sam
    r = await staff.get("/api/usage/me")
    assert r.json() == {"used_tokens": 250, "limit_tokens": 1000, "percent": 25, "blocked": None}


async def test_user_limit_sends_new_chats_to_the_backup_form(
    staff: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    limits(monkeypatch, DAILY_TOKENS_PER_USER="1000")
    await spend(STAFF, 1000)
    r = await staff.post("/api/chat/sessions", json={"project_slug": None, "context": {}})
    assert r.json()["mode"] == "fallback" and r.json()["limit"] == "user"


async def test_a_chat_in_progress_always_finishes(staff: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    limits(monkeypatch, DAILY_TOKENS_PER_USER="1000", DAILY_BUDGET_AUD="0.0001")
    sid = await start_chat(staff)
    await spend(STAFF, 5000)  # over both limits after the chat started
    events = await say(staff, sid, "RAKE is broken")
    assert first(events, "fallback") is None and texts(events)


async def test_daily_budget_stops_everyone(staff: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    limits(
        monkeypatch, DAILY_BUDGET_AUD="0.01", MODEL_PRICE_INPUT_AUD_PER_M="0.45", MODEL_PRICE_OUTPUT_AUD_PER_M="3.80"
    )
    await spend(MARC, 10_000, 2_000)  # AUD 0.0121
    r = await staff.post("/api/chat/sessions", json={"project_slug": None, "context": {}})
    assert r.json()["limit"] == "budget"


async def test_zero_turns_a_limit_off(staff: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    limits(monkeypatch, DAILY_TOKENS_PER_USER="0", DAILY_BUDGET_AUD="0", MONTHLY_BUDGET_AUD="0")
    await spend(STAFF, 10_000_000)
    sid = await start_chat(staff)
    assert first(await say(staff, sid, "RAKE is broken"), "fallback") is None


async def test_console_usage_is_for_the_digital_team_and_people_for_admins(
    staff: httpx.AsyncClient, darlene: httpx.AsyncClient, marc: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    limits(monkeypatch, MODEL_PRICE_INPUT_AUD_PER_M="0.45", MODEL_PRICE_OUTPUT_AUD_PER_M="3.80")
    await spend(STAFF, 1_000_000, 100_000)
    await usage.record(kind="embedding", model="gemini-embedding-001", input_tokens=400, estimated=True)

    assert (await staff.get("/api/console/usage")).status_code == 403

    digital = (await darlene.get("/api/console/usage")).json()
    assert digital["people"] == []
    assert digital["today"]["calls"] == 2 and digital["today"]["tokens"] == 1_100_400
    assert digital["today"]["cost_aud"] == pytest.approx(0.45 + 0.38 + 0.0001, abs=1e-4)
    assert len(digital["history"]) == 14 and digital["history"][-1]["tokens"] == 1_100_400

    people = (await marc.get("/api/console/usage")).json()["people"]
    assert people == [{"email": STAFF, "name": "sam.lee", "tokens": 1_100_000, "cost_aud": 0.83, "limit_reached": True}]
