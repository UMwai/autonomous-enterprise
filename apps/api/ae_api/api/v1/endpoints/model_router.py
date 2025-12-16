"""Model Router API endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ae_api.config import Settings, get_settings
from ae_api.economy.classifier import SemanticClassifier
from ae_api.economy.providers import AnthropicProvider, GoogleProvider, OpenAIProvider
from ae_api.economy.router import ModelRouter, ModelTier, RoutingDecision

router = APIRouter()


# Request/Response models
class RouteRequest(BaseModel):
    """Request to route a prompt."""

    prompt: str = Field(
        ..., description="Task prompt to route"
    )
    context: dict | None = Field(
        default=None, description="Optional additional context"
    )
    override_tier: ModelTier | None = Field(
        default=None, description="Optional tier override (skip classification)"
    )
    run_id: str | None = Field(
        default=None, description="Optional run ID for budget tracking"
    )


class CompleteRequest(BaseModel):
    """Request to route and complete a prompt."""

    prompt: str = Field(
        ..., description="Task prompt to complete"
    )
    context: dict | None = Field(
        default=None, description="Optional additional context"
    )
    override_tier: ModelTier | None = Field(
        default=None, description="Optional tier override"
    )
    run_id: str | None = Field(
        default=None, description="Optional run ID for budget tracking"
    )
    temperature: float = Field(
        default=0.7, ge=0.0, le=2.0, description="Sampling temperature"
    )
    max_tokens: int = Field(
        default=2000, ge=1, le=8000, description="Maximum tokens to generate"
    )


class CompleteResponse(BaseModel):
    """Response from completion."""

    content: str = Field(
        ..., description="Generated content"
    )
    routing_decision: RoutingDecision = Field(
        ..., description="Routing decision made"
    )
    actual_cost: float = Field(
        ..., description="Actual cost incurred"
    )
    usage: dict = Field(
        ..., description="Token usage statistics"
    )


class TierInfo(BaseModel):
    """Information about a model tier."""

    tier: str = Field(
        ..., description="Tier identifier"
    )
    models: list[dict] = Field(
        ..., description="Available models in this tier"
    )
    use_cases: list[str] = Field(
        ..., description="Recommended use cases"
    )
    default_model: tuple[str, str] = Field(
        ..., description="Default (provider, model_id) for this tier"
    )


class BudgetInfo(BaseModel):
    """Budget information for a run."""

    run_id: str = Field(
        ..., description="Run identifier"
    )
    usage: float = Field(
        ..., description="Current usage in USD"
    )
    budget: float = Field(
        ..., description="Total budget in USD"
    )
    remaining: float = Field(
        ..., description="Remaining budget in USD"
    )
    utilization: float = Field(
        ..., description="Budget utilization percentage"
    )


# Dependency injection
def get_classifier(
    settings: Annotated[Settings, Depends(get_settings)]
) -> SemanticClassifier:
    """Get classifier instance."""
    return SemanticClassifier(settings)


def get_router(
    settings: Annotated[Settings, Depends(get_settings)],
    classifier: Annotated[SemanticClassifier, Depends(get_classifier)]
) -> ModelRouter:
    """Get router instance."""
    return ModelRouter(settings, classifier)


def get_providers(
    settings: Annotated[Settings, Depends(get_settings)]
) -> dict[str, AnthropicProvider | GoogleProvider | OpenAIProvider]:
    """Get provider instances."""
    providers = {}

    if settings.openai_api_key:
        providers["openai"] = OpenAIProvider(settings)

    if settings.anthropic_api_key:
        providers["anthropic"] = AnthropicProvider(settings)

    if settings.google_api_key:
        providers["google"] = GoogleProvider(settings)

    return providers


# Endpoints
@router.post("/route", response_model=RoutingDecision)
async def route_prompt(
    request: RouteRequest,
    model_router: Annotated[ModelRouter, Depends(get_router)],
) -> RoutingDecision:
    """Route a prompt to the appropriate model tier.

    This endpoint classifies a task and determines which model tier
    should be used based on complexity, risk, and cost considerations.
    """
    try:
        decision = await model_router.route(
            prompt=request.prompt,
            context=request.context,
            override_tier=request.override_tier,
            run_id=request.run_id,
        )
        return decision
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error routing prompt: {str(e)}"
        )


@router.get("/tiers", response_model=dict[str, TierInfo])
async def get_tiers(
    model_router: Annotated[ModelRouter, Depends(get_router)],
) -> dict[str, TierInfo]:
    """Get information about all available model tiers.

    Returns configuration, models, and use cases for each tier.
    """
    tier_info = model_router.get_tier_info()

    result = {}
    for tier_name, info in tier_info.items():
        result[tier_name] = TierInfo(
            tier=tier_name,
            models=info["models"],
            use_cases=info["use_cases"],
            default_model=info["default_model"],
        )

    return result


@router.post("/complete", response_model=CompleteResponse)
async def complete_prompt(
    request: CompleteRequest,
    model_router: Annotated[ModelRouter, Depends(get_router)],
    providers: Annotated[dict, Depends(get_providers)],
) -> CompleteResponse:
    """Route and complete a prompt in one call.

    This endpoint combines routing and completion:
    1. Routes the prompt to appropriate model tier
    2. Generates completion using selected model
    3. Records cost and usage
    """
    try:
        # Route the prompt
        decision = await model_router.route(
            prompt=request.prompt,
            context=request.context,
            override_tier=request.override_tier,
            run_id=request.run_id,
        )

        # Get the appropriate provider
        provider = providers.get(decision.provider)
        if not provider:
            raise HTTPException(
                status_code=400,
                detail=f"Provider {decision.provider} not configured. "
                       f"Please set the appropriate API key."
            )

        # Generate completion
        completion = await provider.complete(
            prompt=request.prompt,
            model=decision.model_id,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
        )

        # Record usage if run_id provided
        if request.run_id:
            model_router.record_usage(request.run_id, completion.cost)

        return CompleteResponse(
            content=completion.content,
            routing_decision=decision,
            actual_cost=completion.cost,
            usage=completion.usage,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error completing prompt: {str(e)}"
        )


@router.get("/budget/{run_id}", response_model=BudgetInfo)
async def get_budget_info(
    run_id: str,
    model_router: Annotated[ModelRouter, Depends(get_router)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> BudgetInfo:
    """Get budget information for a run.

    Returns current usage, total budget, and remaining budget.
    """
    usage = model_router.get_run_usage(run_id)
    budget = settings.default_run_budget
    remaining = max(0, budget - usage)
    utilization = (usage / budget * 100) if budget > 0 else 0

    return BudgetInfo(
        run_id=run_id,
        usage=usage,
        budget=budget,
        remaining=remaining,
        utilization=utilization,
    )


@router.delete("/budget/{run_id}")
async def reset_budget(
    run_id: str,
    model_router: Annotated[ModelRouter, Depends(get_router)],
) -> dict[str, str]:
    """Reset budget tracking for a run.

    Clears all recorded usage for the specified run ID.
    """
    model_router.reset_run_budget(run_id)
    return {"message": f"Budget reset for run {run_id}"}
