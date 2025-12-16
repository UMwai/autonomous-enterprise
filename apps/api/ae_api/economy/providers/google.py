"""Google provider implementation."""

from langchain_google_genai import ChatGoogleGenerativeAI

from ae_api.config import Settings
from ae_api.economy.providers.base import BaseProvider, CompletionResponse


class GoogleProvider(BaseProvider):
    """Google Gemini LLM provider."""

    # Pricing per 1M tokens (input, output) in USD
    # Premium models enabled - heavily subsidized for maximum intelligence
    PRICING = {
        "gemini-3-pro-preview": (10.0, 40.0),   # Gemini 3 Pro - maximum capability
        "gemini-2.5-pro": (5.0, 20.0),          # Gemini 2.5 Pro
        "gemini-2.5-flash": (0.5, 2.0),         # Gemini 2.5 Flash
        "gemini-1.5-pro": (1.25, 5.0),
        "gemini-1.5-flash": (0.075, 0.3),
        "gemini-1.0-pro": (0.5, 1.5),
    }

    def __init__(self, settings: Settings):
        """Initialize Google provider.

        Args:
            settings: Application settings
        """
        self.settings = settings

        if not settings.google_api_key:
            raise ValueError("Google API key not configured")

        self._api_key = settings.google_api_key.get_secret_value()

    async def complete(
        self,
        prompt: str,
        model: str,
        temperature: float = 0.7,
        max_tokens: int = 2000,
        **kwargs
    ) -> CompletionResponse:
        """Generate a completion using Google Gemini.

        Args:
            prompt: Input prompt
            model: Gemini model identifier
            temperature: Sampling temperature
            max_tokens: Maximum tokens to generate
            **kwargs: Additional Google-specific parameters

        Returns:
            CompletionResponse with generated content
        """
        llm = ChatGoogleGenerativeAI(
            model=model,
            google_api_key=self._api_key,
            temperature=temperature,
            max_output_tokens=max_tokens,
            **kwargs
        )

        response = await llm.ainvoke(prompt)

        # Extract content and metadata
        content = response.content if hasattr(response, 'content') else str(response)

        # Get usage information
        usage = {}
        if hasattr(response, 'response_metadata'):
            usage_metadata = response.response_metadata.get('usage_metadata', {})
            usage = {
                'input_tokens': usage_metadata.get('prompt_token_count', 0),
                'output_tokens': usage_metadata.get('candidates_token_count', 0),
                'total_tokens': usage_metadata.get('total_token_count', 0),
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
            provider="google",
            usage=usage,
            cost=cost,
            metadata={
                'temperature': temperature,
                'max_tokens': max_tokens,
            }
        )

    def get_pricing(self, model: str) -> tuple[float, float]:
        """Get pricing for a Google model.

        Args:
            model: Model identifier

        Returns:
            Tuple of (input_price, output_price) per 1M tokens in USD
        """
        return self.PRICING.get(model, (0.5, 2.0))  # Default fallback pricing
