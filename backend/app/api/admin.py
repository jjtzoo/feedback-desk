"""The admin page: projects, Digital Staff and routing rules (F2). Admins only."""

import uuid

from fastapi import APIRouter
from fastapi.responses import Response

from app.api.deps import AdminUser, Db, DigitalUser
from app.schemas import ProjectAdminOut, ProjectIn, ProjectPatch, RuleIn, RuleOut, StaffIn, StaffOut, StaffPatch
from app.services import catalog

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/projects", response_model=list[ProjectAdminOut])
async def projects(db: Db, user: DigitalUser) -> list[ProjectAdminOut]:
    return [ProjectAdminOut.model_validate(p) for p in await catalog.list_projects(db, active_only=False)]


@router.post("/projects", response_model=ProjectAdminOut, status_code=201)
async def add_project(body: ProjectIn, db: Db, user: AdminUser) -> ProjectAdminOut:
    return ProjectAdminOut.model_validate(await catalog.save_project(db, body.model_dump()))


@router.patch("/projects/{project_id}", response_model=ProjectAdminOut)
async def edit_project(project_id: uuid.UUID, body: ProjectPatch, db: Db, user: AdminUser) -> ProjectAdminOut:
    return ProjectAdminOut.model_validate(
        await catalog.save_project(db, body.model_dump(include=body.model_fields_set), project_id)
    )


@router.get("/digital-staff", response_model=list[StaffOut])
async def staff(db: Db, user: DigitalUser) -> list[StaffOut]:
    counts = await catalog.open_counts(db)
    return [
        StaffOut.model_validate(s).model_copy(update={"open_items": counts.get(s.id, 0)})
        for s in await catalog.list_staff(db)
    ]


@router.post("/digital-staff", response_model=StaffOut, status_code=201)
async def add_staff(body: StaffIn, db: Db, user: AdminUser) -> StaffOut:
    return StaffOut.model_validate(await catalog.save_staff(db, body.model_dump()))


@router.patch("/digital-staff/{staff_id}", response_model=StaffOut)
async def edit_staff(staff_id: uuid.UUID, body: StaffPatch, db: Db, user: AdminUser) -> StaffOut:
    return StaffOut.model_validate(
        await catalog.save_staff(db, body.model_dump(include=body.model_fields_set), staff_id)
    )


@router.get("/routing-rules", response_model=list[RuleOut])
async def rules(db: Db, user: DigitalUser) -> list[RuleOut]:
    return [RuleOut.model_validate(r) for r in await catalog.list_rules(db)]


@router.post("/routing-rules", response_model=RuleOut, status_code=201)
async def add_rule(body: RuleIn, db: Db, user: AdminUser) -> RuleOut:
    return RuleOut.model_validate(await catalog.save_rule(db, body.model_dump()))


@router.put("/routing-rules/{rule_id}", response_model=RuleOut)
async def edit_rule(rule_id: uuid.UUID, body: RuleIn, db: Db, user: AdminUser) -> RuleOut:
    return RuleOut.model_validate(await catalog.save_rule(db, body.model_dump(), rule_id))


@router.delete("/routing-rules/{rule_id}", status_code=204)
async def delete_rule(rule_id: uuid.UUID, db: Db, user: AdminUser) -> Response:
    await catalog.delete_rule(db, rule_id)
    return Response(status_code=204)
