"""Base provider interface for LLM providers."""

from abc import ABC, abstractmethod

from pydantic import BaseModel, Field


class CompletionResponse(BaseModel):
    """Response from LLM completion."""

    content: str = Field(
        ..., description="Generated text content"
    )
    model: str = Field(
        ..., description="Model used for generation"
    )
    provider: str = Field(
        ..., description="Provider name"
    )
    usage: dict[str, int] = Field(
        default_factory=dict,
        description="Token usage statistics"
    )
    cost: float = Field(
        default=0.0,
        description="Actual cost in USD"
    )
    metadata: dict = Field(
        default_factory=dict,
        description="Additional metadata from provider"
    )


class BaseProvider(ABC):
    """Abstract base class for LLM providers."""

    @abstractmethod
    async def complete(
        self,
        prompt: str,
        model: str,
        temperature: float = 0.7,
        max_tokens: int = 2000,
        **kwargs
    ) -> CompletionResponse:
        """Generate a completion for the given prompt.

        Args:
            prompt: Input prompt
            model: Model identifier
            temperature: Sampling temperature
            max_tokens: Maximum tokens to generate
            **kwargs: Additional provider-specific parameters

        Returns:
            CompletionResponse with generated content and metadata
        """
        pass

    @abstractmethod
    def get_pricing(self, model: str) -> tuple[float, float]:
        """Get pricing for a model.

        Args:
            model: Model identifier

        Returns:
            Tuple of (input_price_per_1m_tokens, output_price_per_1m_tokens) in USD
        """
        pass

    def calculate_cost(
        self,
        input_tokens: int,
        output_tokens: int,
        model: str
    ) -> float:
        """Calculate cost for token usage.

        Args:
            input_tokens: Number of input tokens
            output_tokens: Number of output tokens
            model: Model identifier

        Returns:
            Cost in USD
        """
        input_price, output_price = self.get_pricing(model)

        input_cost = (input_tokens / 1_000_000) * input_price
        output_cost = (output_tokens / 1_000_000) * output_price

        return input_cost + output_cost
