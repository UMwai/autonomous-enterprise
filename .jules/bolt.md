## 2026-01-24 - Pagination Performance Anti-Pattern
**Learning:** The `list_runs` endpoint was fetching *all* records to count them (`len(result.scalars().all())`), causing O(N) memory usage. This is a common anti-pattern in SQLAlchemy when not using `func.count()`.
**Action:** Always use `select(func.count()).select_from(Model)` for counting totals in paginated endpoints. Verify with tests that mock `scalar()` (count) vs `scalars().all()` (list) to ensure the optimized query is used.

## 2026-01-24 - Missing Exports in Models
**Learning:** `RunType` was not exported in `ae_api.db.models.__init__.py`, causing import errors in tests even though the application code might have been working (or broken silently).
**Action:** Ensure all Enums and Models used in API signatures are explicitly exported in the package `__init__.py`.
