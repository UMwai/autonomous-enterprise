## 2024-05-23 - Missing Foreign Key Indexes
**Learning:** PostgreSQL does not automatically index foreign keys, unlike some other databases. This can lead to slow joins and filtering by parent entity, especially for high-volume tables like `runs` and `artifacts`.
**Action:** Always verify that `ForeignKey` columns in SQLAlchemy models have `index=True` explicitly set, particularly for relationship traversal and filtering.
