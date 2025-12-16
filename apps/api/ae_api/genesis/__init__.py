"""Genesis Module - Market Intelligence for Niche Finding and Validation.

This module provides capabilities for identifying, analyzing, and validating
micro-SaaS opportunities through:
- RAG-powered trend analysis
- Multi-source market intelligence gathering
- Niche candidate scoring and validation
- MetaGPT-based product specification generation
"""

from ae_api.genesis.niche_identification import (
    NicheCandidate,
    NicheIdentificationEngine,
    TrendDocument,
)
from ae_api.genesis.validator_agent import (
    ValidationMetrics,
    ValidationReport,
    ValidatorAgent,
)

__all__ = [
    "TrendDocument",
    "NicheCandidate",
    "NicheIdentificationEngine",
    "ValidationMetrics",
    "ValidationReport",
    "ValidatorAgent",
]
