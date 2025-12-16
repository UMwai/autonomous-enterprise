"""OpenAI provider implementation."""

from langchain_openai import ChatOpenAI

from ae_api.config import Settings
from ae_api.economy.providers.base import BaseProvider, CompletionResponse


class OpenAIProvider(BaseProvider):
    """OpenAI LLM provider."""

    # Pricing per 1M tokens (input, output) in USD
    # Premium models enabled - heavily subsidized for maximum intelligence
    PRICING = {
        "gpt-5.2-xhigh": (20.0, 80.0),    # GPT-5.2 xhigh - maximum capability
        "gpt-5.2": (15.0, 60.0),           # GPT-5.2 standard
        "o3": (30.0, 120.0),               # O3 reasoning model
        "o4-mini": (5.0, 20.0),            # O4-mini reasoning
        "gpt-4o": (2.5, 10.0),
        "gpt-4o-mini": (0.15, 0.6),
        "gpt-4-turbo": (10.0, 30.0),
        "gpt-4": (30.0, 60.0),
        "gpt-3.5-turbo": (0.5, 1.5),
    }

    def __init__(self, settings: Settings):
        """Initialize OpenAI provider.

        Args:
            settings: Application settings
        """
        self.settings = settings

        if not settings.openai_api_key:
            raise ValueError("OpenAI API key not configured")

        self._api_key = settings.openai_api_key.get_secret_value()

    async def complete(
        self,
        prompt: str,
        model: str,
        temperature: float = 0.7,
        max_tokens: int = 2000,
        **kwargs
    ) -> CompletionResponse:
        """Generate a completion using OpenAI.

        Args:
            prompt: Input prompt
            model: OpenAI model identifier
            temperature: Sampling temperature
            max_tokens: Maximum tokens to generate
            **kwargs: Additional OpenAI-specific parameters

        Returns:
            CompletionResponse with generated content
        """
        llm = ChatOpenAI(
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
            token_usage = response.response_metadata.get('token_usage', {})
            usage = {
                'input_tokens': token_usage.get('prompt_tokens', 0),
                'output_tokens': token_usage.get('completion_tokens', 0),
                'total_tokens': token_usage.get('total_tokens', 0),
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
            provider="openai",
            usage=usage,
            cost=cost,
            metadata={
                'temperature': temperature,
                'max_tokens': max_tokens,
            }
        )

    def get_pricing(self, model: str) -> tuple[float, float]:
        """Get pricing for an OpenAI model.

        Args:
            model: Model identifier

        Returns:
            Tuple of (input_price, output_price) per 1M tokens in USD
        """
        return self.PRICING.get(model, (1.0, 3.0))  # Default fallback pricing
