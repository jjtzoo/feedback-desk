"""Sprint 1: schema, seed, health, Google sign-in rules and roles (S1-2, S1-3)."""

import asyncio

import httpx
import pytest
from sqlalchemy import func, select, text

from app.config import get_settings
from app.db import session_scope
from app.errors import Forbidden
from app.models import DigitalStaff, Project, RoutingRule
from app.seed import seed_all
from app.services import auth
from app.services import feedback as feedback_service
from app.services.actors import User
from tests.conftest import MARC, STAFF, signed_in

TABLES = {
    "projects",
    "model_usage",
    "digital_staff",
    "routing_rules",
    "feedback",
    "feedback_followers",
    "feedback_messages",
    "attachments",
    "feedback_events",
    "feedback_embeddings",
    "notifications",
    "notification_mutes",
    "project_messages",
    "releases",
    "release_items",
    "user_sessions",
    "user_preferences",
    "job_runs",
}


async def test_health(anon: httpx.AsyncClient) -> None:
    body = (await anon.get("/api/health")).json()
    assert body["database"] == "ok" and body["migration"] == "0002"
    assert body["model"]["provider"] == "stub" and body["environment"] == "test"


async def test_migration_creates_every_table() -> None:
    async with session_scope() as db:
        rows = await db.scalars(text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'app'"))
        assert set(rows) >= TABLES


async def test_seed_is_idempotent_and_matches_the_brief() -> None:
    async with session_scope() as db:
        assert await seed_all(db) == (0, 0, 0)
    async with session_scope() as db:
        assert await db.scalar(select(func.count()).select_from(Project)) == 15
        assert await db.scalar(select(func.count()).select_from(DigitalStaff)) == 5
        assert await db.scalar(select(func.count()).select_from(RoutingRule)) == 1
        rake = await db.scalar(select(Project).where(Project.slug == "rake-agent"))
        owner = await db.get(DigitalStaff, rake.owner_id)  # type: ignore[union-attr]
        assert owner is not None and owner.name == "Darlene"


async def test_references_never_clash_under_concurrent_saves() -> None:
    user = User(STAFF, "Sam Lee", "staff")

    async def save_one(i: int) -> str:
        async with session_scope() as db:
            sub = feedback_service.Submission(
                user=user,
                draft={"project_slug": "general", "summary": f"thing {i}", "title": f"thing {i}"},
                context={},
                channel="fallback",
            )
            return (await feedback_service.submit(db, sub)).feedback.ref_no

    refs = await asyncio.gather(*(save_one(i) for i in range(8)))
    assert len(set(refs)) == 8 and all(r.startswith("FB-") for r in refs)


# --- sign-in ------------------------------------------------------------------------------


async def test_everything_needs_sign_in(anon: httpx.AsyncClient) -> None:
    for path in ("/api/me", "/api/projects", "/api/my/feedback", "/api/console/board", "/api/notifications"):
        r = await anon.get(path)
        assert r.status_code == 401, path
        assert r.json()["error"]["code"] == "signed_out"


async def test_staff_and_digital_see_different_areas() -> None:
    staff = await signed_in(STAFF)
    marc = await signed_in(MARC)
    assert (await staff.get("/api/me")).json()["role"] == "staff"
    assert (await marc.get("/api/me")).json()["role"] == "admin"
    assert (await staff.get("/api/console/board")).status_code == 403
    assert (await marc.get("/api/console/board")).status_code == 200
    assert (await staff.get("/api/admin/projects")).status_code == 403
    await staff.aclose()
    await marc.aclose()


async def test_non_redadair_accounts_are_refused(anon: httpx.AsyncClient) -> None:
    r = await anon.post("/api/auth/dev/sign-in", json={"email": "someone@gmail.com"})
    assert r.status_code == 403
    with pytest.raises(Forbidden):
        auth.identity_from_claims({"email": "a@gmail.com", "email_verified": True, "hd": ""})
    with pytest.raises(Forbidden):
        auth.identity_from_claims({"email": "a@redadair.com.au", "email_verified": True, "hd": "gmail.com"})
    with pytest.raises(Forbidden):
        auth.identity_from_claims({"email": "a@redadair.com.au", "email_verified": False, "hd": "redadair.com.au"})
    assert (
        auth.identity_from_claims(
            {"email": "A@redadair.com.au", "email_verified": True, "hd": "redadair.com.au", "name": "A"}
        )[0]
        == "a@redadair.com.au"
    )


async def test_domain_is_rechecked_on_every_request(monkeypatch: pytest.MonkeyPatch) -> None:
    client = await signed_in(STAFF)
    assert (await client.get("/api/me")).status_code == 200
    monkeypatch.setenv("ALLOWED_DOMAINS", "redadair.com.au")  # the .example domain is no longer allowed
    get_settings.cache_clear()
    assert (await client.get("/api/me")).status_code == 401
    await client.aclose()


async def test_dev_sign_in_is_refused_outside_local(monkeypatch: pytest.MonkeyPatch, anon: httpx.AsyncClient) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    get_settings.cache_clear()
    assert (await anon.post("/api/auth/dev/sign-in", json={"email": STAFF})).status_code == 403
    assert (await anon.get("/api/auth/dev/users")).json() == []


async def test_sign_out_revokes_the_session() -> None:
    client = await signed_in(STAFF)
    cookie = client.cookies.get("fb_session")
    assert (await client.post("/api/auth/signout")).status_code == 204
    client.cookies.clear()
    client.cookies.set("fb_session", cookie or "")
    assert (await client.get("/api/me")).status_code == 401
    await client.aclose()


async def test_google_start_needs_the_oauth_client(anon: httpx.AsyncClient) -> None:
    r = await anon.get("/api/auth/google/start", follow_redirects=False)
    assert r.status_code == 503 and r.json()["error"]["code"] == "oauth_not_configured"


# --- admin page (S1-4) ----------------------------------------------------------------------


async def test_admin_adds_a_project_the_agent_sees_at_once(marc: httpx.AsyncClient) -> None:
    r = await marc.post(
        "/api/admin/projects",
        json={
            "slug": "leave-planner",
            "name": "Leave Planner",
            "project_group": "platforms",
            "keywords": ["Leave", "roster"],
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["keywords"] == ["leave", "roster"]
    from agent.tools import list_projects

    slugs = {p["slug"] for p in (await list_projects())["projects"]}
    assert "leave-planner" in slugs


async def test_admin_page_is_admins_only(darlene: httpx.AsyncClient) -> None:
    r = await darlene.post("/api/admin/projects", json={"slug": "x-tool", "name": "X", "project_group": "other"})
    assert r.status_code == 403
    assert (await darlene.get("/api/admin/projects")).status_code == 200  # Digital Staff can read
