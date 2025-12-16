"""Vercel deployment service."""

import asyncio
import json
import tarfile
from datetime import datetime
from enum import Enum
from io import BytesIO
from pathlib import Path
from typing import Any

import httpx
import structlog
from pydantic import BaseModel, Field

logger = structlog.get_logger()


class DeploymentState(str, Enum):
    """Vercel deployment state."""

    BUILDING = "BUILDING"
    ERROR = "ERROR"
    INITIALIZING = "INITIALIZING"
    QUEUED = "QUEUED"
    READY = "READY"
    CANCELED = "CANCELED"


class VercelDeployment(BaseModel):
    """Vercel deployment model."""

    id: str
    url: str
    state: DeploymentState
    created_at: datetime
    name: str | None = None
    project_id: str | None = None
    metadata: dict[str, str] = Field(default_factory=dict)


class VercelProject(BaseModel):
    """Vercel project model."""

    id: str
    name: str
    framework: str | None = None
    build_command: str | None = None
    output_directory: str | None = None
    install_command: str | None = None


class VercelService:
    """Service for interacting with Vercel API."""

    def __init__(self, token: str, team_id: str | None = None) -> None:
        """Initialize Vercel service.

        Args:
            token: Vercel API token
            team_id: Optional Vercel team ID
        """
        self.token = token
        self.team_id = team_id
        self.base_url = "https://api.vercel.com"
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        logger.info("Vercel service initialized")

    async def deploy(
        self,
        project_name: str,
        source_path: str,
        env_vars: dict[str, str] | None = None,
        build_command: str | None = None,
        output_directory: str | None = None,
    ) -> VercelDeployment:
        """Deploy a project to Vercel.

        Args:
            project_name: Name of the project
            source_path: Path to the source directory
            env_vars: Optional environment variables
            build_command: Optional build command override
            output_directory: Optional output directory override

        Returns:
            VercelDeployment model

        Raises:
            httpx.HTTPError: If deployment fails
        """
        try:
            # Create tarball of source files
            files_dict = await self._prepare_files(source_path)

            # Prepare deployment payload
            deployment_data: dict[str, Any] = {
                "name": project_name,
                "files": files_dict,
                "projectSettings": {},
            }

            if build_command:
                deployment_data["projectSettings"]["buildCommand"] = build_command

            if output_directory:
                deployment_data["projectSettings"]["outputDirectory"] = output_directory

            if env_vars:
                deployment_data["env"] = env_vars

            # Add team ID if provided
            params = {"teamId": self.team_id} if self.team_id else {}

            async with httpx.AsyncClient(timeout=300.0) as client:
                response = await client.post(
                    f"{self.base_url}/v13/deployments",
                    headers=self.headers,
                    json=deployment_data,
                    params=params,
                )
                response.raise_for_status()
                data = response.json()

            logger.info(
                "Deployment created",
                deployment_id=data["id"],
                project_name=project_name,
            )

            return VercelDeployment(
                id=data["id"],
                url=f"https://{data['url']}",
                state=DeploymentState(data.get("readyState", "QUEUED")),
                created_at=datetime.fromtimestamp(data["createdAt"] / 1000),
                name=data.get("name"),
                project_id=data.get("projectId"),
            )
        except httpx.HTTPError as e:
            logger.error(
                "Failed to deploy to Vercel",
                error=str(e),
                project_name=project_name,
            )
            raise

    async def get_deployment(self, deployment_id: str) -> VercelDeployment:
        """Get deployment details.

        Args:
            deployment_id: Vercel deployment ID

        Returns:
            VercelDeployment model

        Raises:
            httpx.HTTPError: If retrieval fails
        """
        try:
            params = {"teamId": self.team_id} if self.team_id else {}

            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/v13/deployments/{deployment_id}",
                    headers=self.headers,
                    params=params,
                )
                response.raise_for_status()
                data = response.json()

            return VercelDeployment(
                id=data["id"],
                url=f"https://{data['url']}",
                state=DeploymentState(data.get("readyState", "QUEUED")),
                created_at=datetime.fromtimestamp(data["createdAt"] / 1000),
                name=data.get("name"),
                project_id=data.get("projectId"),
            )
        except httpx.HTTPError as e:
            logger.error(
                "Failed to get deployment",
                error=str(e),
                deployment_id=deployment_id,
            )
            raise

    async def wait_for_deployment(
        self,
        deployment_id: str,
        timeout: int = 600,
        poll_interval: int = 5,
    ) -> VercelDeployment:
        """Wait for deployment to complete.

        Args:
            deployment_id: Vercel deployment ID
            timeout: Maximum time to wait in seconds
            poll_interval: Polling interval in seconds

        Returns:
            VercelDeployment model

        Raises:
            TimeoutError: If deployment doesn't complete within timeout
        """
        start_time = datetime.now()
        while (datetime.now() - start_time).seconds < timeout:
            deployment = await self.get_deployment(deployment_id)

            if deployment.state == DeploymentState.READY:
                logger.info("Deployment ready", deployment_id=deployment_id)
                return deployment

            if deployment.state in [DeploymentState.ERROR, DeploymentState.CANCELED]:
                raise RuntimeError(f"Deployment failed with state: {deployment.state}")

            await asyncio.sleep(poll_interval)

        raise TimeoutError(
            f"Deployment {deployment_id} did not complete within {timeout} seconds"
        )

    async def set_env_vars(
        self, project_id: str, env_vars: dict[str, str], target: list[str] | None = None
    ) -> None:
        """Set environment variables for a project.

        Args:
            project_id: Vercel project ID
            env_vars: Environment variables to set
            target: Target environments (e.g., ["production", "preview", "development"])

        Raises:
            httpx.HTTPError: If setting env vars fails
        """
        try:
            if target is None:
                target = ["production", "preview", "development"]

            params = {"teamId": self.team_id} if self.team_id else {}

            async with httpx.AsyncClient() as client:
                for key, value in env_vars.items():
                    payload = {
                        "key": key,
                        "value": value,
                        "type": "encrypted",
                        "target": target,
                    }

                    response = await client.post(
                        f"{self.base_url}/v10/projects/{project_id}/env",
                        headers=self.headers,
                        json=payload,
                        params=params,
                    )
                    response.raise_for_status()

            logger.info(
                "Environment variables set",
                project_id=project_id,
                count=len(env_vars),
            )
        except httpx.HTTPError as e:
            logger.error(
                "Failed to set environment variables",
                error=str(e),
                project_id=project_id,
            )
            raise

    async def get_domains(self, project_id: str) -> list[str]:
        """Get domains for a project.

        Args:
            project_id: Vercel project ID

        Returns:
            List of domain names

        Raises:
            httpx.HTTPError: If retrieval fails
        """
        try:
            params = {"teamId": self.team_id} if self.team_id else {}

            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/v9/projects/{project_id}/domains",
                    headers=self.headers,
                    params=params,
                )
                response.raise_for_status()
                data = response.json()

            domains = [domain["name"] for domain in data.get("domains", [])]
            logger.info("Domains retrieved", project_id=project_id, count=len(domains))
            return domains
        except httpx.HTTPError as e:
            logger.error(
                "Failed to get domains", error=str(e), project_id=project_id
            )
            raise

    async def create_project(
        self,
        name: str,
        framework: str | None = None,
        build_command: str | None = None,
        output_directory: str | None = None,
        install_command: str | None = None,
    ) -> VercelProject:
        """Create a new Vercel project.

        Args:
            name: Project name
            framework: Framework preset (e.g., "nextjs", "vite", "react")
            build_command: Custom build command
            output_directory: Custom output directory
            install_command: Custom install command

        Returns:
            VercelProject model

        Raises:
            httpx.HTTPError: If project creation fails
        """
        try:
            payload: dict[str, Any] = {"name": name}

            if framework:
                payload["framework"] = framework

            if build_command or output_directory or install_command:
                payload["buildCommand"] = build_command
                payload["outputDirectory"] = output_directory
                payload["installCommand"] = install_command

            params = {"teamId": self.team_id} if self.team_id else {}

            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/v9/projects",
                    headers=self.headers,
                    json=payload,
                    params=params,
                )
                response.raise_for_status()
                data = response.json()

            logger.info("Project created", project_id=data["id"], name=name)

            return VercelProject(
                id=data["id"],
                name=data["name"],
                framework=data.get("framework"),
                build_command=data.get("buildCommand"),
                output_directory=data.get("outputDirectory"),
                install_command=data.get("installCommand"),
            )
        except httpx.HTTPError as e:
            logger.error("Failed to create project", error=str(e), name=name)
            raise

    async def _prepare_files(self, source_path: str) -> list[dict[str, str]]:
        """Prepare files for deployment.

        Args:
            source_path: Path to source directory

        Returns:
            List of file objects with path and content
        """
        files = []
        source = Path(source_path)

        if not source.exists():
            raise FileNotFoundError(f"Source path does not exist: {source_path}")

        # Walk through directory and prepare files
        for file_path in source.rglob("*"):
            if file_path.is_file():
                # Skip common excluded patterns
                if any(
                    part in file_path.parts
                    for part in [
                        ".git",
                        "node_modules",
                        ".next",
                        ".vercel",
                        "__pycache__",
                    ]
                ):
                    continue

                relative_path = file_path.relative_to(source)
                with open(file_path, "rb") as f:
                    content = f.read()

                files.append(
                    {
                        "file": str(relative_path),
                        "data": content.decode("utf-8", errors="ignore"),
                    }
                )

        logger.info("Files prepared for deployment", count=len(files))
        return files
