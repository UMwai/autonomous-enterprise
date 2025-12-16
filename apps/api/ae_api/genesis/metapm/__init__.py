"""MetaPM - MetaGPT-powered Product Management Module.

This module orchestrates multiple AI roles (PM, Architect, Project Manager) to
automatically generate product specifications, technical designs, and task graphs
from validated niche opportunities.
"""

from ae_api.genesis.metapm.metagpt_runner import (
    MetaGPTRunner,
    ProductSpec,
    TaskGraph,
    TechnicalSpec,
)
from ae_api.genesis.metapm.roles import (
    ArchitectRole,
    PMRole,
    ProjectManagerRole,
)

__all__ = [
    "PMRole",
    "ArchitectRole",
    "ProjectManagerRole",
    "ProductSpec",
    "TechnicalSpec",
    "TaskGraph",
    "MetaGPTRunner",
]
