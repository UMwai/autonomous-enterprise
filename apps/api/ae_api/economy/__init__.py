"""Cognitive Economy module for intelligent model routing and cost optimization."""

from ae_api.economy.classifier import (
    ClassificationResult,
    SemanticClassifier,
    TaskComplexity,
    TaskRisk,
)
from ae_api.economy.router import (
    ModelRouter,
    ModelTier,
    RoutingDecision,
)

__all__ = [
    "ClassificationResult",
    "SemanticClassifier",
    "TaskComplexity",
    "TaskRisk",
    "ModelRouter",
    "ModelTier",
    "RoutingDecision",
]
