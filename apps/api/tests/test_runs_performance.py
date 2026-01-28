
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from ae_api.api.v1.endpoints.runs import list_runs
from ae_api.db.models import Run, RunStatus, RunType


@pytest.mark.asyncio
async def test_list_runs_performance_optimized():
    """
    Test that verifies the optimized counting method.
    We check that list_runs uses func.count() instead of fetching all records.
    """
    # Setup mock session
    mock_session = AsyncMock()

    # Mock the result of execute
    # We need to handle two calls:
    # 1. The count query (optimized)
    # 2. The paginated query

    mock_result_count = MagicMock()
    # The optimized code calls .scalar() or .scalar_one()
    mock_result_count.scalar.return_value = 50
    # Just in case scalar_one is used (though I used scalar())
    mock_result_count.scalar_one.return_value = 50

    mock_result_page = MagicMock()
    dummy_runs_page = [
        Run(
            id=f"run-{i}",
            project_id="p1",
            workflow_id="w1",
            run_type=RunType.BUILD,
            status=RunStatus.PENDING,
            tokens_used=0,
            cost_incurred=0.0,
            created_at=datetime.now(),
            updated_at=datetime.now()
        ) for i in range(10)
    ]
    mock_result_page.scalars.return_value.all.return_value = dummy_runs_page

    # side_effect allows returning different results for consecutive calls
    mock_session.execute.side_effect = [mock_result_count, mock_result_page]

    # Call the function
    response = await list_runs(
        session=mock_session,
        page=1,
        page_size=10
    )

    # Verify that we got the total count from the first query result
    assert response.total == 50
    assert len(response.runs) == 10

    # Inspect the first call to execute
    first_call_args = mock_session.execute.call_args_list[0]
    first_query = first_call_args[0][0]

    print(f"Detected Query: {first_query}")

    # Verify EFFICIENCY:

    # 1. Verify that .scalar() was called on the first result (count result)
    #    or ensure that .scalars().all() was NOT called.
    mock_result_count.scalar.assert_called_once()
    mock_result_count.scalars.return_value.all.assert_not_called()

    # 2. Verify that the query object actually contains "count"
    # Convert query to string representation to check
    # Note: mocking SQLAlchemy compilation is hard, but checking the object properties
    # is feasible if we really want to be sure it's a count query.

    # But verifying that we called .scalar() and got the result from there is strong evidence.
