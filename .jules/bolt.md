## 2024-12-17 - Missing Database Indexes on Foreign Keys
**Learning:** PostgreSQL does not automatically index foreign keys. SQLAlchemy models must explicitly define `index=True` on `ForeignKey` columns to ensure performant joins and filtering.
**Action:** Always verify `index=True` is set on `ForeignKey` definitions in SQLAlchemy models.
