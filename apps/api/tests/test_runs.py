
import pytest
from unittest.mock import AsyncMock, MagicMock
from ae_api.api.v1.endpoints.runs import list_runs
from ae_api.db.models import Run

@pytest.mark.asyncio
async def test_list_runs_optimized_count():
    """
    Test that proves the optimized implementation uses count() query.
    """
    # Setup
    session = AsyncMock()

    # Mock the result for the count query (first execution)
    count_result = MagicMock()
    # The optimized code uses .scalar()
    count_result.scalar.return_value = 2

    # Mock the result for the pagination query (second execution)
    page_result = MagicMock()
    page_result.scalars.return_value.all.return_value = []

    # session.execute will be called twice.
    session.execute.side_effect = [count_result, page_result]

    # Execute
    await list_runs(session=session, page=1, page_size=10)

    # Verification
    # Assert that scalar() was called on the first result (count)
    assert count_result.scalar.called
    # Assert that scalars().all() was NOT called on the first result
    assert not count_result.scalars.called
