# Bolt's Journal ⚡

## 2026-01-03 - [Missing Foreign Key Indexes]
**Learning:** Postgres does not automatically index Foreign Keys. SQLAlchemy's `ForeignKey` definition creates the constraint but not the index.
**Action:** Always add `index=True` to `ForeignKey` columns in SQLAlchemy models for Postgres to prevent performance bottlenecks on joins and cascade deletes.
