"""Artifact model for storing generated outputs."""

from enum import Enum
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ae_api.db.models.base import Base

if TYPE_CHECKING:
    from ae_api.db.models.project import Project


class ArtifactType(str, Enum):
    """Artifact type enum."""

    PRD = "prd"  # Product Requirements Document
    ARCHITECTURE = "architecture"  # Technical architecture
    TASK_GRAPH = "task_graph"  # Task dependency graph
    SOURCE_CODE = "source_code"  # Generated source code
    TEST_RESULTS = "test_results"  # Test execution results
    BUILD_LOG = "build_log"  # Build logs
    DEPLOYMENT_LOG = "deployment_log"  # Deployment logs
    SPEC = "spec"  # Living spec (CLAUDE.md/GEMINI.md)


class Artifact(Base):
    """Artifact model for storing generated project outputs."""

    __tablename__ = "artifacts"

    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    artifact_type: Mapped[ArtifactType] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    # Storage
    storage_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)  # For small artifacts
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)  # SHA256

    # Metadata
    mime_type: Mapped[str] = mapped_column(String(100), default="text/plain")
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)

    # Relationships
    project: Mapped["Project"] = relationship("Project", back_populates="artifacts")
