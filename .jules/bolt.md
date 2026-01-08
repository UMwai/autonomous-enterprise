## 2024-12-21 - [PostgreSQL Foreign Key Indexing]
**Learning:** PostgreSQL does not automatically create indexes for Foreign Key columns. This is a common performance pitfall that leads to slow JOINs and cascading DELETEs. SQLAlchemy models should explicitly set `index=True` on `ForeignKey` columns to ensure these indexes are created.
**Action:** Always check `ForeignKey` definitions in SQLAlchemy models. If `index=True` is missing, it's likely a missing index in the database unless explicitly added in a migration. Use `alembic` to verify or manually add these indexes.
