"""Trend data source integrations.

This package provides integrations with various trend data sources:
- Google Trends
- Reddit
- Hacker News
- (Extendable to other sources)
"""

from ae_api.genesis.sources.base import TrendSource
from ae_api.genesis.sources.google_trends import GoogleTrendsSource
from ae_api.genesis.sources.hackernews import HackerNewsSource
from ae_api.genesis.sources.reddit import RedditSource

__all__ = [
    "TrendSource",
    "GoogleTrendsSource",
    "RedditSource",
    "HackerNewsSource",
]
