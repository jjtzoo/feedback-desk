"""The management console for Digital Staff and Admins (brief §4.4, §4.5). Role checked on every call."""

import uuid
from datetime import UTC, date, datetime

from fastapi import APIRouter, Query
from fastapi.responses import Response

from app.api.deps import AdminUser, Db, DigitalUser
from app.models import Feedback
from app.models.enums import DUE_STATUSES, STAGE_OF
from app.schemas import (
    ActivityOut,
    ApproveIn,
    AttachmentOut,
    BoardOut,
    BulkIn,
    CardOut,
    CloseIn,
    ColumnOut,
    CountsOut,
    DeclineIn,
    DetailOut,
    EventOut,
    FieldsIn,
    HandOverIn,
    InboxOut,
    InboxRowOut,
    ListOut,
    MergeIn,
    MessageOut,
    MoveIn,
    NoteIn,
    PersonOut,
    ProjectOut,
    ReplyIn,
    SimilarOut,
    TakeOverIn,
    UpdateIn,
    UsageSummaryOut,
    ViewIn,
)
from app.services import console, inbox, usage

router = APIRouter(prefix="/console", tags=["console"])


def _card(fb: Feedback, files: set[uuid.UUID], reporters: dict[uuid.UUID, int], unread: set[uuid.UUID]) -> CardOut:
    today = datetime.now(UTC).date()
    count = reporters.get(fb.id, 1)
    return CardOut(
        id=fb.id,
        reference=fb.ref_no,
        title=fb.title,
        summary=fb.summary,
        project=ProjectOut.model_validate(fb.project) if fb.project else None,
        work_type=fb.work_type,
        category=fb.category,
        priority=fb.priority,
        status=fb.status,
        ending=fb.ending,
        stage=STAGE_OF[fb.status],
        submitter_name=fb.submitter_name,
        assignee=PersonOut(id=fb.assignee.id, name=fb.assignee.name) if fb.assignee else None,
        created_at=fb.created_at,
        expected_by=fb.expected_by,
        overdue=bool(fb.expected_by and fb.expected_by < today and fb.status in DUE_STATUSES),
        has_files=fb.id in files,
        unread=fb.id in unread,
        flagged=fb.flagged,
        channel=fb.channel,
        reporters=count,
        priority_review=console.needs_priority_review(fb, count),
        needs_detail=console.needs_detail(fb),
        routed=fb.routed,
    )


def _filters(
    inbox: str = "mine",
    project: str | None = None,
    category: str | None = None,
    priority: str | None = None,
    status: str | None = None,
    work_type: str | None = None,
    assignee: str | None = None,
    q: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    sort: str = "urgent",
    page: int = 1,
    ending: str | None = None,
) -> console.Filters:
    return console.Filters(
        inbox, project, category, priority, status, work_type, assignee, q, date_from, date_to, sort, page, ending
    )


@router.get("/board", response_model=BoardOut)
async def board(
    db: Db,
    user: DigitalUser,
    inbox: str = "mine",
    project: str | None = None,
    category: str | None = None,
    priority: str | None = None,
    work_type: str | None = None,
    assignee: str | None = None,
    q: str | None = None,
) -> BoardOut:
    cols = await console.board(db, user, _filters(inbox, project, category, priority, None, work_type, assignee, q))
    ids = [i.id for c in cols for i in c.items]
    files = await console.has_files(db, ids)
    reporters = await console.reporter_counts(db, ids)
    unread = await console.unread_items(db, user, [i for c in cols for i in c.items])
    return BoardOut(
        columns=[
            ColumnOut(
                key=c.key,
                title=c.title,
                count=c.count,
                overdue=c.overdue,
                items=[_card(i, files, reporters, unread) for i in c.items],
            )
            for c in cols
        ],
        view=await console.get_view(db, user),
    )


@router.get("/items", response_model=ListOut)
async def items(
    db: Db,
    user: DigitalUser,
    inbox: str = "mine",
    project: str | None = None,
    category: str | None = None,
    priority: str | None = None,
    status: str | None = None,
    work_type: str | None = None,
    assignee: str | None = None,
    q: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    sort: str = "urgent",
    page: int = Query(default=1, ge=1),
    ending: str | None = None,
) -> ListOut:
    f = _filters(
        inbox, project, category, priority, status, work_type, assignee, q, date_from, date_to, sort, page, ending
    )
    rows, total = await console.list_items(db, user, f)
    files = await console.has_files(db, [r.id for r in rows])
    reporters = await console.reporter_counts(db, [r.id for r in rows])
    unread = await console.unread_items(db, user, rows)
    return ListOut(
        items=[_card(r, files, reporters, unread) for r in rows],
        total=total,
        page=page,
        page_size=console.PAGE_SIZE,
        view=await console.get_view(db, user),
    )


@router.get("/counts", response_model=CountsOut)
async def counts(db: Db, user: DigitalUser) -> CountsOut:
    return CountsOut(**await console.counts(db, user), inbox=await inbox.waiting_count(db, user))


@router.get("/inbox", response_model=InboxOut)
async def inbox_view(db: Db, user: DigitalUser, view: str = "waiting") -> InboxOut:
    rows, total, views = await inbox.inbox(db, user, view)
    return InboxOut(
        view=view,
        total=total,
        counts=views,
        rows=[
            InboxRowOut(
                reference=r.item.ref_no,
                title=r.item.title,
                project=ProjectOut.model_validate(r.item.project) if r.item.project else None,
                status=r.item.status,
                assignee=PersonOut.model_validate(r.item.assignee) if r.item.assignee else None,
                last_author=r.last.author_name or "Someone",
                last_from_reporter=r.last.author_type == "staff",
                last_internal=r.last.is_internal,
                last_body=r.last.body[:200],
                last_at=r.last.created_at,
                waiting=r.waiting,
                unread=r.unread,
            )
            for r in rows
        ],
    )


@router.put("/view", status_code=204)
async def set_view(body: ViewIn, db: Db, user: DigitalUser) -> Response:
    await console.set_view(db, user, body.view)
    return Response(status_code=204)


async def _detail(db: Db, user: DigitalUser, ref: str) -> DetailOut:
    d = await console.detail(db, user, ref)
    fb = d.feedback
    files = {fb.id} if d.attachments else set()
    return DetailOut(
        **_card(fb, files, {fb.id: 1 + len(d.followers)}, set()).model_dump(),
        submitter_email=fb.submitter_email,
        target_type=fb.target_type,
        area=fb.area,
        impact=fb.impact,
        effort=fb.effort,
        sentiment=fb.sentiment,
        ai_recommendation=fb.ai_recommendation,
        ai_confidence=fb.ai_confidence,
        dev_brief=fb.dev_brief,
        context=fb.context,
        close_reason=fb.close_reason,
        merged_into=d.merged_into,
        approved_by=fb.approved_by,
        approved_at=fb.approved_at,
        messages=[MessageOut.model_validate(m) for m in d.messages],
        events=[EventOut.model_validate(e) for e in d.events],
        attachments=[AttachmentOut.model_validate(a) for a in d.attachments],
        followers=[f.name for f in d.followers],
        duplicates=[
            SimilarOut(reference=s.ref_no, title=s.title, status=s.status, similarity=s.similarity)
            for s in d.duplicates
        ],
        linked=[f.ref_no for f in d.linked],
        assignee_away=bool(fb.assignee and fb.assignee.is_away),
        holder_activity=ActivityOut(text=d.holder_activity.text, at=d.holder_activity.at)
        if d.holder_activity
        else None,
        last_read_at=d.last_read_at,
    )


@router.get("/items/{ref}", response_model=DetailOut)
async def detail(ref: str, db: Db, user: DigitalUser) -> DetailOut:
    return await _detail(db, user, ref)


@router.post("/items/{ref}/start", response_model=DetailOut)
async def start(ref: str, db: Db, user: DigitalUser) -> DetailOut:
    await console.start_work(db, user, ref)
    return await _detail(db, user, ref)


@router.post("/items/{ref}/assign-to-me", response_model=DetailOut)
async def assign_to_me(ref: str, db: Db, user: DigitalUser) -> DetailOut:
    await console.assign_to_me(db, user, ref)
    return await _detail(db, user, ref)


@router.post("/items/{ref}/take-over", response_model=DetailOut)
async def take_over(ref: str, body: TakeOverIn, db: Db, user: DigitalUser) -> DetailOut:
    await console.take_over(db, user, ref, body.holder_id, body.reason)
    return await _detail(db, user, ref)


@router.post("/items/{ref}/hand-over", response_model=DetailOut)
async def hand_over(ref: str, body: HandOverIn, db: Db, user: DigitalUser) -> DetailOut:
    await console.hand_over(db, user, ref, body.to, body.reason)
    return await _detail(db, user, ref)


@router.post("/items/{ref}/update", response_model=DetailOut)
async def post_update(ref: str, body: UpdateIn, db: Db, user: DigitalUser) -> DetailOut:
    await console.post_update(db, user, ref, body.body, body.expected_by, body.due_reason)
    return await _detail(db, user, ref)


@router.post("/items/{ref}/resolve", response_model=DetailOut)
async def resolve(ref: str, body: NoteIn, db: Db, user: DigitalUser) -> DetailOut:
    await console.resolve(db, user, ref, body.body)
    return await _detail(db, user, ref)


@router.post("/items/{ref}/close", response_model=DetailOut)
async def close(ref: str, body: CloseIn, db: Db, user: DigitalUser) -> DetailOut:
    await console.close(db, user, ref, body.reason, body.ending)
    return await _detail(db, user, ref)


@router.post("/items/{ref}/reply", response_model=DetailOut)
async def reply(ref: str, body: ReplyIn, db: Db, user: DigitalUser) -> DetailOut:
    await console.reply(db, user, ref, body.body)
    return await _detail(db, user, ref)


@router.post("/items/{ref}/note", response_model=DetailOut)
async def note(ref: str, body: NoteIn, db: Db, user: DigitalUser) -> DetailOut:
    await console.add_note(db, user, ref, body.body)
    return await _detail(db, user, ref)


@router.patch("/items/{ref}", response_model=DetailOut)
async def fields(ref: str, body: FieldsIn, db: Db, user: DigitalUser) -> DetailOut:
    await console.update_fields(db, user, ref, body.model_dump(include=body.model_fields_set))
    return await _detail(db, user, ref)


@router.post("/items/{ref}/merge", response_model=DetailOut)
async def merge(ref: str, body: MergeIn, db: Db, user: DigitalUser) -> DetailOut:
    await console.merge(db, user, ref, body.into)
    return await _detail(db, user, ref)


@router.post("/items/{ref}/move", response_model=DetailOut)
async def move(ref: str, body: MoveIn, db: Db, user: DigitalUser) -> DetailOut:
    await console.move(db, user, ref, body.column, body.note)
    return await _detail(db, user, ref)


@router.post("/bulk")
async def bulk(body: BulkIn, db: Db, user: DigitalUser) -> dict[str, int]:
    return {"done": await console.bulk(db, user, body.references, body.action, body.assignee_id, body.reason)}


# --- approvals (Admins) --------------------------------------------------------------------


@router.get("/approvals", response_model=list[DetailOut])
async def approvals(db: Db, user: AdminUser) -> list[DetailOut]:
    return [await _detail(db, user, fb.ref_no) for fb in await console.approvals(db, user)]


@router.post("/items/{ref}/approve", response_model=DetailOut)
async def approve(ref: str, db: Db, user: AdminUser, body: ApproveIn | None = None) -> DetailOut:
    b = body or ApproveIn()
    await console.approve(db, user, ref, b.instructions, b.priority, b.due_date)
    return await _detail(db, user, ref)


@router.post("/items/{ref}/decline", response_model=DetailOut)
async def decline(ref: str, body: DeclineIn, db: Db, user: AdminUser) -> DetailOut:
    await console.decline(db, user, ref, body.reason)
    return await _detail(db, user, ref)


@router.get("/usage", response_model=UsageSummaryOut)
async def usage_summary(db: Db, user: DigitalUser) -> UsageSummaryOut:
    """AI usage against the spend guards (D36). Per-person rows are for Admins only."""
    return UsageSummaryOut.model_validate(await usage.summary(db, user))
