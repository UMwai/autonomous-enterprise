"""Human-in-the-loop approval API endpoints."""

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from redis.asyncio import Redis

from ae_api.safety.approvals import (
    ApprovalDecision,
    ApprovalQueue,
    ApprovalRequest,
    CreateApprovalRequest,
)

logger = structlog.get_logger()
router = APIRouter()


# Dependency injection for Redis client
async def get_redis() -> Redis:
    """Get Redis client for approval queue."""
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


async def get_approval_queue(redis: Redis = Depends(get_redis)) -> ApprovalQueue:
    """Get or create ApprovalQueue instance."""
    return ApprovalQueue(redis)


# Endpoints
@router.post("/", response_model=ApprovalRequest, status_code=status.HTTP_201_CREATED)
async def create_approval(
    request: CreateApprovalRequest,
    queue: ApprovalQueue = Depends(get_approval_queue),
) -> ApprovalRequest:
    """
    Create a new approval request.

    Args:
        request: Approval creation request

    Returns:
        Created approval request

    Raises:
        HTTPException: If approval already exists or creation fails
    """
    try:
        logger.info(
            "Creating approval via API",
            action_id=request.action_id,
            action_type=request.action_type,
        )
        approval = await queue.create_approval(request)
        return approval

    except ValueError as e:
        logger.warning("Invalid approval creation request", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
    except Exception as e:
        logger.error("Error creating approval", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error creating approval: {str(e)}",
        ) from e


@router.get("/{action_id}", response_model=ApprovalRequest)
async def get_approval(
    action_id: str,
    queue: ApprovalQueue = Depends(get_approval_queue),
) -> ApprovalRequest:
    """
    Get an approval request by action ID.

    Args:
        action_id: Unique identifier for the action

    Returns:
        Approval request

    Raises:
        HTTPException: If approval doesn't exist
    """
    try:
        logger.info("Getting approval via API", action_id=action_id)
        approval = await queue.get_approval(action_id)
        return approval

    except ValueError as e:
        logger.warning("Approval not found", action_id=action_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Approval not found for action_id: {action_id}",
        ) from e
    except Exception as e:
        logger.error("Error getting approval", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error getting approval: {str(e)}",
        ) from e


@router.get("/", response_model=list[ApprovalRequest])
async def list_pending_approvals(
    run_id: str | None = Query(None, description="Filter by workflow run ID"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum number of approvals to return"),
    queue: ApprovalQueue = Depends(get_approval_queue),
) -> list[ApprovalRequest]:
    """
    List pending approval requests.

    Args:
        run_id: Optional filter by workflow run ID
        limit: Maximum number of approvals to return (1-1000)

    Returns:
        List of pending approval requests
    """
    try:
        logger.info("Listing pending approvals via API", run_id=run_id, limit=limit)
        approvals = await queue.list_pending_approvals(run_id=run_id, limit=limit)
        return approvals

    except Exception as e:
        logger.error("Error listing approvals", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error listing approvals: {str(e)}",
        ) from e


@router.post("/{action_id}/decide", response_model=ApprovalRequest)
async def decide_approval(
    action_id: str,
    decision: ApprovalDecision,
    queue: ApprovalQueue = Depends(get_approval_queue),
) -> ApprovalRequest:
    """
    Make a decision on an approval request (approve or reject).

    Args:
        action_id: Unique identifier for the action
        decision: Approval decision with approved flag and reason

    Returns:
        Updated approval request

    Raises:
        HTTPException: If approval doesn't exist or is not pending
    """
    try:
        logger.info(
            "Deciding approval via API",
            action_id=action_id,
            approved=decision.approved,
            decided_by=decision.decided_by,
        )
        approval = await queue.decide_approval(action_id, decision)
        return approval

    except ValueError as e:
        logger.warning("Invalid approval decision", action_id=action_id, error=str(e))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
    except Exception as e:
        logger.error("Error deciding approval", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error deciding approval: {str(e)}",
        ) from e


@router.post("/{action_id}/cancel", response_model=ApprovalRequest)
async def cancel_approval(
    action_id: str,
    reason: str | None = Query(None, description="Reason for cancellation"),
    queue: ApprovalQueue = Depends(get_approval_queue),
) -> ApprovalRequest:
    """
    Cancel a pending approval request.

    Args:
        action_id: Unique identifier for the action
        reason: Optional reason for cancellation

    Returns:
        Updated approval request

    Raises:
        HTTPException: If approval doesn't exist or is not pending
    """
    try:
        logger.info("Cancelling approval via API", action_id=action_id, reason=reason)
        approval = await queue.cancel_approval(action_id, reason)
        return approval

    except ValueError as e:
        logger.warning("Invalid approval cancellation", action_id=action_id, error=str(e))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
    except Exception as e:
        logger.error("Error cancelling approval", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error cancelling approval: {str(e)}",
        ) from e


@router.post("/cleanup", status_code=status.HTTP_200_OK)
async def cleanup_expired_approvals(
    queue: ApprovalQueue = Depends(get_approval_queue),
) -> dict[str, int]:
    """
    Clean up expired approval requests from the pending set.

    This is a maintenance endpoint that should be called periodically
    (e.g., via cron job or scheduled task).

    Returns:
        Dictionary with count of cleaned up approvals
    """
    try:
        logger.info("Cleaning up expired approvals via API")
        count = await queue.cleanup_expired_approvals()
        return {"cleaned_up": count}

    except Exception as e:
        logger.error("Error cleaning up approvals", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error cleaning up approvals: {str(e)}",
        ) from e
