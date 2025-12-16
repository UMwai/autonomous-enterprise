"""Hacker News data source integration.

This module provides integration with Hacker News (YCombinator) to fetch
discussions, trending topics, and pain points from the tech community.
"""

from datetime import datetime

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from ae_api.genesis.niche_identification import TrendDocument
from ae_api.genesis.sources.base import TrendSource


class HackerNewsSource(TrendSource):
    """Fetch trend data from Hacker News.

    This implementation uses the official Hacker News Firebase API.
    API documentation: https://github.com/HackerNews/API

    The API is public and requires no authentication, but implements
    rate limiting. This implementation includes retry logic and backoff.
    """

    def __init__(self):
        """Initialize the Hacker News source."""
        super().__init__("hackernews")
        self.http_client = httpx.AsyncClient(
            timeout=30.0,
            headers={"User-Agent": "AutonomousEnterprise/0.1.0 TrendAnalysis"},
        )
        self.base_url = "https://hacker-news.firebaseio.com/v0"
        self.hn_url = "https://news.ycombinator.com"

    async def __aenter__(self):
        """Async context manager entry."""
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.http_client.aclose()

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
    async def fetch_trends(
        self,
        query: str,
        limit: int = 50,
        story_type: str = "top",
    ) -> list[TrendDocument]:
        """Fetch Hacker News stories matching the query.

        Note: HN API doesn't have built-in search. This method:
        1. Fetches recent stories of the specified type
        2. Filters them by query relevance
        3. Returns matching stories with their discussions

        For better search, consider using Algolia HN Search API.

        Args:
            query: Search query to filter stories
            limit: Maximum number of stories to return
            story_type: Type of stories ('top', 'new', 'best', 'ask', 'show', 'job')

        Returns:
            List of TrendDocument objects
        """
        self.logger.info("fetching_hackernews_trends", query=query, limit=limit)

        try:
            # Fetch story IDs
            story_ids = await self._get_story_ids(story_type, limit * 2)

            trends = []
            query_lower = query.lower()

            # Fetch story details and filter by query
            for story_id in story_ids:
                if len(trends) >= limit:
                    break

                story = await self._get_item(story_id)
                if not story:
                    continue

                # Filter by query relevance
                title = story.get("title", "").lower()
                text = story.get("text", "").lower()

                if query_lower in title or query_lower in text:
                    trend_doc = await self._story_to_trend_document(story, include_comments=True)
                    if trend_doc:
                        trends.append(trend_doc)

            self.logger.info("hackernews_trends_fetched", count=len(trends))
            return trends

        except Exception as e:
            self.logger.error("hackernews_fetch_failed", error=str(e))
            raise

    async def fetch_top_stories(self, limit: int = 30) -> list[TrendDocument]:
        """Fetch top stories from Hacker News.

        Args:
            limit: Maximum number of stories to fetch

        Returns:
            List of TrendDocument objects
        """
        self.logger.info("fetching_top_stories", limit=limit)

        try:
            story_ids = await self._get_story_ids("top", limit)

            trends = []
            for story_id in story_ids:
                story = await self._get_item(story_id)
                if story:
                    trend_doc = await self._story_to_trend_document(story, include_comments=False)
                    if trend_doc:
                        trends.append(trend_doc)

            self.logger.info("top_stories_fetched", count=len(trends))
            return trends

        except Exception as e:
            self.logger.error("top_stories_fetch_failed", error=str(e))
            raise

    async def fetch_ask_hn_stories(self, limit: int = 30) -> list[TrendDocument]:
        """Fetch 'Ask HN' stories.

        These are particularly valuable for identifying pain points as they
        often contain questions about problems people are facing.

        Args:
            limit: Maximum number of stories to fetch

        Returns:
            List of TrendDocument objects
        """
        self.logger.info("fetching_ask_hn_stories", limit=limit)

        try:
            story_ids = await self._get_story_ids("ask", limit)

            trends = []
            for story_id in story_ids:
                story = await self._get_item(story_id)
                if story:
                    trend_doc = await self._story_to_trend_document(
                        story,
                        include_comments=True,
                        max_comments=10,
                    )
                    if trend_doc:
                        trends.append(trend_doc)

            self.logger.info("ask_hn_stories_fetched", count=len(trends))
            return trends

        except Exception as e:
            self.logger.error("ask_hn_fetch_failed", error=str(e))
            raise

    async def fetch_show_hn_stories(self, limit: int = 30) -> list[TrendDocument]:
        """Fetch 'Show HN' stories.

        These showcase new projects and products, useful for competitive analysis.

        Args:
            limit: Maximum number of stories to fetch

        Returns:
            List of TrendDocument objects
        """
        self.logger.info("fetching_show_hn_stories", limit=limit)

        try:
            story_ids = await self._get_story_ids("show", limit)

            trends = []
            for story_id in story_ids:
                story = await self._get_item(story_id)
                if story:
                    trend_doc = await self._story_to_trend_document(story, include_comments=False)
                    if trend_doc:
                        trends.append(trend_doc)

            self.logger.info("show_hn_stories_fetched", count=len(trends))
            return trends

        except Exception as e:
            self.logger.error("show_hn_fetch_failed", error=str(e))
            raise

    async def _get_story_ids(self, story_type: str, limit: int) -> list[int]:
        """Fetch story IDs for a given type.

        Args:
            story_type: Type of stories to fetch
            limit: Maximum number of IDs to return

        Returns:
            List of story IDs
        """
        url = f"{self.base_url}/{story_type}stories.json"

        response = await self.http_client.get(url)
        response.raise_for_status()

        story_ids = response.json()
        return story_ids[:limit]

    async def _get_item(self, item_id: int) -> dict | None:
        """Fetch a single item (story or comment) by ID.

        Args:
            item_id: HN item ID

        Returns:
            Item data dictionary or None if failed
        """
        try:
            url = f"{self.base_url}/item/{item_id}.json"
            response = await self.http_client.get(url)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            self.logger.warning("item_fetch_failed", item_id=item_id, error=str(e))
            return None

    async def _story_to_trend_document(
        self,
        story: dict,
        include_comments: bool = False,
        max_comments: int = 5,
    ) -> TrendDocument | None:
        """Convert a HN story to a TrendDocument.

        Args:
            story: Story data from HN API
            include_comments: Whether to include comment content
            max_comments: Maximum comments to include

        Returns:
            TrendDocument or None if conversion failed
        """
        try:
            title = story.get("title", "")
            text = story.get("text", "")
            story_type = story.get("type", "story")

            # Build content
            content_parts = [f"Title: {title}"]

            if text:
                content_parts.append(f"\nContent: {text}")

            # Include top comments if requested
            if include_comments and "kids" in story:
                comment_ids = story["kids"][:max_comments]
                comments = []

                for comment_id in comment_ids:
                    comment = await self._get_item(comment_id)
                    if comment and comment.get("text"):
                        comments.append(comment["text"])

                if comments:
                    content_parts.append("\n\nTop Comments:")
                    for i, comment_text in enumerate(comments, 1):
                        # Clean up HTML entities and limit length
                        clean_comment = comment_text.replace("&quot;", '"').replace("&#x27;", "'")
                        content_parts.append(f"\n{i}. {clean_comment[:500]}")

            content = "\n".join(content_parts)

            # Create metadata
            timestamp = datetime.fromtimestamp(story.get("time", 0))

            metadata = {
                "story_id": story.get("id"),
                "author": story.get("by", "unknown"),
                "score": story.get("score", 0),
                "num_comments": story.get("descendants", 0),
                "url": story.get("url", f"{self.hn_url}/item?id={story.get('id')}"),
                "hn_url": f"{self.hn_url}/item?id={story.get('id')}",
                "story_type": story_type,
            }

            return self._create_trend_document(
                content=content[:3000],  # Limit total content length
                timestamp=timestamp,
                metadata=metadata,
            )

        except Exception as e:
            self.logger.warning("story_conversion_failed", error=str(e))
            return None

    async def search_algolia(
        self,
        query: str,
        limit: int = 50,
        tags: str = "story",
    ) -> list[TrendDocument]:
        """Search Hacker News using Algolia HN Search API.

        This provides better search capabilities than filtering the main API.
        Algolia HN Search API: https://hn.algolia.com/api

        Args:
            query: Search query
            limit: Maximum results
            tags: Filter by tags (e.g., 'story', 'comment', 'ask_hn', 'show_hn')

        Returns:
            List of TrendDocument objects
        """
        self.logger.info("searching_algolia", query=query, limit=limit)

        try:
            url = "https://hn.algolia.com/api/v1/search"
            params = {
                "query": query,
                "tags": tags,
                "hitsPerPage": min(limit, 100),
            }

            response = await self.http_client.get(url, params=params)
            response.raise_for_status()

            data = response.json()
            hits = data.get("hits", [])

            trends = []
            for hit in hits:
                title = hit.get("title") or hit.get("story_title", "")
                text = hit.get("story_text", "")

                content_parts = [f"Title: {title}"]
                if text:
                    content_parts.append(f"\nContent: {text}")

                content = "\n".join(content_parts)

                # Parse timestamp
                created_at = hit.get("created_at")
                try:
                    timestamp = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
                except Exception:
                    timestamp = datetime.utcnow()

                metadata = {
                    "story_id": hit.get("objectID"),
                    "author": hit.get("author", "unknown"),
                    "score": hit.get("points", 0),
                    "num_comments": hit.get("num_comments", 0),
                    "url": hit.get("url", ""),
                    "hn_url": f"{self.hn_url}/item?id={hit.get('objectID')}",
                    "story_type": tags,
                    "search_query": query,
                }

                trend_doc = self._create_trend_document(
                    content=content[:2000],
                    timestamp=timestamp,
                    metadata=metadata,
                )
                trends.append(trend_doc)

            self.logger.info("algolia_search_complete", count=len(trends))
            return trends

        except Exception as e:
            self.logger.error("algolia_search_failed", error=str(e))
            raise
