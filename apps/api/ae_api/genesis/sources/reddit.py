"""Reddit data source integration.

This module provides integration with Reddit to fetch discussions, pain points,
and trending topics from relevant subreddits.
"""

from datetime import datetime

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from ae_api.genesis.niche_identification import TrendDocument
from ae_api.genesis.sources.base import TrendSource


class RedditSource(TrendSource):
    """Fetch trend data from Reddit.

    This implementation uses Reddit's public JSON API (no authentication required).
    For production use, consider:
    - Using PRAW (Python Reddit API Wrapper) for authenticated access
    - Implementing rate limiting per Reddit's guidelines
    - Caching responses to minimize API calls
    - Subscribing to Reddit's premium API for higher limits
    """

    def __init__(self):
        """Initialize the Reddit source."""
        super().__init__("reddit")
        self.http_client = httpx.AsyncClient(
            timeout=30.0,
            headers={"User-Agent": "AutonomousEnterprise/0.1.0 TrendAnalysis"},
        )
        self.base_url = "https://www.reddit.com"

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
        subreddits: list[str] | None = None,
        sort: str = "relevance",
        time_filter: str = "month",
    ) -> list[TrendDocument]:
        """Fetch Reddit posts and discussions matching the query.

        Args:
            query: Search query
            limit: Maximum number of posts to fetch
            subreddits: List of subreddits to search (None = all)
            sort: Sort method ('relevance', 'hot', 'top', 'new', 'comments')
            time_filter: Time period ('hour', 'day', 'week', 'month', 'year', 'all')

        Returns:
            List of TrendDocument objects
        """
        self.logger.info("fetching_reddit_trends", query=query, limit=limit)

        try:
            trends = []

            # If specific subreddits provided, search each
            if subreddits:
                for subreddit in subreddits:
                    subreddit_trends = await self._search_subreddit(
                        subreddit=subreddit,
                        query=query,
                        limit=limit // len(subreddits),
                        sort=sort,
                        time_filter=time_filter,
                    )
                    trends.extend(subreddit_trends)
            else:
                # Search all of Reddit
                trends = await self._search_all_reddit(
                    query=query,
                    limit=limit,
                    sort=sort,
                    time_filter=time_filter,
                )

            self.logger.info("reddit_trends_fetched", count=len(trends))
            return trends[:limit]

        except Exception as e:
            self.logger.error("reddit_fetch_failed", error=str(e))
            raise

    async def _search_subreddit(
        self,
        subreddit: str,
        query: str,
        limit: int,
        sort: str,
        time_filter: str,
    ) -> list[TrendDocument]:
        """Search a specific subreddit.

        Args:
            subreddit: Subreddit name (without r/)
            query: Search query
            limit: Max results
            sort: Sort method
            time_filter: Time period

        Returns:
            List of TrendDocument objects
        """
        try:
            # Reddit's JSON API endpoint
            url = f"{self.base_url}/r/{subreddit}/search.json"
            params = {
                "q": query,
                "limit": min(limit, 100),  # Reddit API max is 100
                "sort": sort,
                "t": time_filter,
                "restrict_sr": "true",  # Restrict to this subreddit
                "raw_json": "1",
            }

            response = await self.http_client.get(url, params=params)
            response.raise_for_status()

            data = response.json()
            posts = data.get("data", {}).get("children", [])

            trends = []
            for post_data in posts:
                post = post_data.get("data", {})

                # Extract post content
                title = post.get("title", "")
                selftext = post.get("selftext", "")
                content = f"{title}\n\n{selftext}" if selftext else title

                # Create trend document
                timestamp = datetime.fromtimestamp(post.get("created_utc", 0))

                metadata = {
                    "subreddit": subreddit,
                    "author": post.get("author", "unknown"),
                    "score": post.get("score", 0),
                    "num_comments": post.get("num_comments", 0),
                    "url": f"{self.base_url}{post.get('permalink', '')}",
                    "upvote_ratio": post.get("upvote_ratio", 0),
                    "post_id": post.get("id", ""),
                }

                trend_doc = self._create_trend_document(
                    content=content[:2000],  # Limit content length
                    timestamp=timestamp,
                    metadata=metadata,
                )
                trends.append(trend_doc)

            return trends

        except httpx.HTTPError as e:
            self.logger.warning(
                "subreddit_search_failed",
                subreddit=subreddit,
                error=str(e),
            )
            return []

    async def _search_all_reddit(
        self,
        query: str,
        limit: int,
        sort: str,
        time_filter: str,
    ) -> list[TrendDocument]:
        """Search all of Reddit.

        Args:
            query: Search query
            limit: Max results
            sort: Sort method
            time_filter: Time period

        Returns:
            List of TrendDocument objects
        """
        try:
            url = f"{self.base_url}/search.json"
            params = {
                "q": query,
                "limit": min(limit, 100),
                "sort": sort,
                "t": time_filter,
                "raw_json": "1",
            }

            response = await self.http_client.get(url, params=params)
            response.raise_for_status()

            data = response.json()
            posts = data.get("data", {}).get("children", [])

            trends = []
            for post_data in posts:
                post = post_data.get("data", {})

                title = post.get("title", "")
                selftext = post.get("selftext", "")
                content = f"{title}\n\n{selftext}" if selftext else title

                timestamp = datetime.fromtimestamp(post.get("created_utc", 0))

                metadata = {
                    "subreddit": post.get("subreddit", "unknown"),
                    "author": post.get("author", "unknown"),
                    "score": post.get("score", 0),
                    "num_comments": post.get("num_comments", 0),
                    "url": f"{self.base_url}{post.get('permalink', '')}",
                    "upvote_ratio": post.get("upvote_ratio", 0),
                    "post_id": post.get("id", ""),
                }

                trend_doc = self._create_trend_document(
                    content=content[:2000],
                    timestamp=timestamp,
                    metadata=metadata,
                )
                trends.append(trend_doc)

            return trends

        except Exception as e:
            self.logger.error("reddit_search_all_failed", error=str(e))
            return []

    async def fetch_subreddit_hot(
        self,
        subreddit: str,
        limit: int = 25,
    ) -> list[TrendDocument]:
        """Fetch hot posts from a specific subreddit.

        Args:
            subreddit: Subreddit name (without r/)
            limit: Max results

        Returns:
            List of TrendDocument objects
        """
        self.logger.info("fetching_subreddit_hot", subreddit=subreddit, limit=limit)

        try:
            url = f"{self.base_url}/r/{subreddit}/hot.json"
            params = {
                "limit": min(limit, 100),
                "raw_json": "1",
            }

            response = await self.http_client.get(url, params=params)
            response.raise_for_status()

            data = response.json()
            posts = data.get("data", {}).get("children", [])

            trends = []
            for post_data in posts:
                post = post_data.get("data", {})

                title = post.get("title", "")
                selftext = post.get("selftext", "")
                content = f"{title}\n\n{selftext}" if selftext else title

                timestamp = datetime.fromtimestamp(post.get("created_utc", 0))

                metadata = {
                    "subreddit": subreddit,
                    "author": post.get("author", "unknown"),
                    "score": post.get("score", 0),
                    "num_comments": post.get("num_comments", 0),
                    "url": f"{self.base_url}{post.get('permalink', '')}",
                    "upvote_ratio": post.get("upvote_ratio", 0),
                    "post_id": post.get("id", ""),
                    "is_hot": True,
                }

                trend_doc = self._create_trend_document(
                    content=content[:2000],
                    timestamp=timestamp,
                    metadata=metadata,
                )
                trends.append(trend_doc)

            self.logger.info("subreddit_hot_fetched", count=len(trends))
            return trends

        except Exception as e:
            self.logger.error("subreddit_hot_failed", error=str(e))
            raise

    async def fetch_comments(
        self,
        subreddit: str,
        post_id: str,
        limit: int = 50,
    ) -> list[TrendDocument]:
        """Fetch comments from a specific post.

        Useful for extracting pain points and detailed discussions.

        Args:
            subreddit: Subreddit name (without r/)
            post_id: Reddit post ID
            limit: Max comments to fetch

        Returns:
            List of TrendDocument objects (one per comment)
        """
        self.logger.info("fetching_comments", subreddit=subreddit, post_id=post_id)

        try:
            url = f"{self.base_url}/r/{subreddit}/comments/{post_id}.json"
            params = {
                "limit": min(limit, 100),
                "raw_json": "1",
            }

            response = await self.http_client.get(url, params=params)
            response.raise_for_status()

            data = response.json()

            # Comments are in the second element of the response
            if len(data) < 2:
                return []

            comments_data = data[1].get("data", {}).get("children", [])

            trends = []
            for comment_data in comments_data:
                comment = comment_data.get("data", {})

                # Skip "more comments" placeholders
                if comment.get("kind") == "more":
                    continue

                body = comment.get("body", "")
                if not body or body == "[deleted]" or body == "[removed]":
                    continue

                timestamp = datetime.fromtimestamp(comment.get("created_utc", 0))

                metadata = {
                    "subreddit": subreddit,
                    "post_id": post_id,
                    "comment_id": comment.get("id", ""),
                    "author": comment.get("author", "unknown"),
                    "score": comment.get("score", 0),
                    "is_comment": True,
                }

                trend_doc = self._create_trend_document(
                    content=body[:2000],
                    timestamp=timestamp,
                    metadata=metadata,
                )
                trends.append(trend_doc)

            self.logger.info("comments_fetched", count=len(trends))
            return trends[:limit]

        except Exception as e:
            self.logger.error("comments_fetch_failed", error=str(e))
            raise


# Common subreddits for B2B SaaS and startup discussions
SAAS_SUBREDDITS = [
    "SaaS",
    "startups",
    "Entrepreneur",
    "smallbusiness",
    "Business_Ideas",
    "MicroSaaS",
    "SideProject",
    "indiebiz",
]

TECH_SUBREDDITS = [
    "programming",
    "webdev",
    "devops",
    "datascience",
    "MachineLearning",
    "sysadmin",
    "technology",
]
