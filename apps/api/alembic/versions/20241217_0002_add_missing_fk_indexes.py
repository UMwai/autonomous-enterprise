"""Add missing FK indexes

Revision ID: 0002
Revises: 0001
Create Date: 2024-12-17

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
    # Add indexes for foreign keys that were missing in initial schema
    op.create_index("ix_product_specs_niche_id", "product_specs", ["niche_id"])
    op.create_index("ix_technical_specs_product_spec_id", "technical_specs", ["product_spec_id"])
    op.create_index("ix_task_graphs_technical_spec_id", "task_graphs", ["technical_spec_id"])


def downgrade() -> None:
    op.drop_index("ix_task_graphs_technical_spec_id", table_name="task_graphs")
    op.drop_index("ix_technical_specs_product_spec_id", table_name="technical_specs")
    op.drop_index("ix_product_specs_niche_id", table_name="product_specs")
