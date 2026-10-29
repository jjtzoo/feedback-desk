"""Model usage: tokens and estimated cost per model call, and the spend guards (D36).

Chat turns record the token counts Gemini reports. Embedding calls report none, so their tokens
are estimated from the text length and flagged `estimated`. No message text is stored here.
"""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from agent.callbacks import cost_aud as chat_cost_aud
from app.config import get_settings
from app.db import session_scope
from app.errors import Forbidden
from app.models import DigitalStaff, Feedback, ModelUsage
from app.services.actors import User

log = logging.getLogger(__name__)

Limit = Literal["user", "budget"]


def estimate_tokens(text: str) -> int:
    """About four characters per token for English text."""
    return max(1, len(text) // 4)


def embedding_cost_aud(tokens: int) -> float:
    return round(tokens / 1e6 * get_settings().embedding_price_aud_per_m, 5)


async def record(
    *,
    kind: Literal["chat", "embedding"],
    model: str,
    input_tokens: int,
    output_tokens: int = 0,
    calls: int = 1,
    user_email: str | None = None,
    session_id: str | None = None,
    estimated: bool = False,
) -> None:
    """Write one usage row in its own transaction. A failure is logged, never raised: tracking
    must not break a chat."""
    if kind == "chat":
        cost = chat_cost_aud({"input_tokens": input_tokens, "output_tokens": output_tokens})
    else:
        cost = embedding_cost_aud(input_tokens + output_tokens)
    try:
        async with session_scope() as db:
            db.add(
                ModelUsage(
                    user_email=user_email,
                    session_id=session_id,
                    kind=kind,
                    model=model,
                    calls=calls,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    estimated=estimated,
                    cost_aud=cost,
                )
            )
    except Exception:
        log.exception("could not record model usage kind=%s session=%s", kind, session_id)


def period_starts(now: datetime | None = None) -> tuple[datetime, datetime]:
    """Start of today and of this month in the app's time zone, as UTC."""
    local = (now or datetime.now(UTC)).astimezone(ZoneInfo(get_settings().timezone))
    day = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return day.astimezone(UTC), day.replace(day=1).astimezone(UTC)


async def _cost_since(db: AsyncSession, start: datetime) -> float:
    query = select(func.coalesce(func.sum(ModelUsage.cost_aud), 0)).where(ModelUsage.created_at >= start)
    total = await db.scalar(query)
    return float(total or 0)


async def _user_tokens_since(db: AsyncSession, email: str, start: datetime) -> int:
    total = await db.scalar(
        select(func.coalesce(func.sum(ModelUsage.input_tokens + ModelUsage.output_tokens), 0)).where(
            ModelUsage.user_email == email, ModelUsage.kind == "chat", ModelUsage.created_at >= start
        )
    )
    return int(total or 0)


@dataclass
class Allowance:
    used_tokens: int
    limit_tokens: int
    blocked: Limit | None

    @property
    def percent(self) -> int:
        return min(100, round(self.used_tokens / self.limit_tokens * 100)) if self.limit_tokens else 0


async def over_budget(db: AsyncSession) -> bool:
    """Today's or this month's model spend has reached its budget (D36)."""
    s = get_settings()
    day, month = period_starts()
    return bool(
        (s.daily_budget_aud and await _cost_since(db, day) >= s.daily_budget_aud)
        or (s.monthly_budget_aud and await _cost_since(db, month) >= s.monthly_budget_aud)
    )


async def allowance(db: AsyncSession, email: str) -> Allowance:
    """The user's chat tokens today, and whether a limit now sends them to the backup form."""
    s = get_settings()
    day, _ = period_starts()
    used = await _user_tokens_since(db, email, day)
    blocked: Limit | None = None
    if await over_budget(db):
        blocked = "budget"
    elif s.daily_tokens_per_user and used >= s.daily_tokens_per_user:
        blocked = "user"
    return Allowance(used_tokens=used, limit_tokens=s.daily_tokens_per_user, blocked=blocked)


async def summary(db: AsyncSession, user: User, days: int = 14) -> dict[str, Any]:
    """The console's AI usage panel. Per-person rows are for Admins only."""
    # Checked here as well as in the route; not via services.console, which imports embeddings -> usage.
    if not user.is_digital:
        raise Forbidden("The console is for the Digital team.")
    s = get_settings()
    day, month = period_starts()
    zone = ZoneInfo(s.timezone)

    async def totals(start: datetime, end: datetime | None = None) -> dict[str, Any]:
        query = select(
            func.coalesce(func.sum(ModelUsage.calls), 0),
            func.coalesce(func.sum(ModelUsage.input_tokens + ModelUsage.output_tokens), 0),
            func.coalesce(func.sum(ModelUsage.cost_aud), 0),
        ).where(ModelUsage.created_at >= start)
        if end is not None:
            query = query.where(ModelUsage.created_at < end)
        calls, tokens, cost = (await db.execute(query)).one()
        return {"calls": int(calls), "tokens": int(tokens), "cost_aud": round(float(cost), 4)}

    history = []
    for i in range(days - 1, -1, -1):
        start = day - timedelta(days=i)
        row = await totals(start, start + timedelta(days=1))
        history.append({"day": start.astimezone(zone).date().isoformat(), **row})

    since = day - timedelta(days=29)
    chat_cost = float(
        await db.scalar(
            select(func.coalesce(func.sum(ModelUsage.cost_aud), 0)).where(
                ModelUsage.kind == "chat", ModelUsage.created_at >= since
            )
        )
        or 0
    )
    chat_items = int(
        await db.scalar(
            select(func.count()).select_from(Feedback).where(Feedback.channel == "chat", Feedback.created_at >= since)
        )
        or 0
    )

    people: list[dict[str, Any]] = []
    if user.role == "admin":
        rows = await db.execute(
            select(
                ModelUsage.user_email,
                func.sum(ModelUsage.input_tokens + ModelUsage.output_tokens),
                func.sum(ModelUsage.cost_aud),
            )
            .where(ModelUsage.created_at >= day, ModelUsage.user_email.is_not(None))
            .group_by(ModelUsage.user_email)
            .order_by(func.sum(ModelUsage.input_tokens + ModelUsage.output_tokens).desc())
            .limit(10)
        )
        names: dict[str, str] = {d.google_email: d.name for d in await db.scalars(select(DigitalStaff))}
        people = [
            {
                "email": email,
                "name": names.get(email, email.split("@")[0]),
                "tokens": int(tokens),
                "cost_aud": round(float(cost), 4),
                "limit_reached": bool(s.daily_tokens_per_user and tokens >= s.daily_tokens_per_user),
            }
            for email, tokens, cost in rows
            if email is not None
        ]

    return {
        "today": await totals(day),
        "month": await totals(month),
        "daily_budget_aud": s.daily_budget_aud,
        "monthly_budget_aud": s.monthly_budget_aud,
        "daily_tokens_per_user": s.daily_tokens_per_user,
        "avg_cost_per_item_aud": round(chat_cost / chat_items, 4) if chat_items else None,
        "history": history,
        "people": people,
    }
