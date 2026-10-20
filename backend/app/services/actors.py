"""Who is acting: the signed-in user, the agent, or the system."""

import uuid
from dataclasses import dataclass
from typing import Literal

Role = Literal["staff", "digital", "admin"]


@dataclass(frozen=True)
class User:
    """A signed-in person. The role comes from digital_staff; everyone else is Staff (D1)."""

    email: str
    name: str
    role: Role
    staff_id: uuid.UUID | None = None
    is_triage_lead: bool = False

    @property
    def is_digital(self) -> bool:
        return self.role in ("digital", "admin")

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    @property
    def actor(self) -> "Actor":
        return Actor(self.role, self.email, self.name)


@dataclass(frozen=True)
class Actor:
    kind: str  # system | agent | staff | digital | admin
    email: str | None
    name: str | None


SYSTEM = Actor("system", None, "Feedback")
AGENT = Actor("agent", None, "Feedback agent")
