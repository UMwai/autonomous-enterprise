"""Run management API endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ae_api.db.models import Run, RunStatus, RunType
from ae_api.db.session import get_session

router = APIRouter()


class RunResponse(BaseModel):
    """Response model for a run."""

    id: str
    project_id: str
    workflow_id: str
    run_type: str
    status: str
    tokens_used: int
    cost_incurred: float
    error_message: str | None
    created_at: str
    updated_at: str

    model_config = ConfigDict(from_attributes=True)


class RunListResponse(BaseModel):
    """Response model for listing runs."""

    runs: list[RunResponse]
    total: int
    page: int
    page_size: int


class RunStatusUpdate(BaseModel):
    """Request to update run status."""

    status: RunStatus
    error_message: str | None = None


@router.get("/", response_model=RunListResponse)
async def list_runs(
    session: Annotated[AsyncSession, Depends(get_session)],
    project_id: str | None = Query(None, description="Filter by project ID"),
    run_type: RunType | None = Query(None, description="Filter by run type"),
    status: RunStatus | None = Query(None, description="Filter by status"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
) -> RunListResponse:
    """List runs with optional filtering."""
    # Build base conditions
    conditions = []
    if project_id:
        conditions.append(Run.project_id == project_id)
    if run_type:
        conditions.append(Run.run_type == run_type)
    if status:
        conditions.append(Run.status == status)

    # Get total count optimized
    count_query = select(func.count()).select_from(Run)
    if conditions:
        count_query = count_query.where(*conditions)

    count_result = await session.execute(count_query)
    total = count_result.scalar_one()

    # Get page items
    query = select(Run)
    if conditions:
        query = query.where(*conditions)

    query = query.offset((page - 1) * page_size).limit(page_size)
    query = query.order_by(Run.created_at.desc())

    result = await session.execute(query)
    runs = result.scalars().all()

    return RunListResponse(
        runs=[
            RunResponse(
                id=run.id,
                project_id=run.project_id,
                workflow_id=run.workflow_id,
                run_type=run.run_type.value,
                status=run.status.value,
                tokens_used=run.tokens_used,
                cost_incurred=run.cost_incurred,
                error_message=run.error_message,
                created_at=run.created_at.isoformat(),
                updated_at=run.updated_at.isoformat(),
            )
            for run in runs
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{run_id}", response_model=RunResponse)
async def get_run(
    run_id: str,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> RunResponse:
    """Get a specific run by ID."""
    result = await session.execute(select(Run).where(Run.id == run_id))
    run = result.scalar_one_or_none()

    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    return RunResponse(
        id=run.id,
        project_id=run.project_id,
        workflow_id=run.workflow_id,
        run_type=run.run_type.value,
        status=run.status.value,
        tokens_used=run.tokens_used,
        cost_incurred=run.cost_incurred,
        error_message=run.error_message,
        created_at=run.created_at.isoformat(),
        updated_at=run.updated_at.isoformat(),
    )


@router.patch("/{run_id}/status", response_model=RunResponse)
async def update_run_status(
    run_id: str,
    update: RunStatusUpdate,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> RunResponse:
    """Update a run's status."""
    result = await session.execute(select(Run).where(Run.id == run_id))
    run = result.scalar_one_or_none()

    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    run.status = update.status
    if update.error_message:
        run.error_message = update.error_message

    await session.commit()
    await session.refresh(run)

    return RunResponse(
        id=run.id,
        project_id=run.project_id,
        workflow_id=run.workflow_id,
        run_type=run.run_type.value,
        status=run.status.value,
        tokens_used=run.tokens_used,
        cost_incurred=run.cost_incurred,
        error_message=run.error_message,
        created_at=run.created_at.isoformat(),
        updated_at=run.updated_at.isoformat(),
    )


@router.delete("/{run_id}")
async def cancel_run(
    run_id: str,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """Cancel a running workflow."""
    from ae_api.orchestration.temporal_client import TemporalClient

    result = await session.execute(select(Run).where(Run.id == run_id))
    run = result.scalar_one_or_none()

    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    if run.status not in [RunStatus.PENDING, RunStatus.RUNNING]:
        raise HTTPException(status_code=400, detail="Run is not active")

    try:
        client = TemporalClient()
        await client.connect()
        await client.cancel_workflow(run.workflow_id)

        run.status = RunStatus.CANCELLED
        await session.commit()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to cancel: {e}")

    return {"status": "cancelled", "run_id": run_id}
