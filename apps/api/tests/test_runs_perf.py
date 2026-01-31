
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime

from sqlalchemy import select, func
from ae_api.api.v1.endpoints.runs import list_runs, RunListResponse
from ae_api.db.models import Run, RunStatus, RunType

@pytest.mark.asyncio
async def test_list_runs_performance_optimization():
    # Mock session
    mock_session = AsyncMock()

    # Mock the result of the first query (count)
    # Optimized implementation fetches a single scalar (count)
    mock_result_count = MagicMock()
    mock_result_count.scalar_one.return_value = 5

    # Mock the result of the second query (pagination)
    mock_result_page = MagicMock()
    mock_result_page.scalars.return_value.all.return_value = [
        Run(
            id="run-0",
            project_id="proj-1",
            workflow_id="wf-1",
            run_type=RunType.GENESIS,
            status=RunStatus.PENDING,
            created_at=datetime.now(),
            updated_at=datetime.now(),
            tokens_used=100,
            cost_incurred=0.01
        )
    ]

    # Configure side_effect for session.execute to return different results
    mock_session.execute.side_effect = [mock_result_count, mock_result_page]

    # Call the endpoint
    response = await list_runs(
        session=mock_session,
        project_id="proj-1",
        page=1,
        page_size=20
    )

    # Verify response
    assert isinstance(response, RunListResponse)
    assert response.total == 5
    assert len(response.runs) == 1

    # Verify the first query was a count query
    # The first call to execute passes the query object.
    args, _ = mock_session.execute.call_args_list[0]
    query_obj = args[0]

    # Check that scalar_one() was called (indicating optimization)
    mock_result_count.scalar_one.assert_called()

    # Ensure scalars().all() was NOT called on the first result
    mock_result_count.scalars.assert_not_called()
