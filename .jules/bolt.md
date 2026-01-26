## 2026-01-26 - Missing Database Indexes on Foreign Keys
**Learning:** SQLAlchemy does not automatically create indexes for `ForeignKey` columns. This can lead to silent performance degradation in join operations and cascading deletes (which are used extensively in this codebase).
**Action:** Always explicitly set `index=True` when defining `ForeignKey` columns in SQLAlchemy models, and verify with `alembic` migrations.
