"""Human-in-the-loop approval gateway for sensitive actions."""

import asyncio
import time
from enum import Enum
from typing import Any

import structlog
from pydantic import BaseModel, Field
from redis.asyncio import Redis

logger = structlog.get_logger()


class ApprovalStatus(str, Enum):
    """Status of an approval request."""

    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class ApprovalRequest(BaseModel):
    """Full approval request with metadata."""

    action_id: str = Field(description="Unique identifier for the action")
    action_type: str = Field(description="Type of action requiring approval")
    description: str = Field(description="Human-readable description of the action")
    context: dict[str, Any] = Field(
        default_factory=dict, description="Additional context for the decision"
    )
    run_id: str = Field(description="Workflow run ID that requested this action")
    requested_by: str = Field(description="Agent or service that requested approval")
    requested_at: float = Field(description="Unix timestamp when approval was requested")
    status: ApprovalStatus = Field(description="Current status of the approval")
    decided_at: float | None = Field(
        default=None, description="Unix timestamp when decision was made"
    )
    decided_by: str | None = Field(default=None, description="User who made the decision")
    decision_reason: str | None = Field(
        default=None, description="Reason for approval/rejection"
    )
    expires_at: float = Field(description="Unix timestamp when approval expires")
    timeout_seconds: int = Field(
        default=3600, description="Timeout duration in seconds"
    )


class CreateApprovalRequest(BaseModel):
    """Request to create a new approval."""

    action_id: str = Field(description="Unique identifier for the action")
    action_type: str = Field(description="Type of action requiring approval")
    description: str = Field(description="Human-readable description of the action")
    context: dict[str, Any] = Field(
        default_factory=dict, description="Additional context for the decision"
    )
    run_id: str = Field(description="Workflow run ID that requested this action")
    requested_by: str = Field(
        default="temporal-worker", description="Agent or service requesting approval"
    )
    timeout_seconds: int = Field(
        default=3600,
        ge=60,
        le=86400,
        description="Timeout in seconds (min: 60, max: 86400)",
    )


class ApprovalDecision(BaseModel):
    """Decision on an approval request."""

    approved: bool = Field(description="Whether the action was approved")
    reason: str | None = Field(
        default=None, description="Reason for approval/rejection"
    )
    decided_by: str = Field(description="User who made the decision")


class ApprovalQueue:
    """Manages approval requests using Redis as the backend."""

    APPROVAL_KEY_PREFIX = "approval:"
    PENDING_SET_KEY = "approvals:pending"
    APPROVAL_TTL = 86400 * 7  # 7 days in seconds

    def __init__(self, redis_client: Redis):
        """
        Initialize approval queue with Redis client.

        Args:
            redis_client: Redis client for storing approval state
        """
        self.redis = redis_client

    async def create_approval(
        self, request: CreateApprovalRequest
    ) -> ApprovalRequest:
        """
        Create a new approval request.

        Args:
            request: Approval creation request

        Returns:
            Created approval request

        Raises:
            ValueError: If approval already exists
        """
        logger.info(
            "Creating approval request",
            action_id=request.action_id,
            action_type=request.action_type,
            run_id=request.run_id,
        )

        # Check if approval already exists
        approval_key = f"{self.APPROVAL_KEY_PREFIX}{request.action_id}"
        exists = await self.redis.exists(approval_key)

        if exists:
            raise ValueError(f"Approval already exists for action_id: {request.action_id}")

        now = time.time()
        expires_at = now + request.timeout_seconds

        approval = ApprovalRequest(
            action_id=request.action_id,
            action_type=request.action_type,
            description=request.description,
            context=request.context,
            run_id=request.run_id,
            requested_by=request.requested_by,
            requested_at=now,
            status=ApprovalStatus.PENDING,
            expires_at=expires_at,
            timeout_seconds=request.timeout_seconds,
        )

        # Store approval in Redis
        await self.redis.set(
            approval_key,
            approval.model_dump_json(),
            ex=self.APPROVAL_TTL,
        )

        # Add to pending set with expiration score
        await self.redis.zadd(
            self.PENDING_SET_KEY,
            {request.action_id: expires_at},
        )

        logger.info(
            "Approval request created",
            action_id=request.action_id,
            expires_at=expires_at,
            timeout_seconds=request.timeout_seconds,
        )

        return approval

    async def get_approval(self, action_id: str) -> ApprovalRequest:
        """
        Get an approval request by action ID.

        Args:
            action_id: Unique identifier for the action

        Returns:
            Approval request

        Raises:
            ValueError: If approval doesn't exist
        """
        approval_key = f"{self.APPROVAL_KEY_PREFIX}{action_id}"
        approval_json = await self.redis.get(approval_key)

        if approval_json is None:
            raise ValueError(f"Approval not found for action_id: {action_id}")

        approval = ApprovalRequest.model_validate_json(approval_json)

        # Check if expired
        if approval.status == ApprovalStatus.PENDING and time.time() > approval.expires_at:
            approval.status = ApprovalStatus.EXPIRED
            # Update in Redis
            await self.redis.set(
                approval_key,
                approval.model_dump_json(),
                ex=self.APPROVAL_TTL,
            )
            # Remove from pending set
            await self.redis.zrem(self.PENDING_SET_KEY, action_id)

            logger.warning("Approval request expired", action_id=action_id)

        return approval

    async def list_pending_approvals(
        self, run_id: str | None = None, limit: int = 100
    ) -> list[ApprovalRequest]:
        """
        List pending approval requests.

        Args:
            run_id: Optional filter by workflow run ID
            limit: Maximum number of approvals to return

        Returns:
            List of pending approval requests
        """
        logger.info("Listing pending approvals", run_id=run_id, limit=limit)

        # Get all pending action IDs sorted by expiration time
        pending_ids = await self.redis.zrange(
            self.PENDING_SET_KEY,
            0,
            limit - 1,
            withscores=False,
        )

        if not pending_ids:
            return []

        # Fetch all approvals
        approvals: list[ApprovalRequest] = []
        for action_id in pending_ids:
            try:
                approval = await self.get_approval(action_id)

                # Filter by run_id if specified
                if run_id is None or approval.run_id == run_id:
                    # Only include if still pending
                    if approval.status == ApprovalStatus.PENDING:
                        approvals.append(approval)

            except ValueError:
                # Approval no longer exists, remove from set
                await self.redis.zrem(self.PENDING_SET_KEY, action_id)
                continue

        return approvals

    async def decide_approval(
        self, action_id: str, decision: ApprovalDecision
    ) -> ApprovalRequest:
        """
        Make a decision on an approval request.

        Args:
            action_id: Unique identifier for the action
            decision: Approval decision

        Returns:
            Updated approval request

        Raises:
            ValueError: If approval doesn't exist or is not pending
        """
        logger.info(
            "Deciding approval",
            action_id=action_id,
            approved=decision.approved,
            decided_by=decision.decided_by,
        )

        approval = await self.get_approval(action_id)

        # Check if already decided or expired
        if approval.status != ApprovalStatus.PENDING:
            raise ValueError(
                f"Approval is not pending (status: {approval.status})"
            )

        # Update approval
        approval.status = (
            ApprovalStatus.APPROVED if decision.approved else ApprovalStatus.REJECTED
        )
        approval.decided_at = time.time()
        approval.decided_by = decision.decided_by
        approval.decision_reason = decision.reason

        # Store updated approval
        approval_key = f"{self.APPROVAL_KEY_PREFIX}{action_id}"
        await self.redis.set(
            approval_key,
            approval.model_dump_json(),
            ex=self.APPROVAL_TTL,
        )

        # Remove from pending set
        await self.redis.zrem(self.PENDING_SET_KEY, action_id)

        logger.info(
            "Approval decided",
            action_id=action_id,
            status=approval.status,
            decided_by=decision.decided_by,
        )

        return approval

    async def wait_for_approval(
        self,
        action_id: str,
        poll_interval: int = 5,
        timeout_override: int | None = None,
    ) -> ApprovalRequest:
        """
        Wait for an approval decision with polling.

        Args:
            action_id: Unique identifier for the action
            poll_interval: Seconds between polling attempts
            timeout_override: Override the approval's timeout (for testing)

        Returns:
            Approval request with final decision

        Raises:
            ValueError: If approval doesn't exist
            TimeoutError: If approval expires before decision
        """
        logger.info(
            "Waiting for approval decision",
            action_id=action_id,
            poll_interval=poll_interval,
        )

        approval = await self.get_approval(action_id)
        timeout = timeout_override or approval.timeout_seconds
        start_time = time.time()

        while True:
            # Check if timeout exceeded
            if time.time() - start_time > timeout:
                # Mark as expired
                approval.status = ApprovalStatus.EXPIRED
                approval_key = f"{self.APPROVAL_KEY_PREFIX}{action_id}"
                await self.redis.set(
                    approval_key,
                    approval.model_dump_json(),
                    ex=self.APPROVAL_TTL,
                )
                await self.redis.zrem(self.PENDING_SET_KEY, action_id)

                logger.warning("Approval timeout exceeded", action_id=action_id)
                raise TimeoutError(
                    f"Approval timeout exceeded for action_id: {action_id}"
                )

            # Refresh approval status
            approval = await self.get_approval(action_id)

            # Check if decision was made
            if approval.status in (
                ApprovalStatus.APPROVED,
                ApprovalStatus.REJECTED,
                ApprovalStatus.CANCELLED,
                ApprovalStatus.EXPIRED,
            ):
                logger.info(
                    "Approval decision received",
                    action_id=action_id,
                    status=approval.status,
                )
                return approval

            # Wait before next poll
            await asyncio.sleep(poll_interval)

    async def cancel_approval(self, action_id: str, reason: str | None = None) -> ApprovalRequest:
        """
        Cancel a pending approval request.

        Args:
            action_id: Unique identifier for the action
            reason: Optional reason for cancellation

        Returns:
            Updated approval request

        Raises:
            ValueError: If approval doesn't exist or is not pending
        """
        logger.info("Cancelling approval", action_id=action_id, reason=reason)

        approval = await self.get_approval(action_id)

        if approval.status != ApprovalStatus.PENDING:
            raise ValueError(
                f"Approval is not pending (status: {approval.status})"
            )

        # Update approval
        approval.status = ApprovalStatus.CANCELLED
        approval.decided_at = time.time()
        approval.decision_reason = reason or "Cancelled by system"

        # Store updated approval
        approval_key = f"{self.APPROVAL_KEY_PREFIX}{action_id}"
        await self.redis.set(
            approval_key,
            approval.model_dump_json(),
            ex=self.APPROVAL_TTL,
        )

        # Remove from pending set
        await self.redis.zrem(self.PENDING_SET_KEY, action_id)

        logger.info("Approval cancelled", action_id=action_id)
        return approval

    async def cleanup_expired_approvals(self) -> int:
        """
        Clean up expired approval requests from the pending set.

        Returns:
            Number of expired approvals cleaned up
        """
        logger.info("Cleaning up expired approvals")

        now = time.time()

        # Get all expired action IDs (score < now)
        expired_ids = await self.redis.zrangebyscore(
            self.PENDING_SET_KEY,
            min=0,
            max=now,
        )

        if not expired_ids:
            return 0

        # Mark each as expired and remove from pending set
        count = 0
        for action_id in expired_ids:
            try:
                approval = await self.get_approval(action_id)

                if approval.status == ApprovalStatus.PENDING:
                    approval.status = ApprovalStatus.EXPIRED
                    approval_key = f"{self.APPROVAL_KEY_PREFIX}{action_id}"
                    await self.redis.set(
                        approval_key,
                        approval.model_dump_json(),
                        ex=self.APPROVAL_TTL,
                    )

                # Remove from pending set
                await self.redis.zrem(self.PENDING_SET_KEY, action_id)
                count += 1

            except ValueError:
                # Approval no longer exists, just remove from set
                await self.redis.zrem(self.PENDING_SET_KEY, action_id)
                continue

        logger.info("Expired approvals cleaned up", count=count)
        return count
