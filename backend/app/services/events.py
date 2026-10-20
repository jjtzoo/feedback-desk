"""The append-only feedback_events log: audit trail, routing training signal and the source
of the staff tracker's history (public events only)."""

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FeedbackEvent
from app.services.actors import Actor


def log(
    db: AsyncSession,
    feedback_id: uuid.UUID,
    actor: Actor,
    event_type: str,
    *,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    public_text: str | None = None,
) -> FeedbackEvent:
    """Record one event. public_text set means it shows on the staff tracker."""
    event = FeedbackEvent(
        feedback_id=feedback_id,
        actor_type=actor.kind,
        actor_email=actor.email,
        actor_name=actor.name,
        event_type=event_type,
        before=before or {},
        after=after or {},
        is_public=public_text is not None,
        public_text=public_text,
    )
    db.add(event)
    return event
