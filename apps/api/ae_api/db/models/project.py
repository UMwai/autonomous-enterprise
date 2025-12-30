"""Project model."""

from enum import Enum
from typing import TYPE_CHECKING

from sqlalchemy import JSON, String, Text, Float
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ae_api.db.models.base import Base

if TYPE_CHECKING:
    from ae_api.db.models.run import Run
    from ae_api.db.models.artifact import Artifact
    from ae_api.db.models.genesis import (
        NicheCandidate,
        ProductSpec,
        TechnicalSpec,
        TaskGraph,
    )


class ProjectStatus(str, Enum):
    """Project status enum."""

    IDEATION = "ideation"
    VALIDATION = "validation"
    DEVELOPMENT = "development"
    DEPLOYMENT = "deployment"
    MONETIZING = "monetizing"
    PAUSED = "paused"
    FAILED = "failed"


class Project(Base):
    """Project model representing an autonomous software project."""

    __tablename__ = "projects"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    intent: Mapped[str] = mapped_column(Text, nullable=False)  # Original user intent
    status: Mapped[ProjectStatus] = mapped_column(
        String(50),
        default=ProjectStatus.IDEATION,
        nullable=False,
    )

    # Niche/Market data
    niche: Mapped[str | None] = mapped_column(String(255), nullable=True)
    validation_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    estimated_mrr: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Technical spec
    tech_stack: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    architecture: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Deployment
    repository_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    deployment_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    domain: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Monetization
    stripe_product_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    stripe_price_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    payment_link_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Budget
    budget_limit: Mapped[float] = mapped_column(Float, default=10.0, nullable=False)
    budget_spent: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    # Relationships
    runs: Mapped[list["Run"]] = relationship("Run", back_populates="project")
    artifacts: Mapped[list["Artifact"]] = relationship("Artifact", back_populates="project")

    # Genesis relationships
    niche_candidates: Mapped[list["NicheCandidate"]] = relationship(
        "NicheCandidate", back_populates="project", cascade="all, delete-orphan"
    )
    product_specs: Mapped[list["ProductSpec"]] = relationship(
        "ProductSpec", back_populates="project", cascade="all, delete-orphan"
    )
    technical_specs: Mapped[list["TechnicalSpec"]] = relationship(
        "TechnicalSpec", back_populates="project", cascade="all, delete-orphan"
    )
    task_graphs: Mapped[list["TaskGraph"]] = relationship(
        "TaskGraph", back_populates="project", cascade="all, delete-orphan"
    )
