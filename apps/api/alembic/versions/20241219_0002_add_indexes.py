"""Add missing indexes for foreign keys.

Revision ID: 20241219_0002
Revises: 0001
Create Date: 2024-12-19 12:00:00.000000

"""
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20241219_0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Add index for ProductSpec.niche_id
    op.create_index(
        "ix_product_specs_niche_id", "product_specs", ["niche_id"], unique=False
    )
    # Add index for TechnicalSpec.product_spec_id
    op.create_index(
        "ix_technical_specs_product_spec_id",
        "technical_specs",
        ["product_spec_id"],
        unique=False,
    )
    # Add index for TaskGraph.technical_spec_id
    op.create_index(
        "ix_task_graphs_technical_spec_id",
        "task_graphs",
        ["technical_spec_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_task_graphs_technical_spec_id", table_name="task_graphs")
    op.drop_index("ix_technical_specs_product_spec_id", table_name="technical_specs")
    op.drop_index("ix_product_specs_niche_id", table_name="product_specs")
