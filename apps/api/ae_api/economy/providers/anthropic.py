"""Anthropic provider implementation."""

from langchain_anthropic import ChatAnthropic

from ae_api.config import Settings
from ae_api.economy.providers.base import BaseProvider, CompletionResponse


class AnthropicProvider(BaseProvider):
    """Anthropic LLM provider."""

    # Pricing per 1M tokens (input, output) in USD
    # Premium models enabled - heavily subsidized for maximum intelligence
    PRICING = {
        "claude-opus-4-5-20251101": (15.0, 75.0),  # Opus 4.5 - maximum capability
        "claude-sonnet-4-20250514": (3.0, 15.0),   # Sonnet 4
        "claude-3-5-sonnet-20241022": (3.0, 15.0),
        "claude-3-5-haiku-20241022": (0.8, 4.0),
        "claude-3-opus-20240229": (15.0, 75.0),
        "claude-3-sonnet-20240229": (3.0, 15.0),
        "claude-3-haiku-20240307": (0.25, 1.25),
    }

    def __init__(self, settings: Settings):
        """Initialize Anthropic provider.

        Args:
            settings: Application settings
        """
        self.settings = settings

        if not settings.anthropic_api_key:
            raise ValueError("Anthropic API key not configured")

        self._api_key = settings.anthropic_api_key.get_secret_value()

    async def complete(
        self,
        prompt: str,
        model: str,
        temperature: float = 0.7,
        max_tokens: int = 2000,
        **kwargs
    ) -> CompletionResponse:
        """Generate a completion using Anthropic Claude.

        Args:
            prompt: Input prompt
            model: Claude model identifier
            temperature: Sampling temperature
            max_tokens: Maximum tokens to generate
            **kwargs: Additional Anthropic-specific parameters

        Returns:
            CompletionResponse with generated content
        """
        llm = ChatAnthropic(
            model=model,
            api_key=self._api_key,
            temperature=temperature,
            max_tokens=max_tokens,
            **kwargs
        )

        response = await llm.ainvoke(prompt)

        # Extract content and metadata
        content = response.content if hasattr(response, 'content') else str(response)

        # Get usage information
        usage = {}
        if hasattr(response, 'response_metadata'):
            usage_data = response.response_metadata.get('usage', {})
            usage = {
                'input_tokens': usage_data.get('input_tokens', 0),
                'output_tokens': usage_data.get('output_tokens', 0),
                'total_tokens': usage_data.get('input_tokens', 0) + usage_data.get('output_tokens', 0),
            }

        # Calculate cost
        cost = self.calculate_cost(
            usage.get('input_tokens', 0),
            usage.get('output_tokens', 0),
            model
        )

        return CompletionResponse(
            content=content,
            model=model,
            provider="anthropic",
            usage=usage,
            cost=cost,
            metadata={
                'temperature': temperature,
                'max_tokens': max_tokens,
            }
        )

    def get_pricing(self, model: str) -> tuple[float, float]:
        """Get pricing for an Anthropic model.

        Args:
            model: Model identifier

        Returns:
            Tuple of (input_price, output_price) per 1M tokens in USD
        """
        return self.PRICING.get(model, (3.0, 15.0))  # Default to Sonnet pricing
