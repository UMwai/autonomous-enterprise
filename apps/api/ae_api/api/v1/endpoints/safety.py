"""Safety and governance API endpoints."""

from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from redis.asyncio import Redis

from ae_api.safety import ActionType, BudgetStatus, BudgetTracker, PolicyDecision, PolicyGate

logger = structlog.get_logger()
router = APIRouter()

# Global instances (will be initialized with dependency injection)
_policy_gate: PolicyGate | None = None
_budget_tracker: BudgetTracker | None = None


# Request/Response Models
class CheckActionRequest(BaseModel):
    """Request to check if an action is allowed."""

    action: ActionType = Field(description="Type of action to check")
    context: dict[str, Any] = Field(
        default_factory=dict, description="Additional context for the decision"
    )


class CreateBudgetRequest(BaseModel):
    """Request to create a new budget."""

    run_id: str = Field(description="Unique identifier for the run")
    limit: float = Field(gt=0, description="Budget limit in USD")


class SpendBudgetRequest(BaseModel):
    """Request to record spending."""

    run_id: str = Field(description="Unique identifier for the run")
    amount: float = Field(ge=0, description="Amount to spend in USD")


class CanSpendRequest(BaseModel):
    """Request to check if spending is allowed."""

    run_id: str = Field(description="Unique identifier for the run")
    amount: float = Field(ge=0, description="Amount to check in USD")


class CanSpendResponse(BaseModel):
    """Response indicating if spending is allowed."""

    can_spend: bool = Field(description="Whether the spend would be within budget")
    current_status: BudgetStatus = Field(description="Current budget status")


# Dependency injection for Redis client
async def get_redis() -> Redis:
    """Get Redis client for budget tracking."""
    from ae_api.config import get_settings

    settings = get_settings()

    redis = Redis(
        host=settings.redis_host,
        port=settings.redis_port,
        db=settings.redis_db,
        password=settings.redis_password.get_secret_value() if settings.redis_password else None,
        decode_responses=True,
        socket_connect_timeout=5,
    )
    try:
        yield redis
    finally:
        await redis.aclose()


def get_policy_gate() -> PolicyGate:
    """Get or create PolicyGate instance."""
    global _policy_gate
    if _policy_gate is None:
        # Initialize with default settings
        # TODO: Load from config
        _policy_gate = PolicyGate(
            enable_code_execution=True,
            enable_network_access=True,
            enable_deployments=True,
            enable_billing=True,
        )
    return _policy_gate


async def get_budget_tracker(redis: Redis = Depends(get_redis)) -> BudgetTracker:
    """Get or create BudgetTracker instance."""
    return BudgetTracker(redis)


# Endpoints
@router.post("/check", response_model=PolicyDecision)
async def check_action(
    request: CheckActionRequest,
    policy_gate: PolicyGate = Depends(get_policy_gate),
) -> PolicyDecision:
    """
    Check if an action is allowed under current policies.

    Args:
        request: Action check request with action type and context

    Returns:
        Policy decision with allowed status and reasoning
    """
    try:
        logger.info("Checking action policy", action=request.action, context=request.context)
        decision = policy_gate.check_action(request.action, request.context)
        return decision

    except Exception as e:
        logger.error("Error checking action policy", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error checking action policy: {str(e)}",
        ) from e


@router.post("/budget/create", response_model=BudgetStatus, status_code=status.HTTP_201_CREATED)
async def create_budget(
    request: CreateBudgetRequest,
    tracker: BudgetTracker = Depends(get_budget_tracker),
) -> BudgetStatus:
    """
    Create a new budget for a run.

    Args:
        request: Budget creation request with run_id and limit

    Returns:
        Initial budget status
    """
    try:
        logger.info("Creating budget", run_id=request.run_id, limit=request.limit)
        budget_status = await tracker.create_budget(request.run_id, request.limit)
        return budget_status

    except ValueError as e:
        logger.warning("Invalid budget creation request", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
    except Exception as e:
        logger.error("Error creating budget", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error creating budget: {str(e)}",
        ) from e


@router.post("/budget/spend", response_model=BudgetStatus)
async def spend_budget(
    request: SpendBudgetRequest,
    tracker: BudgetTracker = Depends(get_budget_tracker),
) -> BudgetStatus:
    """
    Record spending against a budget.

    Args:
        request: Spend request with run_id and amount

    Returns:
        Updated budget status
    """
    try:
        logger.info("Recording spend", run_id=request.run_id, amount=request.amount)
        budget_status = await tracker.spend(request.run_id, request.amount)
        return budget_status

    except ValueError as e:
        logger.warning("Invalid spend request", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
    except Exception as e:
        logger.error("Error recording spend", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error recording spend: {str(e)}",
        ) from e


@router.get("/budget/{run_id}", response_model=BudgetStatus)
async def get_budget_status(
    run_id: str,
    tracker: BudgetTracker = Depends(get_budget_tracker),
) -> BudgetStatus:
    """
    Get current budget status for a run.

    Args:
        run_id: Unique identifier for the run

    Returns:
        Current budget status
    """
    try:
        logger.info("Getting budget status", run_id=run_id)
        budget_status = await tracker.get_status(run_id)
        return budget_status

    except ValueError as e:
        logger.warning("Budget not found", run_id=run_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Budget not found for run_id: {run_id}",
        ) from e
    except Exception as e:
        logger.error("Error getting budget status", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error getting budget status: {str(e)}",
        ) from e


@router.post("/budget/can-spend", response_model=CanSpendResponse)
async def can_spend(
    request: CanSpendRequest,
    tracker: BudgetTracker = Depends(get_budget_tracker),
) -> CanSpendResponse:
    """
    Check if a spend amount would exceed the budget.

    Args:
        request: Request with run_id and amount to check

    Returns:
        Response indicating if spending is allowed and current status
    """
    try:
        logger.info("Checking can spend", run_id=request.run_id, amount=request.amount)
        can_spend_result = await tracker.check_can_spend(request.run_id, request.amount)
        current_status = await tracker.get_status(request.run_id)

        return CanSpendResponse(
            can_spend=can_spend_result,
            current_status=current_status,
        )

    except ValueError as e:
        logger.warning("Budget not found", run_id=request.run_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Budget not found for run_id: {request.run_id}",
        ) from e
    except Exception as e:
        logger.error("Error checking can spend", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error checking can spend: {str(e)}",
        ) from e


@router.delete("/budget/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_budget(
    run_id: str,
    tracker: BudgetTracker = Depends(get_budget_tracker),
) -> None:
    """
    Delete a budget and all associated data.

    Args:
        run_id: Unique identifier for the run
    """
    try:
        logger.info("Deleting budget", run_id=run_id)
        await tracker.delete_budget(run_id)

    except Exception as e:
        logger.error("Error deleting budget", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error deleting budget: {str(e)}",
        ) from e
