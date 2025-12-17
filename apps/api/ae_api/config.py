"""Configuration management for the Autonomous Enterprise API."""

from functools import lru_cache
from typing import Literal

from pydantic import Field, PostgresDsn, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application
    app_name: str = "Autonomous Enterprise"
    app_version: str = "0.1.0"
    debug: bool = False
    environment: Literal["development", "staging", "production"] = "development"

    # Database
    database_url: PostgresDsn = Field(
        default="postgresql+asyncpg://ae:ae@localhost:5432/ae"
    )

    # Temporal
    temporal_host: str = "localhost:7233"
    temporal_namespace: str = "default"
    temporal_task_queue: str = "autonomous-enterprise"

    # LLM Providers
    openai_api_key: SecretStr | None = None
    anthropic_api_key: SecretStr | None = None
    google_api_key: SecretStr | None = None

    # Model Router Defaults (Premium models only)
    tier1_model: str = "claude-opus-4-5-20251101"  # Claude Opus 4.5
    tier2_model: str = "gpt-5.2"  # GPT-5.2
    tier3_model: str = "gemini-3-pro-preview"  # Gemini 3 Pro Preview

    # Cost Budgets (per run, in USD)
    default_run_budget: float = 10.0
    max_run_budget: float = 100.0

    # Stripe
    stripe_api_key: SecretStr | None = None
    stripe_webhook_secret: SecretStr | None = None

    # Deployment
    vercel_token: SecretStr | None = None
    netlify_token: SecretStr | None = None

    # E2B Sandbox
    e2b_api_key: SecretStr | None = None

    # Redis
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_db: int = 0
    redis_password: SecretStr | None = None

    # Observability
    langsmith_api_key: SecretStr | None = None
    langsmith_project: str = "autonomous-enterprise"
    phoenix_endpoint: str = "http://localhost:6006"
    otel_exporter_otlp_endpoint: str = "http://localhost:4317"

    # RAG/Vector Store
    embedding_model: str = "text-embedding-3-small"
    vector_dimensions: int = 1536


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
