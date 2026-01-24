import pytest
from unittest.mock import MagicMock, AsyncMock
from ae_api.api.v1.endpoints.runs import list_runs
from ae_api.db.models import Run, RunStatus, RunType

@pytest.mark.asyncio
async def test_list_runs_pagination_optimization():
    """
    Verifies that list_runs uses an optimized count query.

    The test sets up the mock for the first query result (count) to support .scalar(),
    which is what the optimized code should call.

    If the code is unoptimized (fetching all records), it will try to call .scalars().all()
    and len() on the first result, which will fail or behave differently than expected
    with this mock setup.
    """
    # Mock session
    session = AsyncMock()

    # 1. Mock result for count query (Optimization target)
    # The optimized code should call scalar() on this result to get the count
    count_result = MagicMock()
    count_result.scalar.return_value = 100

    # 2. Mock result for data query
    # The code should call scalars().all() on this result to get the rows
    run_instance = Run(
        id="run-1",
        project_id="proj-1",
        workflow_id="wf-1",
        run_type=RunType.GENESIS,
        status=RunStatus.COMPLETED,
        tokens_used=100,
        cost_incurred=0.5,
    )
    # Mock date fields
    run_instance.created_at = MagicMock()
    run_instance.created_at.isoformat.return_value = "2024-01-01T00:00:00"
    run_instance.updated_at = MagicMock()
    run_instance.updated_at.isoformat.return_value = "2024-01-01T00:00:00"

    data_result = MagicMock()
    data_result.scalars.return_value.all.return_value = [run_instance]

    # Setup side effects for session.execute
    # First call: count query -> returns count_result
    # Second call: data query -> returns data_result
    session.execute.side_effect = [count_result, data_result]

    # Call the function
    response = await list_runs(
        session=session,
        page=1,
        page_size=10
    )

    # Assertions
    assert response.total == 100
    assert len(response.runs) == 1
    assert response.runs[0].id == "run-1"

    # Verify two queries were executed
    assert session.execute.call_count == 2
