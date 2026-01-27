## 2024-12-21 - PostgreSQL Foreign Key Indexing
**Learning:** PostgreSQL does not automatically index foreign key columns. This can lead to severe performance degradation on joins and cascade deletes. SQLAlchemy models must explicitly set `index=True` on `ForeignKey` columns.
**Action:** When defining relationships in SQLAlchemy, always verify that the foreign key column has `index=True` or a composite index covering it.
