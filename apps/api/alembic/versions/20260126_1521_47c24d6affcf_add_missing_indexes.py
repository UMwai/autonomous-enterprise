"""add_missing_indexes

Revision ID: 47c24d6affcf
Revises: 0001
Create Date: 2026-01-26 15:21:30.770193

"""
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '47c24d6affcf'
down_revision: str | None = '0001'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Note: project_id indexes were created in 0001_initial_schema.py but were missing
    # index=True in the SQLAlchemy models. We have updated the models to match.
    # We only create the indexes that were strictly missing from the database here.
    op.create_index("ix_runs_status", "runs", ["status"])
    op.create_index("ix_projects_status", "projects", ["status"])
    op.create_index("ix_product_specs_niche_id", "product_specs", ["niche_id"])
    op.create_index("ix_technical_specs_product_spec_id", "technical_specs", ["product_spec_id"])
    op.create_index("ix_task_graphs_technical_spec_id", "task_graphs", ["technical_spec_id"])


def downgrade() -> None:
    op.drop_index("ix_task_graphs_technical_spec_id", table_name="task_graphs")
    op.drop_index("ix_technical_specs_product_spec_id", table_name="technical_specs")
    op.drop_index("ix_product_specs_niche_id", table_name="product_specs")
    op.drop_index("ix_projects_status", table_name="projects")
    op.drop_index("ix_runs_status", table_name="runs")
