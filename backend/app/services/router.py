"""Who gets each item: plain code, in the brief's order (§5.3). The model proposes a project
and category; this module decides the person (D2) and never asks the model.

1. Confidence gate: project unknown or confidence under the gate goes to Needs review.
2. Rule overrides, by priority_order. Several rules matching at the same order form a group.
3. The project's primary owner.
4. An away owner or rule assignee sends the item to Needs review.
5. Within a group, the member with the fewest open items (tie-breaker only).
6. P1 also notifies the Admins at once (done by the caller).
7. Praise goes to the owner as FYI and is Acknowledged; no approval.
"""

from dataclasses import dataclass

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import DigitalStaff, Feedback, Project, RoutingRule
from app.services.catalog import open_counts


@dataclass
class Routing:
    assignee: DigitalStaff | None
    status: str  # awaiting_approval | needs_review | acknowledged
    reason: str


def _available(staff: DigitalStaff | None) -> bool:
    return staff is not None and staff.active and not staff.is_away


async def route(db: AsyncSession, fb: Feedback, project: Project | None, project_confidence: float) -> Routing:
    if fb.flagged:
        return Routing(None, "needs_review", "flagged for the Admins")

    owner = await db.get(DigitalStaff, project.owner_id) if project and project.owner_id else None
    if fb.category == "praise":
        return Routing(owner if _available(owner) else None, "acknowledged", "praise is acknowledged")

    if project is None or project_confidence < get_settings().project_confidence_gate:
        return Routing(None, "needs_review", "project unclear")

    rules = list(
        await db.scalars(
            select(RoutingRule)
            .where(
                RoutingRule.active.is_(True),
                or_(RoutingRule.project_id.is_(None), RoutingRule.project_id == project.id),
                or_(RoutingRule.category.is_(None), RoutingRule.category == fb.category),
            )
            .order_by(RoutingRule.priority_order)
        )
    )
    if rules:
        top = rules[0].priority_order
        group = [await db.get(DigitalStaff, r.assignee_id) for r in rules if r.priority_order == top]
        available = [s for s in group if _available(s)]
        if not available:
            return Routing(None, "needs_review", "rule assignee away")
        if len(available) > 1:
            counts = await open_counts(db)
            available.sort(key=lambda s: (counts.get(s.id, 0), s.name))  # type: ignore[union-attr]
        return Routing(available[0], "awaiting_approval", "routing rule")

    if owner is None:
        return Routing(None, "needs_review", "project has no owner")
    if not _available(owner):
        return Routing(None, "needs_review", "owner away")
    return Routing(owner, "awaiting_approval", "project owner")
