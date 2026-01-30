"""Add missing indexes to foreign keys.

Revision ID: 0002
Revises: 0001
Create Date: 2026-01-30

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add missing indexes for foreign keys to prevent sequential scans.
    # Note: Indexes for `project_id` on all tables, and indexes for `TrendDocument`
    # (`source`, `source_id`), were already created in revision 0001_initial_schema.py.
    # The models were updated to reflect these existing indexes (`index=True`),
    # but since they exist in the DB, we do not need to create them here.

    # The following indexes were MISSING in 0001 and are added now:
    op.create_index("ix_artifacts_run_id", "artifacts", ["run_id"])
    op.create_index("ix_product_specs_niche_id", "product_specs", ["niche_id"])
    op.create_index("ix_technical_specs_product_spec_id", "technical_specs", ["product_spec_id"])
    op.create_index("ix_task_graphs_technical_spec_id", "task_graphs", ["technical_spec_id"])


def downgrade() -> None:
    # Remove indexes
    op.drop_index("ix_task_graphs_technical_spec_id", table_name="task_graphs")
    op.drop_index("ix_technical_specs_product_spec_id", table_name="technical_specs")
    op.drop_index("ix_product_specs_niche_id", table_name="product_specs")
    op.drop_index("ix_artifacts_run_id", table_name="artifacts")
