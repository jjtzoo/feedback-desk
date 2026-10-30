"""Digital Staff workspace: Friday releases and the dashboard (brief §4.4.6, §4.8)."""

import uuid

from fastapi import APIRouter
from fastapi.responses import Response

from app.api.deps import CurrentUser, Db, DigitalUser
from app.schemas import (
    ProjectOut,
    ReleaseItemOut,
    ReleaseItemsIn,
    ReleaseOut,
)
from app.services import releases, reports

router = APIRouter(prefix="/console", tags=["workspace"])


@router.get("/releases", response_model=list[ReleaseOut])
async def list_releases(db: Db, user: DigitalUser) -> list[ReleaseOut]:
    out = []
    for release, project in await releases.list_releases(db, user):
        out.append(
            ReleaseOut(
                id=release.id,
                project=ProjectOut.model_validate(project),
                week_ending=release.week_ending,
                status=release.status,
                published_at=release.published_at,
                can_publish=await releases.can_publish(db, user, release),
            )
        )
    return out


async def _release(db: Db, user: CurrentUser, release_id: uuid.UUID) -> ReleaseOut:
    release, project, items = await releases.get(db, user, release_id)
    counts, _ = await releases.thanks_for(db, [i.id for i in items], user.email)
    return ReleaseOut(
        id=release.id,
        project=ProjectOut.model_validate(project),
        week_ending=release.week_ending,
        status=release.status,
        published_at=release.published_at,
        can_publish=await releases.can_publish(db, user, release),
        items=[ReleaseItemOut.model_validate(i).model_copy(update={"thanks": counts.get(i.id, 0)}) for i in items],
    )


@router.get("/releases/{release_id}", response_model=ReleaseOut)
async def get_release(release_id: uuid.UUID, db: Db, user: DigitalUser) -> ReleaseOut:
    return await _release(db, user, release_id)


@router.put("/releases/{release_id}/items", response_model=ReleaseOut)
async def save_items(release_id: uuid.UUID, body: ReleaseItemsIn, db: Db, user: DigitalUser) -> ReleaseOut:
    await releases.save_items(db, user, release_id, [i.model_dump() for i in body.items])
    await db.flush()
    return await _release(db, user, release_id)


@router.post("/releases/{release_id}/publish", response_model=ReleaseOut)
async def publish(release_id: uuid.UUID, db: Db, user: DigitalUser) -> ReleaseOut:
    await releases.publish(db, user, release_id)
    return await _release(db, user, release_id)


@router.get("/dashboard")
async def dashboard(db: Db, user: DigitalUser) -> dict[str, object]:
    return await reports.dashboard(db, user)


@router.post("/releases/draft-now", status_code=204)
async def draft_now(db: Db, user: DigitalUser) -> Response:
    """Run this week's drafter on demand (Admins), e.g. for a demo or after a missed Friday."""
    from app.errors import Forbidden

    if not user.is_admin:
        raise Forbidden("Only Admins can run the drafter by hand.")
    await releases.draft_week(db, releases.this_friday())
    return Response(status_code=204)
