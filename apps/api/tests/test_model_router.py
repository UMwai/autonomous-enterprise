"""Tests for Model Router (Cognitive Economy) system."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from ae_api.config import Settings
from ae_api.economy.classifier import (
    SemanticClassifier,
    TaskComplexity,
    TaskRisk,
    ClassificationResult,
)
from ae_api.economy.router import ModelRouter, ModelTier, RoutingDecision
from ae_api.economy.providers.base import CompletionResponse


@pytest.fixture
def mock_settings():
    """Create mock settings."""
    settings = Settings()
    settings.anthropic_api_key = "test-key"
    settings.openai_api_key = "test-key"
    settings.google_api_key = "test-key"
    settings.default_run_budget = 10.0
    return settings


@pytest.fixture
def mock_classifier(mock_settings):
    """Create mock classifier."""
    return SemanticClassifier(mock_settings)


@pytest.fixture
def router(mock_settings, mock_classifier):
    """Create router instance."""
    return ModelRouter(mock_settings, mock_classifier)


class TestSemanticClassifier:
    """Tests for SemanticClassifier."""

    def test_risk_classification_sensitive(self, mock_classifier):
        """Test sensitive risk detection."""
        tasks = [
            "Deploy to production",
            "Delete all user data",
            "Update billing settings",
            "Configure security policies",
        ]

        for task in tasks:
            risk = mock_classifier._classify_risk(task)
            assert risk == TaskRisk.SENSITIVE

    def test_risk_classification_moderate(self, mock_classifier):
        """Test moderate risk detection."""
        tasks = [
            "Update user profile",
            "Modify configuration",
            "Change API settings",
        ]

        for task in tasks:
            risk = mock_classifier._classify_risk(task)
            assert risk == TaskRisk.MODERATE

    def test_risk_classification_safe(self, mock_classifier):
        """Test safe risk detection."""
        tasks = [
            "Write documentation",
            "Format code",
            "Run tests",
        ]

        for task in tasks:
            risk = mock_classifier._classify_risk(task)
            assert risk == TaskRisk.SAFE

    def test_score_to_complexity(self, mock_classifier):
        """Test complexity score mapping."""
        assert mock_classifier._score_to_complexity(1) == TaskComplexity.LOW
        assert mock_classifier._score_to_complexity(3) == TaskComplexity.LOW
        assert mock_classifier._score_to_complexity(5) == TaskComplexity.MEDIUM
        assert mock_classifier._score_to_complexity(7) == TaskComplexity.MEDIUM
        assert mock_classifier._score_to_complexity(9) == TaskComplexity.HIGH
        assert mock_classifier._score_to_complexity(10) == TaskComplexity.HIGH

    def test_score_to_tier(self, mock_classifier):
        """Test tier mapping."""
        assert mock_classifier._score_to_tier(2) == "TIER3"
        assert mock_classifier._score_to_tier(5) == "TIER2"
        assert mock_classifier._score_to_tier(9) == "TIER1"

    @pytest.mark.asyncio
    async def test_classify_with_mock_llm(self, mock_classifier):
        """Test classification with mocked LLM."""
        # Mock LLM response
        mock_response = MagicMock()
        mock_response.content = '{"score": 7, "reasoning": "Standard implementation task"}'

        with patch.object(mock_classifier, 'llm') as mock_llm:
            mock_llm.ainvoke = AsyncMock(return_value=mock_response)

            result = await mock_classifier.classify("Implement user authentication")

            assert result.complexity == TaskComplexity.MEDIUM
            assert result.complexity_score == 7
            assert result.suggested_tier == "TIER2"
            assert "authentication" in result.reasoning or "Standard" in result.reasoning

    @pytest.mark.asyncio
    async def test_classify_sensitive_upgrade(self, mock_classifier):
        """Test that sensitive tasks are upgraded to TIER1."""
        # Mock LLM response with low score
        mock_response = MagicMock()
        mock_response.content = '{"score": 4, "reasoning": "Simple task"}'

        with patch.object(mock_classifier, 'llm') as mock_llm:
            mock_llm.ainvoke = AsyncMock(return_value=mock_response)

            result = await mock_classifier.classify("Delete production database")

            # Should be upgraded to TIER1 due to sensitive keyword
            assert result.suggested_tier == "TIER1"
            assert result.risk == TaskRisk.SENSITIVE
            assert "TIER1" in result.reasoning


class TestModelRouter:
    """Tests for ModelRouter."""

    def test_get_model_for_tier(self, router):
        """Test getting models for each tier."""
        # TIER1
        provider, model = router.get_model_for_tier(ModelTier.TIER1_ARCHITECT)
        assert provider in ["anthropic", "openai"]
        assert model in ["claude-opus-4-5-20251101", "gpt-5.2-xhigh"]

        # TIER2
        provider, model = router.get_model_for_tier(ModelTier.TIER2_BUILDER)
        assert provider in ["google", "openai"]
        assert model in ["gemini-3-pro-preview", "gpt-5.2-xhigh"]

        # TIER3
        provider, model = router.get_model_for_tier(ModelTier.TIER3_INTERN)
        assert provider in ["google", "anthropic"]
        assert model in ["gemini-3-pro-preview", "claude-opus-4-5-20251101"]

    def test_estimate_cost(self, router):
        """Test cost estimation."""
        prompt = "Write a simple function"  # ~5 tokens
        cost = router.estimate_cost(prompt, ModelTier.TIER3_INTERN)

        # Cost should be very small for a simple prompt
        assert cost > 0
        assert cost < 0.001

        # Higher tier should cost more
        cost_tier1 = router.estimate_cost(prompt, ModelTier.TIER1_ARCHITECT)
        cost_tier3 = router.estimate_cost(prompt, ModelTier.TIER3_INTERN)
        assert cost_tier1 > cost_tier3

    def test_budget_tracking(self, router):
        """Test budget tracking."""
        run_id = "test-run"

        # Initial usage should be 0
        assert router.get_run_usage(run_id) == 0.0

        # Record some usage
        router.record_usage(run_id, 1.5)
        assert router.get_run_usage(run_id) == 1.5

        # Record more usage
        router.record_usage(run_id, 2.5)
        assert router.get_run_usage(run_id) == 4.0

        # Reset budget
        router.reset_run_budget(run_id)
        assert router.get_run_usage(run_id) == 0.0

    def test_enforce_budget(self, router, mock_settings):
        """Test budget enforcement."""
        run_id = "budget-test"
        budget = mock_settings.default_run_budget  # 10.0

        # Should allow within budget
        assert router.enforce_budget(run_id, 5.0) is True

        # Record usage
        router.record_usage(run_id, 5.0)

        # Should still allow
        assert router.enforce_budget(run_id, 4.0) is True

        # Should not allow exceeding budget
        assert router.enforce_budget(run_id, 6.0) is False

    @pytest.mark.asyncio
    async def test_route_with_classification(self, router, mock_classifier):
        """Test routing with classification."""
        # Mock classification result
        mock_result = ClassificationResult(
            complexity=TaskComplexity.MEDIUM,
            risk=TaskRisk.SAFE,
            complexity_score=5,
            reasoning="Standard task",
            suggested_tier="TIER2",
        )

        with patch.object(mock_classifier, 'classify', return_value=mock_result):
            decision = await router.route("Implement a feature")

            assert decision.tier == ModelTier.TIER2_BUILDER
            assert decision.provider in ["google", "openai"]
            assert decision.estimated_cost > 0
            assert "Standard task" in decision.reasoning

    @pytest.mark.asyncio
    async def test_route_with_override(self, router):
        """Test routing with tier override."""
        decision = await router.route(
            "Simple task",
            override_tier=ModelTier.TIER1_ARCHITECT
        )

        assert decision.tier == ModelTier.TIER1_ARCHITECT
        assert "override" in decision.reasoning.lower()

    @pytest.mark.asyncio
    async def test_route_with_budget_downgrade(self, router, mock_classifier, mock_settings):
        """Test routing downgrades when budget is exceeded."""
        run_id = "downgrade-test"

        # Mock high-complexity classification
        mock_result = ClassificationResult(
            complexity=TaskComplexity.HIGH,
            risk=TaskRisk.SAFE,
            complexity_score=9,
            reasoning="Complex task",
            suggested_tier="TIER1",
        )

        with patch.object(mock_classifier, 'classify', return_value=mock_result):
            # Use up most of budget
            router.record_usage(run_id, mock_settings.default_run_budget - 0.01)

            # Next request should be downgraded
            decision = await router.route("Complex task", run_id=run_id)

            # Should be downgraded from TIER1
            assert decision.tier in [ModelTier.TIER2_BUILDER, ModelTier.TIER3_INTERN]
            assert "downgrade" in decision.reasoning.lower()

    def test_get_tier_info(self, router):
        """Test getting tier information."""
        tier_info = router.get_tier_info()

        assert "TIER1" in tier_info
        assert "TIER2" in tier_info
        assert "TIER3" in tier_info

        # Check structure
        for tier_name, info in tier_info.items():
            assert "models" in info
            assert "use_cases" in info
            assert "default_model" in info
            assert len(info["models"]) > 0
            assert len(info["use_cases"]) > 0


class TestProviders:
    """Tests for provider implementations."""

    @pytest.mark.asyncio
    async def test_anthropic_provider(self, mock_settings):
        """Test Anthropic provider."""
        from ae_api.economy.providers.anthropic import AnthropicProvider

        provider = AnthropicProvider(mock_settings)

        # Test pricing (premium model)
        input_price, output_price = provider.get_pricing("claude-opus-4-5-20251101")
        assert input_price > 0
        assert output_price > 0

        # Test cost calculation (premium model)
        cost = provider.calculate_cost(1000, 500, "claude-opus-4-5-20251101")
        assert cost > 0

    @pytest.mark.asyncio
    async def test_openai_provider(self, mock_settings):
        """Test OpenAI provider."""
        from ae_api.economy.providers.openai import OpenAIProvider

        provider = OpenAIProvider(mock_settings)

        # Test pricing (premium model)
        input_price, output_price = provider.get_pricing("gpt-5.2-xhigh")
        assert input_price > 0
        assert output_price > 0

        # Test cost calculation (premium model)
        cost = provider.calculate_cost(1000, 500, "gpt-5.2-xhigh")
        assert cost > 0

    @pytest.mark.asyncio
    async def test_google_provider(self, mock_settings):
        """Test Google provider."""
        from ae_api.economy.providers.google import GoogleProvider

        provider = GoogleProvider(mock_settings)

        # Test pricing (premium model)
        input_price, output_price = provider.get_pricing("gemini-3-pro-preview")
        assert input_price > 0
        assert output_price > 0

        # Test cost calculation (premium model)
        cost = provider.calculate_cost(1000, 500, "gemini-3-pro-preview")
        assert cost > 0


@pytest.mark.integration
class TestModelRouterIntegration:
    """Integration tests for Model Router."""

    @pytest.mark.asyncio
    async def test_full_routing_flow(self, router, mock_classifier):
        """Test complete routing flow."""
        # Mock classification
        mock_result = ClassificationResult(
            complexity=TaskComplexity.LOW,
            risk=TaskRisk.SAFE,
            complexity_score=2,
            reasoning="Simple formatting task",
            suggested_tier="TIER3",
        )

        with patch.object(mock_classifier, 'classify', return_value=mock_result):
            run_id = "integration-test"

            # Route task
            decision = await router.route(
                prompt="Format this code",
                run_id=run_id
            )

            # Verify decision
            assert decision.tier == ModelTier.TIER3_INTERN
            assert decision.estimated_cost > 0
            assert decision.classification is not None

            # Record usage
            router.record_usage(run_id, decision.estimated_cost)

            # Verify budget tracking
            usage = router.get_run_usage(run_id)
            assert usage == decision.estimated_cost

    @pytest.mark.asyncio
    async def test_multiple_requests_with_budget(self, router, mock_classifier):
        """Test multiple requests with budget tracking."""
        run_id = "multi-request-test"

        # Mock different classifications
        classifications = [
            ClassificationResult(
                complexity=TaskComplexity.LOW,
                risk=TaskRisk.SAFE,
                complexity_score=2,
                reasoning="Simple task",
                suggested_tier="TIER3",
            ),
            ClassificationResult(
                complexity=TaskComplexity.MEDIUM,
                risk=TaskRisk.SAFE,
                complexity_score=5,
                reasoning="Medium task",
                suggested_tier="TIER2",
            ),
            ClassificationResult(
                complexity=TaskComplexity.HIGH,
                risk=TaskRisk.SAFE,
                complexity_score=9,
                reasoning="Complex task",
                suggested_tier="TIER1",
            ),
        ]

        total_cost = 0.0

        for classification in classifications:
            with patch.object(mock_classifier, 'classify', return_value=classification):
                decision = await router.route("Task", run_id=run_id)
                router.record_usage(run_id, decision.estimated_cost)
                total_cost += decision.estimated_cost

        # Verify total usage
        assert router.get_run_usage(run_id) == pytest.approx(total_cost, rel=1e-6)
