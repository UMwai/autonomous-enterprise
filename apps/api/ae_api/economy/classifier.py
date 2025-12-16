"""Task classification for intelligent model routing."""

import re
from enum import Enum

from langchain_anthropic import ChatAnthropic
from pydantic import BaseModel, Field

from ae_api.config import Settings


class TaskComplexity(str, Enum):
    """Task complexity levels."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class TaskRisk(str, Enum):
    """Task risk levels."""

    SAFE = "safe"
    MODERATE = "moderate"
    SENSITIVE = "sensitive"


class ClassificationResult(BaseModel):
    """Result of task classification."""

    complexity: TaskComplexity = Field(
        ..., description="Complexity level of the task"
    )
    risk: TaskRisk = Field(
        ..., description="Risk level of the task"
    )
    complexity_score: int = Field(
        ..., ge=1, le=10, description="Numerical complexity score (1-10)"
    )
    reasoning: str = Field(
        ..., description="Explanation of classification decision"
    )
    suggested_tier: str = Field(
        ..., description="Suggested model tier (TIER1, TIER2, or TIER3)"
    )


class SemanticClassifier:
    """Semantic task classifier using Haiku for fast, cheap classification."""

    # Risk keywords mapping
    RISK_KEYWORDS = {
        TaskRisk.SENSITIVE: [
            "deploy", "deployment", "delete", "remove", "drop",
            "billing", "payment", "charge", "credit card",
            "security", "password", "secret", "token", "api key",
            "production", "prod", "live", "database migration",
            "admin", "root", "sudo", "permission",
        ],
        TaskRisk.MODERATE: [
            "update", "modify", "change", "refactor",
            "config", "configuration", "settings",
            "user data", "email", "notification",
            "integration", "webhook", "api",
        ],
    }

    CLASSIFICATION_PROMPT = """You are a task complexity classifier. Analyze the following task and rate its complexity on a scale of 1-10.

Consider these factors:
- 1-3 (LOW): Simple, routine tasks like formatting, linting, basic CRUD, simple queries
- 4-7 (MEDIUM): Standard implementation tasks like building features, writing tests, documentation, integrations
- 8-10 (HIGH): Complex tasks requiring deep reasoning like architecture design, debugging complex issues, security reviews, performance optimization

Task: {prompt}

Respond with ONLY a JSON object in this format:
{{
  "score": <1-10>,
  "reasoning": "<brief explanation of why this score>"
}}"""

    def __init__(self, settings: Settings):
        """Initialize the classifier.

        Args:
            settings: Application settings
        """
        self.settings = settings
        self._llm = None

    @property
    def llm(self) -> ChatAnthropic:
        """Lazy-load the LLM for classification."""
        if self._llm is None:
            if not self.settings.anthropic_api_key:
                raise ValueError("Anthropic API key not configured")

            self._llm = ChatAnthropic(
                model="claude-opus-4-5-20251101",  # Premium model for accurate classification
                api_key=self.settings.anthropic_api_key.get_secret_value(),
                temperature=0,
                max_tokens=200,
            )
        return self._llm

    def _classify_risk(self, prompt: str) -> TaskRisk:
        """Classify task risk based on keywords.

        Args:
            prompt: Task prompt to classify

        Returns:
            TaskRisk level
        """
        prompt_lower = prompt.lower()

        # Check sensitive keywords first
        for keyword in self.RISK_KEYWORDS[TaskRisk.SENSITIVE]:
            if keyword in prompt_lower:
                return TaskRisk.SENSITIVE

        # Check moderate keywords
        for keyword in self.RISK_KEYWORDS[TaskRisk.MODERATE]:
            if keyword in prompt_lower:
                return TaskRisk.MODERATE

        return TaskRisk.SAFE

    def _score_to_complexity(self, score: int) -> TaskComplexity:
        """Map complexity score to complexity level.

        Args:
            score: Complexity score (1-10)

        Returns:
            TaskComplexity level
        """
        if score <= 3:
            return TaskComplexity.LOW
        elif score <= 7:
            return TaskComplexity.MEDIUM
        else:
            return TaskComplexity.HIGH

    def _score_to_tier(self, score: int) -> str:
        """Map complexity score to model tier.

        Args:
            score: Complexity score (1-10)

        Returns:
            Model tier name
        """
        if score <= 3:
            return "TIER3"  # Intern - simple tasks
        elif score <= 7:
            return "TIER2"  # Builder - standard tasks
        else:
            return "TIER1"  # Architect - complex tasks

    async def classify(self, prompt: str, context: dict | None = None) -> ClassificationResult:
        """Classify a task based on its prompt.

        Args:
            prompt: Task prompt to classify
            context: Optional additional context for classification

        Returns:
            ClassificationResult with complexity, risk, and tier suggestion
        """
        # Risk classification (keyword-based, no LLM needed)
        risk = self._classify_risk(prompt)

        # Complexity classification using LLM
        classification_prompt = self.CLASSIFICATION_PROMPT.format(prompt=prompt)

        try:
            response = await self.llm.ainvoke(classification_prompt)
            response_text = response.content if hasattr(response, 'content') else str(response)

            # Extract JSON from response
            import json
            # Try to find JSON in response
            json_match = re.search(r'\{[^}]+\}', response_text)
            if json_match:
                result = json.loads(json_match.group())
                score = int(result.get("score", 5))
                reasoning = result.get("reasoning", "No reasoning provided")
            else:
                # Fallback to medium complexity
                score = 5
                reasoning = "Could not parse LLM response, defaulting to medium complexity"

        except Exception as e:
            # Fallback on error
            score = 5
            reasoning = f"Error during classification: {str(e)}. Defaulting to medium complexity"

        # Ensure score is in valid range
        score = max(1, min(10, score))

        complexity = self._score_to_complexity(score)
        suggested_tier = self._score_to_tier(score)

        # Upgrade tier if task is sensitive
        if risk == TaskRisk.SENSITIVE and suggested_tier != "TIER1":
            reasoning += " [Upgraded to TIER1 due to sensitive operations]"
            suggested_tier = "TIER1"

        return ClassificationResult(
            complexity=complexity,
            risk=risk,
            complexity_score=score,
            reasoning=reasoning,
            suggested_tier=suggested_tier,
        )
