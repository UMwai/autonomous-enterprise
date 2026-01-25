## 2024-12-19 - Database Index Drift
**Learning:** Found that `0001_initial_schema.py` manually created indexes (e.g., `ix_runs_project_id`) that were missing from SQLAlchemy models. This creates a risk of `alembic autogenerate` dropping them or missing them in future migrations. Also identified missing indexes for `genesis` models (`niche_id`, `product_spec_id`, `technical_spec_id`) that were neither in the models nor the migrations.
**Action:** Always check both the SQLAlchemy model AND the existing migration files when verifying indexes. Don't assume `autogenerate` matches the current schema if manual edits were made to migrations.

## 2024-12-19 - API Build Requirements
**Learning:** `apps/api` build system (pyproject.toml) strictly requires `README.md` to exist, otherwise `pip install` fails.
**Action:** Ensure `README.md` exists before attempting to install dependencies in `apps/api`.
