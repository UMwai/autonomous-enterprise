# Bolt's Journal ⚡

## 2024-05-22 - Pagination Strategy
**Learning:** `count()` on large tables is expensive in PostgreSQL.
**Action:** Always use `select(func.count())` which is more efficient than loading all models and counting in Python, but for truly massive tables, consider estimated counts or separate counter tables.

## 2024-05-22 - Database Testing
**Learning:** Integration tests fail without Redis.
**Action:** Ensure Redis is available or mocked properly when running full integration suites.

## 2024-05-22 - Foreign Key Indexing
**Learning:** SQLAlchemy does not automatically index Foreign Keys.
**Action:** Always explicitly set `index=True` on `ForeignKey` columns in models to avoid full table scans during joins.
