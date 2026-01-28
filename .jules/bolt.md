## 2024-05-23 - API Pagination Anti-Pattern
**Learning:** The `list_runs` endpoint was fetching ALL records (thousands) just to count them (`len(all())`), causing massive memory/CPU spike. This is a common anti-pattern in SQLAlchemy when not using `func.count()`.
**Action:** Always check pagination logic for `len(result.all())`. Use `select(func.count()).select_from(Model).where(...)` for O(1) counting.
