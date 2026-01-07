"""Add index to foreign keys

Revision ID: f900e7849245
Revises: 0001
Create Date: 2026-01-07 15:05:07.669344

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f900e7849245'
down_revision: Union[str, None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Run
    op.create_index(op.f('ix_runs_project_id'), 'runs', ['project_id'], unique=False)

    # Artifact
    op.create_index(op.f('ix_artifacts_project_id'), 'artifacts', ['project_id'], unique=False)

    # Genesis - NicheCandidate
    op.create_index(op.f('ix_niche_candidates_project_id'), 'niche_candidates', ['project_id'], unique=False)

    # Genesis - ProductSpec
    op.create_index(op.f('ix_product_specs_project_id'), 'product_specs', ['project_id'], unique=False)
    op.create_index(op.f('ix_product_specs_niche_id'), 'product_specs', ['niche_id'], unique=False)

    # Genesis - TechnicalSpec
    op.create_index(op.f('ix_technical_specs_project_id'), 'technical_specs', ['project_id'], unique=False)
    op.create_index(op.f('ix_technical_specs_product_spec_id'), 'technical_specs', ['product_spec_id'], unique=False)

    # Genesis - TaskGraph
    op.create_index(op.f('ix_task_graphs_project_id'), 'task_graphs', ['project_id'], unique=False)
    op.create_index(op.f('ix_task_graphs_technical_spec_id'), 'task_graphs', ['technical_spec_id'], unique=False)


def downgrade() -> None:
    # Genesis - TaskGraph
    op.drop_index(op.f('ix_task_graphs_technical_spec_id'), table_name='task_graphs')
    op.drop_index(op.f('ix_task_graphs_project_id'), table_name='task_graphs')

    # Genesis - TechnicalSpec
    op.drop_index(op.f('ix_technical_specs_product_spec_id'), table_name='technical_specs')
    op.drop_index(op.f('ix_technical_specs_project_id'), table_name='technical_specs')

    # Genesis - ProductSpec
    op.drop_index(op.f('ix_product_specs_niche_id'), table_name='product_specs')
    op.drop_index(op.f('ix_product_specs_project_id'), table_name='product_specs')

    # Genesis - NicheCandidate
    op.drop_index(op.f('ix_niche_candidates_project_id'), table_name='niche_candidates')

    # Artifact
    op.drop_index(op.f('ix_artifacts_project_id'), table_name='artifacts')

    # Run
    op.drop_index(op.f('ix_runs_project_id'), table_name='runs')
