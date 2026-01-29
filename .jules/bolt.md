## 2025-05-21 - [Build Config Requirement]
**Learning:** `apps/api` requires a `README.md` to be present for `pip install -e .` to work, otherwise the build backend (hatchling) fails with an OSError.
**Action:** Always ensure README.md exists in python packages using hatchling/pyproject.toml before attempting install.

## 2025-05-21 - [SQLAlchemy Pagination Anti-Pattern]
**Learning:** `list_runs` endpoint was fetching all records to count them (`len(result.scalars().all())`), causing O(N) memory usage.
**Action:** Use `select(func.count()).select_from(query.subquery())` for efficient counting.
