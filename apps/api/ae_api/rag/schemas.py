"""RAG schemas and models."""

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class TrendSource(str, Enum):
    """Source of trend data."""

    REDDIT = "reddit"
    HACKERNEWS = "hackernews"
    GOOGLE_TRENDS = "google_trends"
    TWITTER = "twitter"
    PRODUCT_HUNT = "product_hunt"
    INDIE_HACKERS = "indie_hackers"


class TrendDocument(BaseModel):
    """A document containing trend/market signal data."""

    id: str = Field(description="Unique document ID")
    source: TrendSource = Field(description="Source platform")
    title: str = Field(description="Title or headline")
    content: str = Field(description="Full content/body text")
    url: str | None = Field(default=None, description="Source URL")
    author: str | None = Field(default=None, description="Author/poster")
    score: int = Field(default=0, description="Engagement score (upvotes, etc.)")
    timestamp: datetime = Field(description="When the content was posted")
    metadata: dict = Field(default_factory=dict, description="Additional metadata")
    embedding: list[float] | None = Field(default=None, description="Vector embedding")


class NicheCandidate(BaseModel):
    """A potential niche/market opportunity."""

    id: str = Field(description="Unique candidate ID")
    name: str = Field(description="Short niche name")
    description: str = Field(description="Detailed description")
    pain_points: list[str] = Field(description="Identified pain points")
    target_audience: str = Field(description="Target audience description")
    evidence_urls: list[str] = Field(default_factory=list, description="Supporting evidence")
    evidence_quotes: list[str] = Field(default_factory=list, description="Key quotes from sources")

    # Scoring
    pain_intensity: float = Field(default=0.0, ge=0, le=10, description="Pain intensity 0-10")
    market_size_estimate: str = Field(default="unknown", description="Market size estimate")
    competition_level: str = Field(default="unknown", description="Competition assessment")

    # Validation scores
    search_volume: int | None = Field(default=None, description="Monthly search volume")
    keyword_difficulty: float | None = Field(default=None, description="SEO difficulty 0-100")
    estimated_arpu: float | None = Field(default=None, description="Estimated ARPU in USD")

    # Overall score
    composite_score: float = Field(default=0.0, ge=0, le=100, description="Overall viability score")


class ValidationReport(BaseModel):
    """SEO/market validation report for a niche."""

    niche_id: str = Field(description="ID of validated niche")

    # SEO metrics
    primary_keywords: list[str] = Field(description="Primary target keywords")
    search_volume_total: int = Field(description="Total monthly search volume")
    average_keyword_difficulty: float = Field(description="Average KD across keywords")

    # Competition analysis
    competitor_count: int = Field(description="Number of active competitors")
    competitor_urls: list[str] = Field(description="Top competitor URLs")
    competitor_freshness: str = Field(description="How recently competitors updated")

    # Revenue potential
    estimated_arpu: float = Field(description="Estimated average revenue per user")
    estimated_conversion_rate: float = Field(description="Estimated conversion rate")
    projected_mrr: float = Field(description="Projected MRR at target traffic")

    # Verdict
    passes_threshold: bool = Field(description="Whether niche passes $500 MRR threshold")
    confidence: float = Field(ge=0, le=1, description="Confidence in assessment")
    reasoning: str = Field(description="Explanation of assessment")


class ProductSpec(BaseModel):
    """Product specification from Meta-PM."""

    project_name: str = Field(description="Project name")
    tagline: str = Field(description="One-line description")
    problem_statement: str = Field(description="Problem being solved")
    solution_overview: str = Field(description="High-level solution")

    # User stories
    user_stories: list[str] = Field(description="User stories in standard format")

    # MMP (Minimum Monetizable Product)
    mmp_features: list[str] = Field(description="Features for MMP")
    out_of_scope: list[str] = Field(description="Features explicitly out of scope")

    # Monetization
    pricing_model: str = Field(description="Pricing model (one-time, subscription, usage)")
    target_price: float = Field(description="Target price point in USD")

    # Success metrics
    success_metrics: list[str] = Field(description="How to measure success")


class TechnicalSpec(BaseModel):
    """Technical specification from Architect role."""

    # Stack
    frontend_framework: str = Field(description="Frontend framework choice")
    backend_framework: str = Field(description="Backend framework choice")
    database: str = Field(description="Database choice")
    hosting: str = Field(description="Hosting platform")

    # Architecture
    architecture_pattern: str = Field(description="e.g., monolith, microservices")
    directory_structure: dict = Field(description="Project directory structure")

    # API
    api_endpoints: list[dict] = Field(description="API endpoint definitions")

    # Data
    data_schemas: dict = Field(description="Data models/schemas")

    # Infrastructure
    environment_variables: list[str] = Field(description="Required env vars")
    external_services: list[str] = Field(description="External APIs/services needed")


class TaskNode(BaseModel):
    """A task in the dependency graph."""

    id: str = Field(description="Task ID")
    title: str = Field(description="Task title")
    description: str = Field(description="Task description")
    dependencies: list[str] = Field(default_factory=list, description="IDs of dependent tasks")
    estimated_complexity: int = Field(ge=1, le=10, description="Complexity 1-10")
    acceptance_criteria: list[str] = Field(description="Criteria for completion")


class TaskGraph(BaseModel):
    """Dependency graph of tasks from Project Manager role."""

    project_id: str = Field(description="Project ID")
    tasks: list[TaskNode] = Field(description="All tasks")
    critical_path: list[str] = Field(description="Task IDs on critical path")
    estimated_total_complexity: int = Field(description="Sum of task complexities")
