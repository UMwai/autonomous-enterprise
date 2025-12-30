"""Initial schema with all models.

Revision ID: 0001
Revises:
Create Date: 2024-12-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create projects table
    op.create_table(
        "projects",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("intent", sa.Text, nullable=False),
        sa.Column("status", sa.String(50), nullable=False, default="ideation"),
        sa.Column("niche", sa.String(255), nullable=True),
        sa.Column("validation_score", sa.Float, nullable=True),
        sa.Column("estimated_mrr", sa.Float, nullable=True),
        sa.Column("tech_stack", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column("architecture", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column("repository_url", sa.String(500), nullable=True),
        sa.Column("deployment_url", sa.String(500), nullable=True),
        sa.Column("domain", sa.String(255), nullable=True),
        sa.Column("stripe_product_id", sa.String(255), nullable=True),
        sa.Column("stripe_price_id", sa.String(255), nullable=True),
        sa.Column("payment_link_url", sa.String(500), nullable=True),
        sa.Column("budget_limit", sa.Float, nullable=False, default=10.0),
        sa.Column("budget_spent", sa.Float, nullable=False, default=0.0),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )

    # Create runs table
    op.create_table(
        "runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("workflow_type", sa.String(50), nullable=False),
        sa.Column("workflow_id", sa.String(255), nullable=False),
        sa.Column("status", sa.String(50), nullable=False, default="pending"),
        sa.Column("started_at", sa.DateTime, nullable=True),
        sa.Column("completed_at", sa.DateTime, nullable=True),
        sa.Column("error", sa.Text, nullable=True),
        sa.Column("metadata_", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_runs_project_id", "runs", ["project_id"])
    op.create_index("ix_runs_workflow_id", "runs", ["workflow_id"])

    # Create artifacts table
    op.create_table(
        "artifacts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("run_id", sa.String(36), sa.ForeignKey("runs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("artifact_type", sa.String(50), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("content", sa.Text, nullable=True),
        sa.Column("url", sa.String(500), nullable=True),
        sa.Column("metadata_", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_artifacts_project_id", "artifacts", ["project_id"])

    # Create niche_candidates table
    op.create_table(
        "niche_candidates",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("target_audience", sa.Text, nullable=False),
        sa.Column("value_proposition", sa.Text, nullable=True),
        sa.Column("pain_points", postgresql.JSON(astext_type=sa.Text()), nullable=False, default=[]),
        sa.Column("evidence_urls", postgresql.JSON(astext_type=sa.Text()), nullable=False, default=[]),
        sa.Column("evidence_quotes", postgresql.JSON(astext_type=sa.Text()), nullable=False, default=[]),
        sa.Column("pain_intensity", sa.Float, nullable=False, default=0.0),
        sa.Column("market_size_estimate", sa.String(50), nullable=True),
        sa.Column("competition_level", sa.String(50), nullable=True),
        sa.Column("composite_score", sa.Float, nullable=False, default=0.0),
        sa.Column("status", sa.String(50), nullable=False, default="identified"),
        sa.Column("validation_score", sa.Float, nullable=True),
        sa.Column("search_volume", sa.Integer, nullable=True),
        sa.Column("keyword_difficulty", sa.Float, nullable=True),
        sa.Column("estimated_arpu", sa.Float, nullable=True),
        sa.Column("should_pursue", sa.Boolean, nullable=False, default=False),
        sa.Column("validation_strengths", postgresql.JSON(astext_type=sa.Text()), nullable=False, default=[]),
        sa.Column("validation_weaknesses", postgresql.JSON(astext_type=sa.Text()), nullable=False, default=[]),
        sa.Column("validation_recommendations", postgresql.JSON(astext_type=sa.Text()), nullable=False, default=[]),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_niche_candidates_project_id", "niche_candidates", ["project_id"])

    # Create product_specs table
    op.create_table(
        "product_specs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("niche_id", sa.String(36), sa.ForeignKey("niche_candidates.id", ondelete="SET NULL"), nullable=True),
        sa.Column("product_name", sa.String(255), nullable=False),
        sa.Column("vision_statement", sa.Text, nullable=False),
        sa.Column("target_users", sa.Text, nullable=False),
        sa.Column("go_to_market", sa.Text, nullable=True),
        sa.Column("core_features", postgresql.JSON(astext_type=sa.Text()), nullable=False, default=[]),
        sa.Column("user_stories", postgresql.JSON(astext_type=sa.Text()), nullable=False, default=[]),
        sa.Column("success_metrics", postgresql.JSON(astext_type=sa.Text()), nullable=False, default=[]),
        sa.Column("pricing_model", sa.String(50), nullable=True),
        sa.Column("target_price", sa.Float, nullable=True),
        sa.Column("version", sa.Integer, nullable=False, default=1),
        sa.Column("is_approved", sa.Boolean, nullable=False, default=False),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_product_specs_project_id", "product_specs", ["project_id"])

    # Create technical_specs table
    op.create_table(
        "technical_specs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_spec_id", sa.String(36), sa.ForeignKey("product_specs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("tech_stack", postgresql.JSON(astext_type=sa.Text()), nullable=False, default={}),
        sa.Column("architecture_description", sa.Text, nullable=False),
        sa.Column("architecture_diagram", sa.Text, nullable=True),
        sa.Column("data_models", postgresql.JSON(astext_type=sa.Text()), nullable=False, default=[]),
        sa.Column("api_design", postgresql.JSON(astext_type=sa.Text()), nullable=False, default=[]),
        sa.Column("deployment_strategy", sa.Text, nullable=True),
        sa.Column("infrastructure_requirements", postgresql.JSON(astext_type=sa.Text()), nullable=False, default=[]),
        sa.Column("environment_variables", postgresql.JSON(astext_type=sa.Text()), nullable=False, default=[]),
        sa.Column("external_services", postgresql.JSON(astext_type=sa.Text()), nullable=False, default=[]),
        sa.Column("security_considerations", postgresql.JSON(astext_type=sa.Text()), nullable=False, default=[]),
        sa.Column("version", sa.Integer, nullable=False, default=1),
        sa.Column("is_approved", sa.Boolean, nullable=False, default=False),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_technical_specs_project_id", "technical_specs", ["project_id"])

    # Create task_graphs table
    op.create_table(
        "task_graphs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("technical_spec_id", sa.String(36), sa.ForeignKey("technical_specs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("tasks", postgresql.JSON(astext_type=sa.Text()), nullable=False, default=[]),
        sa.Column("critical_path", postgresql.JSON(astext_type=sa.Text()), nullable=False, default=[]),
        sa.Column("parallel_workstreams", postgresql.JSON(astext_type=sa.Text()), nullable=False, default=[]),
        sa.Column("total_estimated_hours", sa.Float, nullable=False, default=0.0),
        sa.Column("total_estimated_cost", sa.Float, nullable=True),
        sa.Column("tasks_completed", sa.Integer, nullable=False, default=0),
        sa.Column("tasks_in_progress", sa.Integer, nullable=False, default=0),
        sa.Column("tasks_failed", sa.Integer, nullable=False, default=0),
        sa.Column("version", sa.Integer, nullable=False, default=1),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_task_graphs_project_id", "task_graphs", ["project_id"])

    # Create trend_documents table
    op.create_table(
        "trend_documents",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("source", sa.String(50), nullable=False),
        sa.Column("source_id", sa.String(255), nullable=False),
        sa.Column("source_url", sa.String(500), nullable=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("author", sa.String(255), nullable=True),
        sa.Column("score", sa.Integer, nullable=False, default=0),
        sa.Column("comments", sa.Integer, nullable=False, default=0),
        sa.Column("metadata_", postgresql.JSON(astext_type=sa.Text()), nullable=False, default={}),
        sa.Column("embedding_model", sa.String(100), nullable=True),
        sa.Column("embedding_dimensions", sa.Integer, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_trend_documents_source", "trend_documents", ["source"])
    op.create_index("ix_trend_documents_source_id", "trend_documents", ["source_id"], unique=True)


def downgrade() -> None:
    op.drop_table("trend_documents")
    op.drop_table("task_graphs")
    op.drop_table("technical_specs")
    op.drop_table("product_specs")
    op.drop_table("niche_candidates")
    op.drop_table("artifacts")
    op.drop_table("runs")
    op.drop_table("projects")
