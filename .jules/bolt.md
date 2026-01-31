## 2024-05-23 - Pagination Count Anti-Pattern
**Learning:** The codebase was using `len(await session.execute(query).scalars().all())` to count total records for pagination. This loads all records into memory, which is O(N) memory usage.
**Action:** Always use `select(func.count()).select_from(...)` (or `.where(...)`) to fetch the count as a scalar O(1) before fetching the page data.

## 2024-05-23 - Missing Model Exports
**Learning:** `RunType` enum was used in API endpoints but not exported in `ae_api/db/models/__init__.py`, causing `ImportError` in tests even though the app might work (likely due to circular imports or different import paths at runtime).
**Action:** Ensure all enums and models used in API schemas are explicitly exported in the models package `__init__.py`.
