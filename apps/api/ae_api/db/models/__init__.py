"""Database models package."""

from ae_api.db.models.artifact import Artifact, ArtifactType
from ae_api.db.models.base import Base
from ae_api.db.models.genesis import (
    NicheCandidate,
    NicheStatus,
    ProductSpec,
    TaskGraph,
    TechnicalSpec,
    TrendDocument,
)
from ae_api.db.models.project import Project, ProjectStatus
from ae_api.db.models.run import Run, RunStatus

__all__ = [
    "Base",
    "Project",
    "ProjectStatus",
    "Run",
    "RunStatus",
    "Artifact",
    "ArtifactType",
    # Genesis models
    "NicheCandidate",
    "NicheStatus",
    "ProductSpec",
    "TechnicalSpec",
    "TaskGraph",
    "TrendDocument",
]
