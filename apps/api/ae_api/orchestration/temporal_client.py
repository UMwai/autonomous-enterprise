"""Temporal client wrapper for Autonomous Enterprise workflows."""

import asyncio
from typing import Any, Optional

from temporalio.client import (
    Client,
    WorkflowExecutionStatus,
    WorkflowFailureError,
    WorkflowHandle,
)
from temporalio.service import TLSConfig

from ae_api.config import Settings, get_settings
from ae_api.orchestration.ids import (
    build_workflow_id,
    deploy_workflow_id,
    genesis_workflow_id_from_intent,
)


class TemporalClient:
    """
    Wrapper around Temporal client for managing Autonomous Enterprise workflows.

    Provides high-level methods for starting, querying, and managing workflows
    with proper error handling and type safety.
    """

    def __init__(self, settings: Optional[Settings] = None):
        """
        Initialize Temporal client wrapper.

        Args:
            settings: Optional settings instance (defaults to global settings)
        """
        self.settings = settings or get_settings()
        self._client: Optional[Client] = None

    async def connect(self) -> Client:
        """
        Establish async connection to Temporal server.

        Returns:
            Connected Temporal client instance

        Raises:
            Exception: If connection fails
        """
        if self._client is not None:
            return self._client

        # Parse TLS config if needed
        tls_config: Optional[TLSConfig] = None
        # Add TLS support if certificates are configured in settings
        # tls_config = TLSConfig(...)

        self._client = await Client.connect(
            self.settings.temporal_host,
            namespace=self.settings.temporal_namespace,
            tls=tls_config,
        )

        return self._client

    async def disconnect(self):
        """Close the Temporal client connection."""
        if self._client is not None:
            # Temporal client doesn't require explicit disconnect
            # but we clear the reference
            self._client = None

    async def start_genesis_workflow(
        self,
        intent: str,
        budget: float,
        workflow_id: Optional[str] = None,
        timeout_seconds: int = 3600,
    ) -> WorkflowHandle:
        """
        Start the Genesis workflow for product ideation and specification.

        Args:
            intent: User's intent/prompt for product generation
            budget: Budget in USD for this workflow run
            workflow_id: Optional custom workflow ID (auto-generated if None)
            timeout_seconds: Workflow execution timeout (default 1 hour)

        Returns:
            WorkflowHandle for querying status and results

        Raises:
            WorkflowFailureError: If workflow fails
        """
        client = await self.connect()

        # Generate stable workflow ID from intent if not provided
        wf_id = workflow_id or genesis_workflow_id_from_intent(intent)

        # Import workflow type (must be imported from worker package)
        # For now, using string reference
        workflow_type = "genesis"

        handle = await client.start_workflow(
            workflow_type,
            args=[
                {
                    "intent": intent,
                    "budget": budget,
                    "max_iterations": 3,
                }
            ],
            id=wf_id,
            task_queue=self.settings.temporal_task_queue,
            execution_timeout=asyncio.timedelta(seconds=timeout_seconds),
        )

        return handle

    async def start_build_workflow(
        self,
        spec: dict[str, Any],
        project_id: str,
        workflow_id: Optional[str] = None,
        timeout_seconds: int = 7200,
    ) -> WorkflowHandle:
        """
        Start the Build & Ship workflow for code generation and deployment.

        Args:
            spec: Product specification from Genesis workflow
            project_id: Unique project identifier
            workflow_id: Optional custom workflow ID (auto-generated if None)
            timeout_seconds: Workflow execution timeout (default 2 hours)

        Returns:
            WorkflowHandle for querying status and results

        Raises:
            WorkflowFailureError: If workflow fails
        """
        client = await self.connect()

        wf_id = workflow_id or build_workflow_id(project_id)

        workflow_type = "buildAndShip"

        handle = await client.start_workflow(
            workflow_type,
            args=[
                {
                    "spec": spec,
                    "project_id": project_id,
                    "run_tests": True,
                    "auto_deploy": True,
                }
            ],
            id=wf_id,
            task_queue=self.settings.temporal_task_queue,
            execution_timeout=asyncio.timedelta(seconds=timeout_seconds),
        )

        return handle

    async def start_deploy_workflow(
        self,
        project_id: str,
        version: str,
        deployment_target: str = "vercel",
        workflow_id: Optional[str] = None,
        timeout_seconds: int = 1800,
    ) -> WorkflowHandle:
        """
        Start a deployment workflow for an existing project.

        Args:
            project_id: Unique project identifier
            version: Version/tag to deploy
            deployment_target: Target platform (vercel, netlify, etc.)
            workflow_id: Optional custom workflow ID (auto-generated if None)
            timeout_seconds: Workflow execution timeout (default 30 minutes)

        Returns:
            WorkflowHandle for querying status and results
        """
        client = await self.connect()

        wf_id = workflow_id or deploy_workflow_id(project_id, version)

        workflow_type = "deploy"

        handle = await client.start_workflow(
            workflow_type,
            args=[
                {
                    "project_id": project_id,
                    "version": version,
                    "target": deployment_target,
                }
            ],
            id=wf_id,
            task_queue=self.settings.temporal_task_queue,
            execution_timeout=asyncio.timedelta(seconds=timeout_seconds),
        )

        return handle

    async def get_workflow_status(
        self, workflow_id: str
    ) -> dict[str, Any]:
        """
        Query the current status of a workflow.

        Args:
            workflow_id: ID of the workflow to query

        Returns:
            Dictionary containing workflow status information:
            - status: Current execution status
            - run_id: Unique run identifier
            - result: Workflow result if completed (None otherwise)
            - error: Error message if failed (None otherwise)
        """
        client = await self.connect()

        handle = client.get_workflow_handle(workflow_id)

        try:
            # Get workflow description for status
            desc = await handle.describe()

            result: Optional[Any] = None
            error: Optional[str] = None

            # If workflow is completed, try to get result
            if desc.status == WorkflowExecutionStatus.COMPLETED:
                try:
                    result = await handle.result()
                except WorkflowFailureError as e:
                    error = str(e)

            return {
                "workflow_id": workflow_id,
                "run_id": desc.run_id,
                "status": desc.status.name,
                "start_time": desc.start_time.isoformat() if desc.start_time else None,
                "close_time": desc.close_time.isoformat() if desc.close_time else None,
                "result": result,
                "error": error,
            }

        except Exception as e:
            return {
                "workflow_id": workflow_id,
                "run_id": None,
                "status": "UNKNOWN",
                "error": f"Failed to query workflow: {str(e)}",
                "result": None,
            }

    async def signal_workflow(
        self,
        workflow_id: str,
        signal: str,
        data: Optional[dict[str, Any]] = None,
    ) -> None:
        """
        Send a signal to a running workflow.

        Args:
            workflow_id: ID of the workflow to signal
            signal: Signal name (must match workflow signal handler)
            data: Optional data payload for the signal

        Raises:
            Exception: If signal fails
        """
        client = await self.connect()

        handle = client.get_workflow_handle(workflow_id)
        await handle.signal(signal, data or {})

    async def cancel_workflow(self, workflow_id: str, reason: Optional[str] = None) -> None:
        """
        Cancel a running workflow.

        Args:
            workflow_id: ID of the workflow to cancel
            reason: Optional cancellation reason

        Raises:
            Exception: If cancellation fails
        """
        client = await self.connect()

        handle = client.get_workflow_handle(workflow_id)
        await handle.cancel()

    async def query_workflow(
        self,
        workflow_id: str,
        query: str,
        args: Optional[list[Any]] = None,
    ) -> Any:
        """
        Query a running workflow for intermediate state.

        Args:
            workflow_id: ID of the workflow to query
            query: Query name (must match workflow query handler)
            args: Optional query arguments

        Returns:
            Query result from workflow

        Raises:
            Exception: If query fails
        """
        client = await self.connect()

        handle = client.get_workflow_handle(workflow_id)
        return await handle.query(query, *(args or []))

    async def wait_for_workflow(
        self,
        workflow_id: str,
        timeout_seconds: Optional[int] = None,
    ) -> Any:
        """
        Wait for a workflow to complete and return its result.

        Args:
            workflow_id: ID of the workflow to wait for
            timeout_seconds: Optional timeout in seconds

        Returns:
            Workflow result

        Raises:
            WorkflowFailureError: If workflow fails
            asyncio.TimeoutError: If timeout expires
        """
        client = await self.connect()

        handle = client.get_workflow_handle(workflow_id)

        if timeout_seconds:
            return await asyncio.wait_for(
                handle.result(),
                timeout=timeout_seconds,
            )
        else:
            return await handle.result()

    async def list_workflows(
        self,
        workflow_type: Optional[str] = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """
        List recent workflows, optionally filtered by type.

        Args:
            workflow_type: Optional workflow type filter
            limit: Maximum number of workflows to return

        Returns:
            List of workflow status dictionaries
        """
        client = await self.connect()

        # Build query filter
        query_filter = ""
        if workflow_type:
            query_filter = f'WorkflowType="{workflow_type}"'

        # List workflows
        workflows = []
        async for workflow in client.list_workflows(query_filter):
            workflows.append(
                {
                    "workflow_id": workflow.id,
                    "run_id": workflow.run_id,
                    "type": workflow.workflow_type,
                    "status": workflow.status.name,
                    "start_time": workflow.start_time.isoformat()
                    if workflow.start_time
                    else None,
                }
            )

            if len(workflows) >= limit:
                break

        return workflows


async def get_client() -> TemporalClient:
    """
    Factory function to get a connected Temporal client.

    Returns:
        Connected TemporalClient instance
    """
    client = TemporalClient()
    await client.connect()
    return client
