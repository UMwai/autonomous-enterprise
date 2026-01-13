"""Add missing foreign key indexes.

Revision ID: 0002
Revises: 0001
Create Date: 2024-12-21

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
    # Add index for ProductSpec.niche_id
    op.create_index(
        op.f("ix_product_specs_niche_id"),
        "product_specs",
        ["niche_id"],
        unique=False
    )

    # Add index for TechnicalSpec.product_spec_id
    op.create_index(
        op.f("ix_technical_specs_product_spec_id"),
        "technical_specs",
        ["product_spec_id"],
        unique=False
    )

    # Add index for TaskGraph.technical_spec_id
    op.create_index(
        op.f("ix_task_graphs_technical_spec_id"),
        "task_graphs",
        ["technical_spec_id"],
        unique=False
    )

    # Note: project_id indexes were already created in 0001 for most tables,
    # even though they were missing 'index=True' in the models.
    # We added 'index=True' to models to keep them in sync, but no DB change needed for them.


def downgrade() -> None:
    op.drop_index(op.f("ix_task_graphs_technical_spec_id"), table_name="task_graphs")
    op.drop_index(op.f("ix_technical_specs_product_spec_id"), table_name="technical_specs")
    op.drop_index(op.f("ix_product_specs_niche_id"), table_name="product_specs")
