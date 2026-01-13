"""Run model for tracking workflow executions."""

from enum import Enum
from typing import TYPE_CHECKING

from sqlalchemy import JSON, ForeignKey, String, Text, Float
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ae_api.db.models.base import Base

if TYPE_CHECKING:
    from ae_api.db.models.project import Project


class RunStatus(str, Enum):
    """Run status enum."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    PAUSED = "paused"


class RunType(str, Enum):
    """Run type enum."""

    GENESIS = "genesis"
    BUILD = "build"
    TEST = "test"
    DEPLOY = "deploy"
    MONETIZE = "monetize"


class Run(Base):
    """Run model tracking individual workflow executions."""

    __tablename__ = "runs"

    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    workflow_id: Mapped[str] = mapped_column(String(255), nullable=False)
    run_type: Mapped[RunType] = mapped_column(String(50), nullable=False)
    status: Mapped[RunStatus] = mapped_column(
        String(50),
        default=RunStatus.PENDING,
        nullable=False,
    )

    # Input/Output
    input_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    output_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Cost tracking
    tokens_used: Mapped[int] = mapped_column(default=0, nullable=False)
    cost_incurred: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    # Model routing stats
    model_routing: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Relationships
    project: Mapped["Project"] = relationship("Project", back_populates="runs")
