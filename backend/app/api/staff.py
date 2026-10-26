"""Staff side: projects, My feedback, the tracker, follow-ups, files, Fixes and updates (brief §4.1, §4.2, §4.8)."""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, File, Query, UploadFile
from fastapi.responses import RedirectResponse, Response
from sqlalchemy import select

from app.api.deps import CurrentUser, Db
from app.config import get_settings
from app.errors import NotFound
from app.models import Attachment, Feedback, FeedbackFollower
from app.models.enums import STAGE_OF
from app.schemas import (
    AllowanceOut,
    AttachmentOut,
    MuteIn,
    MyItemOut,
    ProjectOut,
    ReleaseItemOut,
    ReleaseOut,
    ReplyIn,
    TimelineOut,
    TrackerOut,
)
from app.services import catalog, files, notifications, releases, usage
from app.services import feedback as feedback_service

router = APIRouter(tags=["staff"])


@router.get("/projects", response_model=list[ProjectOut])
async def projects(db: Db, user: CurrentUser) -> list[ProjectOut]:
    return [ProjectOut.model_validate(p) for p in await catalog.list_projects(db)]


@router.get("/usage/me", response_model=AllowanceOut)
async def my_usage(db: Db, user: CurrentUser) -> AllowanceOut:
    """The signed-in person's assistant allowance today (D36)."""
    a = await usage.allowance(db, user.email)
    return AllowanceOut(used_tokens=a.used_tokens, limit_tokens=a.limit_tokens, percent=a.percent, blocked=a.blocked)


@router.get("/my/feedback", response_model=list[MyItemOut])
async def my_feedback(db: Db, user: CurrentUser) -> list[MyItemOut]:
    items = await feedback_service.my_feedback(db, user)
    return [
        MyItemOut(
            reference=f.ref_no,
            title=f.title,
            project=f.project.name if f.project else None,
            stage=STAGE_OF[f.status],
            status=f.status,
            ending=f.ending,
            status_text=feedback_service.status_text(f),
            updated_at=f.updated_at,
            created_at=f.created_at,
            following=f.submitter_email != user.email,
        )
        for f in items
    ]


async def _tracker(db: Db, user: CurrentUser, ref: str) -> TrackerOut:
    v = await feedback_service.tracker(db, user, ref)
    fb = v.feedback
    labels = feedback_service.label(fb)
    return TrackerOut(
        reference=fb.ref_no,
        title=fb.title,
        summary=fb.summary,
        project=fb.project.name if fb.project else None,
        category=labels["category"],
        work_type=labels["work_type"],
        priority=fb.priority,
        status=fb.status,
        ending=fb.ending,
        status_text=v.status_text,
        stage=v.stage,
        stages=v.stages,
        expected_by=fb.expected_by,
        assignee=v.assignee,
        latest_update=v.latest_update,
        history=[TimelineOut(at=h.at, text=h.text, detail=h.detail) for h in v.history],
        close_reason=feedback_service.shown_reason(fb),
        merged_into=v.merged_into,
        attachments=[AttachmentOut.model_validate(a) for a in v.attachments],
        can_reply=v.can_reply,
        muted=v.muted,
    )


@router.get("/feedback/{ref}/tracker", response_model=TrackerOut)
async def tracker(ref: str, db: Db, user: CurrentUser) -> TrackerOut:
    return await _tracker(db, user, ref)


@router.post("/feedback/{ref}/replies", response_model=TrackerOut)
async def add_details(ref: str, body: ReplyIn, db: Db, user: CurrentUser) -> TrackerOut:
    await feedback_service.submitter_reply(db, user, ref, body.body)
    return await _tracker(db, user, ref)


@router.post("/feedback/{ref}/attachments", response_model=AttachmentOut, status_code=201)
async def add_file(ref: str, db: Db, user: CurrentUser, file: UploadFile = File(...)) -> AttachmentOut:  # noqa: B008
    fb = await feedback_service.load(db, ref_no=ref)
    if not await feedback_service.can_view(db, user, fb):
        raise NotFound("We can't find that feedback.")
    content = await file.read(get_settings().max_file_mb * 1024 * 1024 + 1)
    att = await files.save(db, files.Upload(file.filename or "file", content), user.email, feedback_id=fb.id)
    if not user.is_digital:
        fb.submitter_replied_at = datetime.now(UTC)
        await notifications.notify_assignee(
            db,
            fb,
            type="submitter_reply",
            title=f"{fb.ref_no}: {user.name} added a file",
            body=att.file_name,
            actor_email=user.email,
        )
    return AttachmentOut.model_validate(att)


@router.post("/feedback/{ref}/mute", status_code=204)
async def mute(ref: str, body: MuteIn, db: Db, user: CurrentUser) -> Response:
    fb = await feedback_service.load(db, ref_no=ref)
    if not await feedback_service.can_view(db, user, fb):
        raise NotFound("We can't find that feedback.")
    await notifications.set_mute(db, user.email, fb.id, body.muted)
    return Response(status_code=204)


@router.get("/files/{attachment_id}")
async def open_file(attachment_id: uuid.UUID, db: Db, user: CurrentUser) -> Response:
    """Check the user may see the item, then hand out a 15-minute signed link."""
    att = await db.get(Attachment, attachment_id)
    if att is None:
        raise NotFound("No such file.")
    if att.feedback_id is None:
        if att.uploaded_by != user.email:
            raise NotFound("No such file.")
    else:
        fb = await db.get(Feedback, att.feedback_id)
        if fb is None or not await feedback_service.can_view(db, user, fb):
            raise NotFound("No such file.")
    return RedirectResponse(await files.signed_url(att), status_code=303)


@router.get("/files/{attachment_id}/content")
async def file_content(attachment_id: uuid.UUID, db: Db, e: int = Query(...), s: str = Query(...)) -> Response:
    """Local storage only: serve a file through its signed link."""
    files.check_local_signature(attachment_id, e, s)
    att = await db.get(Attachment, attachment_id)
    if att is None:
        raise NotFound("No such file.")
    data = await files.read(att)
    disposition = "inline" if att.mime_type.startswith(("image/", "application/pdf")) else "attachment"
    return Response(
        data,
        media_type=att.mime_type,
        headers={
            "Content-Disposition": f'{disposition}; filename="{att.file_name}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/whats-new", response_model=list[ReleaseOut])
async def whats_new(db: Db, user: CurrentUser) -> list[ReleaseOut]:
    mine = set(await db.scalars(select(Feedback.id).where(Feedback.submitter_email == user.email)))
    mine |= set(await db.scalars(select(FeedbackFollower.feedback_id).where(FeedbackFollower.email == user.email)))
    out = []
    for release, project, items in await releases.whats_new(db):
        out.append(
            ReleaseOut(
                id=release.id,
                project=ProjectOut.model_validate(project),
                week_ending=release.week_ending,
                status=release.status,
                published_at=release.published_at,
                items=[
                    ReleaseItemOut(
                        id=i.id,
                        title=i.title,
                        body=i.body,
                        work_type=i.work_type,
                        source_type=i.source_type,
                        source_id=None,
                        visible_to_staff=True,
                        yours=i.source_type == "feedback" and i.source_id in mine,
                    )
                    for i in items
                ],
            )
        )
    return out
