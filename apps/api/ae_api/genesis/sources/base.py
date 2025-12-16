"""Base class for trend data sources."""

from abc import ABC, abstractmethod
from datetime import datetime

import structlog

from ae_api.genesis.niche_identification import TrendDocument

logger = structlog.get_logger()


class TrendSource(ABC):
    """Abstract base class for trend data sources.

    All trend sources should inherit from this class and implement
    the fetch_trends method.
    """

    def __init__(self, source_name: str):
        """Initialize the trend source.

        Args:
            source_name: Identifier for this source (e.g., 'reddit', 'google_trends')
        """
        self.source_name = source_name
        self.logger = logger.bind(source=source_name)

    @abstractmethod
    async def fetch_trends(
        self,
        query: str,
        limit: int = 50,
        **kwargs,
    ) -> list[TrendDocument]:
        """Fetch trend data from the source.

        Args:
            query: Search query or topic to fetch trends for
            limit: Maximum number of trend documents to return
            **kwargs: Source-specific parameters

        Returns:
            List of TrendDocument objects

        Raises:
            Exception: If fetching fails
        """
        pass

    def _create_trend_document(
        self,
        content: str,
        timestamp: datetime,
        metadata: dict | None = None,
    ) -> TrendDocument:
        """Create a TrendDocument with standardized format.

        Args:
            content: The trend content
            timestamp: When the trend was observed
            metadata: Additional metadata

        Returns:
            TrendDocument instance
        """
        return TrendDocument(
            source=self.source_name,
            content=content,
            timestamp=timestamp,
            metadata=metadata or {},
        )
