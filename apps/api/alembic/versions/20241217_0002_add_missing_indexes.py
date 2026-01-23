"""Add missing indexes to foreign keys.

Revision ID: 0002
Revises: 0001
Create Date: 2024-12-17

"""
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Add indexes for foreign keys in genesis models
    op.create_index("ix_product_specs_niche_id", "product_specs", ["niche_id"])
    op.create_index("ix_technical_specs_product_spec_id", "technical_specs", ["product_spec_id"])
    op.create_index("ix_task_graphs_technical_spec_id", "task_graphs", ["technical_spec_id"])


def downgrade() -> None:
    # Remove indexes
    op.drop_index("ix_task_graphs_technical_spec_id", table_name="task_graphs")
    op.drop_index("ix_technical_specs_product_spec_id", table_name="technical_specs")
    op.drop_index("ix_product_specs_niche_id", table_name="product_specs")
