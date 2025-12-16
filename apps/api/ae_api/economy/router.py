"""Model router for intelligent LLM selection and cost optimization."""

from collections import defaultdict
from enum import Enum
from typing import TYPE_CHECKING

from pydantic import BaseModel, Field

from ae_api.config import Settings

if TYPE_CHECKING:
    from ae_api.economy.classifier import ClassificationResult, SemanticClassifier


class ModelTier(str, Enum):
    """Model tiers representing capability and cost levels."""

    TIER1_ARCHITECT = "TIER1"  # Highest capability, highest cost
    TIER2_BUILDER = "TIER2"    # Medium capability, medium cost
    TIER3_INTERN = "TIER3"     # Lower capability, lowest cost


class RoutingDecision(BaseModel):
    """Decision about which model to use for a task."""

    tier: ModelTier = Field(
        ..., description="Selected model tier"
    )
    model_id: str = Field(
        ..., description="Specific model identifier"
    )
    provider: str = Field(
        ..., description="LLM provider (openai, anthropic, google)"
    )
    estimated_cost: float = Field(
        ..., description="Estimated cost in USD for this task"
    )
    reasoning: str = Field(
        ..., description="Explanation of routing decision"
    )
    classification: "ClassificationResult | None" = Field(
        default=None, description="Task classification result"
    )


class ModelRouter:
    """Routes tasks to appropriate models based on complexity and cost."""

    # Model tier configurations (Premium models - heavily subsidized)
    TIER_CONFIG = {
        ModelTier.TIER1_ARCHITECT: {
            "models": [
                {"provider": "anthropic", "model": "claude-opus-4-5-20251101"},
                {"provider": "openai", "model": "gpt-5.2-xhigh"},
            ],
            "use_cases": [
                "Architecture design and system planning",
                "Complex debugging and root cause analysis",
                "Security reviews and vulnerability assessment",
                "Performance optimization and profiling",
                "Sensitive operations (deployments, deletions)",
            ],
        },
        ModelTier.TIER2_BUILDER: {
            "models": [
                {"provider": "openai", "model": "gpt-5.2-xhigh"},
                {"provider": "google", "model": "gemini-3-pro-preview"},
            ],
            "use_cases": [
                "Feature implementation",
                "Writing tests and documentation",
                "API integration",
                "Code refactoring",
                "Standard CRUD operations",
            ],
        },
        ModelTier.TIER3_INTERN: {
            "models": [
                {"provider": "google", "model": "gemini-3-pro-preview"},
                {"provider": "anthropic", "model": "claude-opus-4-5-20251101"},
            ],
            "use_cases": [
                "Code formatting and linting",
                "Simple data transformations",
                "Template generation",
                "Basic queries and lookups",
                "File conversions",
            ],
        },
    }

    # Pricing per 1M tokens (input, output) in USD
    # Note: Premium models - heavily subsidized for maximum intelligence
    PRICING = {
        "anthropic": {
            "claude-opus-4-5-20251101": (15.0, 75.0),  # Opus 4.5 - maximum capability
            "claude-3-5-sonnet-20241022": (3.0, 15.0),
            "claude-3-5-haiku-20241022": (0.8, 4.0),
        },
        "openai": {
            "gpt-5.2-xhigh": (20.0, 80.0),  # GPT-5.2 xhigh - maximum capability
            "gpt-4o": (2.5, 10.0),
            "gpt-4o-mini": (0.15, 0.6),
        },
        "google": {
            "gemini-3-pro-preview": (10.0, 40.0),  # Gemini 3 Pro - maximum capability
            "gemini-1.5-pro": (1.25, 5.0),
            "gemini-1.5-flash": (0.075, 0.3),
        },
    }

    def __init__(self, settings: Settings, classifier: "SemanticClassifier"):
        """Initialize the model router.

        Args:
            settings: Application settings
            classifier: Task classifier instance
        """
        self.settings = settings
        self.classifier = classifier

        # Track budget usage per run
        self._run_budgets: dict[str, float] = defaultdict(float)

    def get_model_for_tier(self, tier: ModelTier) -> tuple[str, str]:
        """Get the primary model for a tier.

        Args:
            tier: Model tier

        Returns:
            Tuple of (provider, model_id)
        """
        config = self.TIER_CONFIG.get(tier)
        if not config or not config["models"]:
            raise ValueError(f"No models configured for tier {tier}")

        # Use settings-configured models if available
        if tier == ModelTier.TIER1_ARCHITECT:
            model_id = self.settings.tier1_model
        elif tier == ModelTier.TIER2_BUILDER:
            model_id = self.settings.tier2_model
        elif tier == ModelTier.TIER3_INTERN:
            model_id = self.settings.tier3_model
        else:
            # Fallback to first configured model
            primary = config["models"][0]
            return primary["provider"], primary["model"]

        # Find provider for configured model
        for model_config in config["models"]:
            if model_config["model"] == model_id:
                return model_config["provider"], model_id

        # If not found, use first model
        primary = config["models"][0]
        return primary["provider"], primary["model"]

    def estimate_cost(
        self,
        prompt: str,
        tier: ModelTier,
        estimated_output_tokens: int = 1000
    ) -> float:
        """Estimate the cost of a task.

        Args:
            prompt: Task prompt
            tier: Model tier to use
            estimated_output_tokens: Estimated output token count

        Returns:
            Estimated cost in USD
        """
        provider, model_id = self.get_model_for_tier(tier)

        # Get pricing for model
        pricing = self.PRICING.get(provider, {}).get(model_id)
        if not pricing:
            # Default pricing if not found
            pricing = (1.0, 5.0)

        input_price, output_price = pricing

        # Rough token estimation (4 chars per token)
        estimated_input_tokens = len(prompt) / 4

        # Calculate cost
        input_cost = (estimated_input_tokens / 1_000_000) * input_price
        output_cost = (estimated_output_tokens / 1_000_000) * output_price

        return input_cost + output_cost

    def enforce_budget(self, run_id: str, cost: float) -> bool:
        """Check if a cost would exceed the run budget.

        Args:
            run_id: Unique run identifier
            cost: Cost to check

        Returns:
            True if within budget, False if would exceed
        """
        current_usage = self._run_budgets.get(run_id, 0.0)
        budget = self.settings.default_run_budget

        if current_usage + cost > budget:
            return False

        return True

    def record_usage(self, run_id: str, cost: float) -> None:
        """Record cost usage for a run.

        Args:
            run_id: Unique run identifier
            cost: Cost to record
        """
        self._run_budgets[run_id] += cost

    def get_run_usage(self, run_id: str) -> float:
        """Get current usage for a run.

        Args:
            run_id: Unique run identifier

        Returns:
            Current cost usage in USD
        """
        return self._run_budgets.get(run_id, 0.0)

    def reset_run_budget(self, run_id: str) -> None:
        """Reset budget tracking for a run.

        Args:
            run_id: Unique run identifier
        """
        if run_id in self._run_budgets:
            del self._run_budgets[run_id]

    async def route(
        self,
        prompt: str,
        context: dict | None = None,
        override_tier: ModelTier | None = None,
        run_id: str | None = None,
    ) -> RoutingDecision:
        """Route a task to the appropriate model.

        Args:
            prompt: Task prompt
            context: Optional additional context
            override_tier: Optional tier override (skip classification)
            run_id: Optional run ID for budget tracking

        Returns:
            RoutingDecision with selected model and reasoning
        """
        classification = None

        # Classify task if no override provided
        if override_tier is None:
            classification = await self.classifier.classify(prompt, context)
            tier_name = classification.suggested_tier
            tier = ModelTier(tier_name)
            reasoning = f"Classification: {classification.reasoning}"
        else:
            tier = override_tier
            reasoning = f"Manual override to {tier.value}"

        # Get model for tier
        provider, model_id = self.get_model_for_tier(tier)

        # Estimate cost
        estimated_cost = self.estimate_cost(prompt, tier)

        # Check budget if run_id provided
        if run_id:
            if not self.enforce_budget(run_id, estimated_cost):
                # Downgrade to cheaper tier if budget exceeded
                usage = self.get_run_usage(run_id)
                budget = self.settings.default_run_budget
                reasoning += f" [Budget check: ${usage:.4f} used of ${budget:.2f} budget. "

                # Try to downgrade
                if tier == ModelTier.TIER1_ARCHITECT:
                    tier = ModelTier.TIER2_BUILDER
                    reasoning += "Downgraded from TIER1 to TIER2]"
                elif tier == ModelTier.TIER2_BUILDER:
                    tier = ModelTier.TIER3_INTERN
                    reasoning += "Downgraded from TIER2 to TIER3]"
                else:
                    reasoning += "Already at lowest tier]"

                # Recalculate with new tier
                provider, model_id = self.get_model_for_tier(tier)
                estimated_cost = self.estimate_cost(prompt, tier)

        return RoutingDecision(
            tier=tier,
            model_id=model_id,
            provider=provider,
            estimated_cost=estimated_cost,
            reasoning=reasoning,
            classification=classification,
        )

    def get_tier_info(self) -> dict[str, dict]:
        """Get information about all tiers.

        Returns:
            Dictionary mapping tier names to their configuration
        """
        result = {}
        for tier, config in self.TIER_CONFIG.items():
            result[tier.value] = {
                "models": config["models"],
                "use_cases": config["use_cases"],
                "default_model": self.get_model_for_tier(tier),
            }
        return result
