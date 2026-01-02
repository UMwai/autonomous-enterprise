"""Budget tracking and enforcement for cost control."""


import structlog
from pydantic import BaseModel, Field
from redis.asyncio import Redis

logger = structlog.get_logger()


class BudgetStatus(BaseModel):
    """Status of a budget for a specific run."""

    run_id: str = Field(description="Unique identifier for the run")
    spent: float = Field(description="Amount spent so far in USD")
    limit: float = Field(description="Budget limit in USD")
    remaining: float = Field(description="Remaining budget in USD")
    exceeded: bool = Field(description="Whether budget has been exceeded")


class BudgetTracker:
    """Tracks and enforces spending budgets using Redis."""

    BUDGET_KEY_PREFIX = "budget:"
    SPENT_KEY_PREFIX = "spent:"
    EXCEEDED_KEY_PREFIX = "exceeded:"
    DEFAULT_TTL = 86400 * 7  # 7 days in seconds

    def __init__(self, redis_client: Redis):
        """
        Initialize budget tracker with Redis client.

        Args:
            redis_client: Redis client for tracking budget state
        """
        self.redis = redis_client

    async def create_budget(self, run_id: str, limit: float) -> BudgetStatus:
        """
        Create a new budget for a run.

        Args:
            run_id: Unique identifier for the run
            limit: Budget limit in USD

        Returns:
            Initial budget status

        Raises:
            ValueError: If budget limit is invalid
        """
        if limit <= 0:
            raise ValueError(f"Budget limit must be positive, got {limit}")

        logger.info("Creating budget", run_id=run_id, limit=limit)

        # Set budget limit
        budget_key = f"{self.BUDGET_KEY_PREFIX}{run_id}"
        await self.redis.set(budget_key, str(limit), ex=self.DEFAULT_TTL)

        # Initialize spent to 0
        spent_key = f"{self.SPENT_KEY_PREFIX}{run_id}"
        await self.redis.set(spent_key, "0", ex=self.DEFAULT_TTL)

        # Set exceeded flag to false
        exceeded_key = f"{self.EXCEEDED_KEY_PREFIX}{run_id}"
        await self.redis.set(exceeded_key, "0", ex=self.DEFAULT_TTL)

        return BudgetStatus(
            run_id=run_id,
            spent=0.0,
            limit=limit,
            remaining=limit,
            exceeded=False,
        )

    async def spend(self, run_id: str, amount: float) -> BudgetStatus:
        """
        Record spending against a budget.

        Args:
            run_id: Unique identifier for the run
            amount: Amount to spend in USD

        Returns:
            Updated budget status

        Raises:
            ValueError: If amount is negative or budget doesn't exist
        """
        if amount < 0:
            raise ValueError(f"Amount must be non-negative, got {amount}")

        logger.info("Recording spend", run_id=run_id, amount=amount)

        # Check if budget exists
        budget_key = f"{self.BUDGET_KEY_PREFIX}{run_id}"
        limit_str = await self.redis.get(budget_key)

        if limit_str is None:
            raise ValueError(f"Budget not found for run_id: {run_id}")

        limit = float(limit_str)

        # Increment spent amount atomically
        spent_key = f"{self.SPENT_KEY_PREFIX}{run_id}"
        spent = float(await self.redis.incrbyfloat(spent_key, amount))

        # Check if budget exceeded
        exceeded = spent > limit
        remaining = max(0.0, limit - spent)

        # Update exceeded flag if necessary
        if exceeded:
            exceeded_key = f"{self.EXCEEDED_KEY_PREFIX}{run_id}"
            await self.redis.set(exceeded_key, "1")
            logger.warning(
                "Budget exceeded",
                run_id=run_id,
                spent=spent,
                limit=limit,
                exceeded_by=spent - limit,
            )

        return BudgetStatus(
            run_id=run_id,
            spent=spent,
            limit=limit,
            remaining=remaining,
            exceeded=exceeded,
        )

    async def get_status(self, run_id: str) -> BudgetStatus:
        """
        Get current budget status for a run.

        Args:
            run_id: Unique identifier for the run

        Returns:
            Current budget status

        Raises:
            ValueError: If budget doesn't exist
        """
        budget_key = f"{self.BUDGET_KEY_PREFIX}{run_id}"
        spent_key = f"{self.SPENT_KEY_PREFIX}{run_id}"
        exceeded_key = f"{self.EXCEEDED_KEY_PREFIX}{run_id}"

        # Get all values with pipeline for efficiency
        async with self.redis.pipeline() as pipe:
            pipe.get(budget_key)
            pipe.get(spent_key)
            pipe.get(exceeded_key)
            results = await pipe.execute()

        limit_str, spent_str, exceeded_str = results

        if limit_str is None:
            raise ValueError(f"Budget not found for run_id: {run_id}")

        limit = float(limit_str)
        spent = float(spent_str or "0")
        exceeded = exceeded_str == b"1" if isinstance(exceeded_str, bytes) else exceeded_str == "1"
        remaining = max(0.0, limit - spent)

        return BudgetStatus(
            run_id=run_id,
            spent=spent,
            limit=limit,
            remaining=remaining,
            exceeded=exceeded,
        )

    async def check_can_spend(self, run_id: str, amount: float) -> bool:
        """
        Check if a spend amount would exceed the budget.

        Args:
            run_id: Unique identifier for the run
            amount: Amount to check in USD

        Returns:
            True if the spend would be within budget
        """
        try:
            status = await self.get_status(run_id)

            # If already exceeded, no more spending allowed
            if status.exceeded:
                logger.warning("Budget already exceeded", run_id=run_id)
                return False

            # Check if this spend would exceed budget
            would_exceed = (status.spent + amount) > status.limit

            if would_exceed:
                logger.warning(
                    "Spend would exceed budget",
                    run_id=run_id,
                    amount=amount,
                    spent=status.spent,
                    limit=status.limit,
                )

            return not would_exceed

        except ValueError as e:
            logger.error("Error checking budget", run_id=run_id, error=str(e))
            return False

    async def delete_budget(self, run_id: str) -> None:
        """
        Delete a budget and all associated data.

        Args:
            run_id: Unique identifier for the run
        """
        logger.info("Deleting budget", run_id=run_id)

        budget_key = f"{self.BUDGET_KEY_PREFIX}{run_id}"
        spent_key = f"{self.SPENT_KEY_PREFIX}{run_id}"
        exceeded_key = f"{self.EXCEEDED_KEY_PREFIX}{run_id}"

        await self.redis.delete(budget_key, spent_key, exceeded_key)
