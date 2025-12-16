"""Genesis module API endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ae_api.db.session import get_session
from ae_api.rag.schemas import NicheCandidate, ValidationReport, ProductSpec, TechnicalSpec, TaskGraph

router = APIRouter()


class GenesisRequest(BaseModel):
    """Request to start a Genesis workflow."""

    intent: str = Field(
        description="Economic intent, e.g., 'generate a data tool to earn $500 MRR'",
        min_length=10,
    )
    budget: float = Field(
        default=10.0,
        ge=1.0,
        le=100.0,
        description="Budget limit for this Genesis run in USD",
    )
    niche_count: int = Field(
        default=5,
        ge=1,
        le=20,
        description="Number of niche candidates to generate",
    )


class GenesisResponse(BaseModel):
    """Response from starting a Genesis workflow."""

    workflow_id: str
    project_id: str
    status: str
    message: str


class NicheListResponse(BaseModel):
    """Response containing niche candidates."""

    niches: list[NicheCandidate]
    total: int


class ValidationResponse(BaseModel):
    """Response containing validation report."""

    report: ValidationReport
    recommendation: str


class ProductSpecResponse(BaseModel):
    """Response containing full product specification."""

    product_spec: ProductSpec
    technical_spec: TechnicalSpec
    task_graph: TaskGraph


@router.post("/start", response_model=GenesisResponse)
async def start_genesis(
    request: GenesisRequest,
    background_tasks: BackgroundTasks,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> GenesisResponse:
    """
    Start a new Genesis workflow to identify and validate a niche.

    This endpoint initiates the full Genesis pipeline:
    1. Niche identification via RAG-powered trend analysis
    2. Validation via SEO/keyword metrics
    3. Product specification via Meta-PM architecture
    """
    # Import here to avoid circular imports
    from ae_api.orchestration.temporal_client import TemporalClient
    from ae_api.orchestration.ids import genesis_workflow_id
    from ae_api.db.models import Project, ProjectStatus
    import hashlib

    # Create project
    intent_hash = hashlib.sha256(request.intent.encode()).hexdigest()[:12]
    workflow_id = genesis_workflow_id(intent_hash)

    project = Project(
        name=f"Genesis-{intent_hash}",
        intent=request.intent,
        status=ProjectStatus.IDEATION,
        budget_limit=request.budget,
    )
    session.add(project)
    await session.commit()
    await session.refresh(project)

    # Start Temporal workflow
    try:
        client = TemporalClient()
        await client.connect()
        await client.start_genesis_workflow(
            intent=request.intent,
            budget=request.budget,
            project_id=project.id,
            niche_count=request.niche_count,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start workflow: {e}")

    return GenesisResponse(
        workflow_id=workflow_id,
        project_id=project.id,
        status="started",
        message=f"Genesis workflow started for intent: {request.intent[:50]}...",
    )


@router.get("/niches/{project_id}", response_model=NicheListResponse)
async def get_niches(
    project_id: str,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> NicheListResponse:
    """Get generated niche candidates for a project."""
    # This would query the database for stored niche candidates
    # For now, return placeholder
    return NicheListResponse(niches=[], total=0)


@router.post("/validate/{niche_id}", response_model=ValidationResponse)
async def validate_niche(
    niche_id: str,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ValidationResponse:
    """Run validation on a specific niche candidate."""
    # This would trigger the validation agent
    raise HTTPException(status_code=501, detail="Not yet implemented")


@router.get("/spec/{project_id}", response_model=ProductSpecResponse)
async def get_product_spec(
    project_id: str,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ProductSpecResponse:
    """Get the full product specification for a project."""
    # This would retrieve the generated specs
    raise HTTPException(status_code=501, detail="Not yet implemented")


@router.post("/approve/{project_id}")
async def approve_and_proceed(
    project_id: str,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """Approve the Genesis output and proceed to Build phase."""
    from ae_api.orchestration.temporal_client import TemporalClient

    try:
        client = TemporalClient()
        await client.connect()
        await client.signal_workflow(
            workflow_id=f"genesis-{project_id}",
            signal="approve",
            data={"approved": True},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to signal workflow: {e}")

    return {"status": "approved", "message": "Proceeding to Build phase"}
