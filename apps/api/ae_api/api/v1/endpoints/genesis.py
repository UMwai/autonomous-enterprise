"""Genesis module API endpoints.

This module provides endpoints for the Genesis workflow:
- Trend ingestion from Reddit/HackerNews
- RAG-powered niche identification
- SEO/market validation
- MetaGPT-powered specification generation
"""

from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ae_api.db.session import get_session, engine
from ae_api.rag.schemas import (
    NicheCandidate as RagNicheCandidate,
    ValidationReport as RagValidationReport,
    ProductSpec as RagProductSpec,
    TechnicalSpec as RagTechnicalSpec,
    TaskGraph as RagTaskGraph,
)

logger = structlog.get_logger()
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


# ============================================================================
# New Endpoints for Genesis Services (called by TypeScript activities)
# ============================================================================


class IngestTrendsRequest(BaseModel):
    """Request to ingest trends from external sources."""

    intent: str = Field(description="User intent to guide trend search")
    sources: list[str] = Field(
        default=["reddit", "hackernews"],
        description="Sources to fetch trends from",
    )
    limit: int = Field(default=50, ge=10, le=200, description="Max trends per source")
    subreddits: list[str] | None = Field(
        default=None,
        description="Optional specific subreddits to search",
    )


class IngestTrendsResponse(BaseModel):
    """Response from trend ingestion."""

    total_ingested: int
    sources_used: list[str]
    message: str


@router.post("/ingest-trends", response_model=IngestTrendsResponse)
async def ingest_trends(request: IngestTrendsRequest) -> IngestTrendsResponse:
    """
    Ingest trend data from external sources into the vector store.

    This endpoint fetches data from Reddit and HackerNews, processes it,
    and stores embeddings in PGVector for RAG-based niche identification.
    """
    from ae_api.genesis.niche_identification import NicheIdentificationEngine, TrendDocument
    from ae_api.genesis.sources.reddit import RedditSource, SAAS_SUBREDDITS
    from ae_api.genesis.sources.hackernews import HackerNewsSource

    logger.info("ingesting_trends", intent=request.intent, sources=request.sources)

    try:
        all_trends: list[TrendDocument] = []
        sources_used = []

        # Fetch from Reddit
        if "reddit" in request.sources:
            async with RedditSource() as reddit:
                subreddits = request.subreddits or SAAS_SUBREDDITS[:5]
                trends = await reddit.fetch_trends(
                    query=request.intent,
                    limit=request.limit,
                    subreddits=subreddits,
                )
                all_trends.extend(trends)
                sources_used.append("reddit")
                logger.info("reddit_trends_fetched", count=len(trends))

        # Fetch from HackerNews
        if "hackernews" in request.sources:
            async with HackerNewsSource() as hn:
                trends = await hn.fetch_trends(
                    query=request.intent,
                    limit=request.limit,
                )
                all_trends.extend(trends)
                sources_used.append("hackernews")
                logger.info("hackernews_trends_fetched", count=len(trends))

        # Ingest into vector store
        if all_trends:
            niche_engine = NicheIdentificationEngine(db_engine=engine)
            chunks_ingested = await niche_engine.ingest_trends(all_trends)
            logger.info("trends_ingested", chunks=chunks_ingested)
        else:
            chunks_ingested = 0

        return IngestTrendsResponse(
            total_ingested=chunks_ingested,
            sources_used=sources_used,
            message=f"Ingested {chunks_ingested} chunks from {len(sources_used)} sources",
        )

    except Exception as e:
        logger.error("trend_ingestion_failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Trend ingestion failed: {e}")


class IdentifyNichesRequest(BaseModel):
    """Request to identify niche opportunities."""

    intent: str = Field(description="User intent for niche discovery")
    count: int = Field(default=5, ge=1, le=20, description="Number of niches to identify")
    domain: str | None = Field(default=None, description="Optional domain constraint")


class IdentifyNichesResponse(BaseModel):
    """Response containing identified niches."""

    niches: list[dict]
    total: int
    message: str


@router.post("/identify-niches", response_model=IdentifyNichesResponse)
async def identify_niches(request: IdentifyNichesRequest) -> IdentifyNichesResponse:
    """
    Identify niche opportunities using RAG-powered analysis.

    This endpoint uses the NicheIdentificationEngine to search the vector store
    and generate scored niche candidates based on the user's intent.
    """
    from ae_api.genesis.niche_identification import NicheIdentificationEngine

    logger.info("identifying_niches", intent=request.intent, count=request.count)

    try:
        niche_engine = NicheIdentificationEngine(db_engine=engine)
        niches = await niche_engine.identify_niches(
            intent=request.intent,
            count=request.count,
        )

        # Convert to dicts for JSON response
        niche_dicts = [niche.model_dump() for niche in niches]

        logger.info("niches_identified", count=len(niche_dicts))

        return IdentifyNichesResponse(
            niches=niche_dicts,
            total=len(niche_dicts),
            message=f"Identified {len(niche_dicts)} niche opportunities",
        )

    except Exception as e:
        logger.error("niche_identification_failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Niche identification failed: {e}")


class ValidateNicheRequest(BaseModel):
    """Request to validate a niche candidate."""

    niche: dict = Field(description="Niche candidate to validate")


class ValidateNicheResponse(BaseModel):
    """Response containing validation report."""

    validation_report: dict
    should_pursue: bool
    validation_score: float
    message: str


@router.post("/validate-niche", response_model=ValidateNicheResponse)
async def validate_niche_endpoint(request: ValidateNicheRequest) -> ValidateNicheResponse:
    """
    Validate a niche candidate using SEO and market analysis.

    This endpoint uses the ValidatorAgent to analyze search volume,
    competition, ARPU, and other metrics to determine viability.
    """
    from ae_api.genesis.niche_identification import NicheCandidate
    from ae_api.genesis.validator_agent import ValidatorAgent

    logger.info("validating_niche", niche_name=request.niche.get("name"))

    try:
        # Convert dict to NicheCandidate
        niche = NicheCandidate(**request.niche)

        async with ValidatorAgent() as validator:
            report = await validator.validate_niche(niche)

        logger.info(
            "niche_validated",
            niche_name=niche.name,
            score=report.validation_score,
            should_pursue=report.should_pursue,
        )

        return ValidateNicheResponse(
            validation_report=report.model_dump(),
            should_pursue=report.should_pursue,
            validation_score=report.validation_score,
            message=f"Validation complete: {'Recommended' if report.should_pursue else 'Not recommended'}",
        )

    except Exception as e:
        logger.error("niche_validation_failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Niche validation failed: {e}")


class GenerateSpecRequest(BaseModel):
    """Request to generate product specification."""

    niche: dict = Field(description="Validated niche candidate")
    validation_report: dict = Field(description="Validation report from previous step")


class GenerateSpecResponse(BaseModel):
    """Response containing generated specifications."""

    product_spec: dict
    technical_spec: dict
    task_graph: dict
    message: str


@router.post("/generate-spec", response_model=GenerateSpecResponse)
async def generate_spec(request: GenerateSpecRequest) -> GenerateSpecResponse:
    """
    Generate complete product specification using MetaGPT.

    This endpoint runs the full MetaGPT workflow:
    1. PM Role -> ProductSpec (PRD, user stories)
    2. Architect Role -> TechnicalSpec (stack, architecture)
    3. ProjectManager Role -> TaskGraph (implementation tasks)
    """
    from ae_api.genesis.niche_identification import NicheCandidate
    from ae_api.genesis.validator_agent import ValidationReport, ValidationMetrics
    from ae_api.genesis.metapm.metagpt_runner import MetaGPTRunner

    logger.info("generating_spec", niche_name=request.niche.get("name"))

    try:
        # Convert dicts to domain objects
        niche = NicheCandidate(**request.niche)

        # Reconstruct ValidationReport
        report_data = request.validation_report
        metrics_data = report_data.get("metrics", {})
        metrics = ValidationMetrics(**metrics_data)

        validation_report = ValidationReport(
            niche=niche,
            metrics=metrics,
            validation_score=report_data.get("validation_score", 0),
            strengths=report_data.get("strengths", []),
            weaknesses=report_data.get("weaknesses", []),
            recommendations=report_data.get("recommendations", []),
            should_pursue=report_data.get("should_pursue", False),
        )

        # Run MetaGPT workflow
        runner = MetaGPTRunner()
        product_spec, technical_spec, task_graph = await runner.run(
            niche=niche,
            validation_report=validation_report,
        )

        logger.info(
            "spec_generated",
            product_name=product_spec.product_name,
            stories=len(product_spec.user_stories),
            tasks=len(task_graph.tasks),
        )

        return GenerateSpecResponse(
            product_spec=product_spec.model_dump(),
            technical_spec=technical_spec.model_dump(),
            task_graph=task_graph.model_dump(),
            message=f"Generated specification for {product_spec.product_name}",
        )

    except Exception as e:
        logger.error("spec_generation_failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Spec generation failed: {e}")
