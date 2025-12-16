"""Netlify deployment service."""

import asyncio
import zipfile
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
    """Netlify deployment state."""

    NEW = "new"
    BUILDING = "building"
    PROCESSING = "processing"
    READY = "ready"
    ERROR = "error"
    UPLOADING = "uploading"


class NetlifyDeployment(BaseModel):
    """Netlify deployment model."""

    id: str
    url: str
    state: DeploymentState
    created_at: datetime
    site_id: str
    deploy_ssl_url: str | None = None
    screenshot_url: str | None = None
    metadata: dict[str, str] = Field(default_factory=dict)


class NetlifySite(BaseModel):
    """Netlify site model."""

    id: str
    name: str
    url: str
    admin_url: str
    build_settings: dict[str, Any] = Field(default_factory=dict)


class NetlifyService:
    """Service for interacting with Netlify API."""

    def __init__(self, token: str) -> None:
        """Initialize Netlify service.

        Args:
            token: Netlify personal access token
        """
        self.token = token
        self.base_url = "https://api.netlify.com/api/v1"
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        logger.info("Netlify service initialized")

    async def deploy(
        self,
        site_name: str,
        source_path: str,
        env_vars: dict[str, str] | None = None,
        build_command: str | None = None,
        publish_directory: str | None = None,
    ) -> NetlifyDeployment:
        """Deploy a site to Netlify.

        Args:
            site_name: Name of the site
            source_path: Path to the source directory
            env_vars: Optional environment variables
            build_command: Optional build command
            publish_directory: Optional publish directory

        Returns:
            NetlifyDeployment model

        Raises:
            httpx.HTTPError: If deployment fails
        """
        try:
            # First, ensure site exists or create it
            site = await self._ensure_site(
                site_name, build_command, publish_directory
            )

            # Set environment variables if provided
            if env_vars:
                await self.set_env_vars(site.id, env_vars)

            # Create deployment
            async with httpx.AsyncClient(timeout=300.0) as client:
                response = await client.post(
                    f"{self.base_url}/sites/{site.id}/deploys",
                    headers=self.headers,
                )
                response.raise_for_status()
                deploy_data = response.json()

            deploy_id = deploy_data["id"]

            # Upload files
            await self._upload_files(site.id, deploy_id, source_path)

            # Get final deployment status
            deployment = await self.get_deployment(deploy_id)

            logger.info(
                "Deployment created",
                deployment_id=deploy_id,
                site_name=site_name,
            )

            return deployment
        except httpx.HTTPError as e:
            logger.error(
                "Failed to deploy to Netlify",
                error=str(e),
                site_name=site_name,
            )
            raise

    async def get_deployment(self, deployment_id: str) -> NetlifyDeployment:
        """Get deployment details.

        Args:
            deployment_id: Netlify deployment ID

        Returns:
            NetlifyDeployment model

        Raises:
            httpx.HTTPError: If retrieval fails
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/deploys/{deployment_id}",
                    headers=self.headers,
                )
                response.raise_for_status()
                data = response.json()

            return NetlifyDeployment(
                id=data["id"],
                url=data["deploy_url"],
                state=DeploymentState(data["state"]),
                created_at=datetime.fromisoformat(
                    data["created_at"].replace("Z", "+00:00")
                ),
                site_id=data["site_id"],
                deploy_ssl_url=data.get("deploy_ssl_url"),
                screenshot_url=data.get("screenshot_url"),
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
    ) -> NetlifyDeployment:
        """Wait for deployment to complete.

        Args:
            deployment_id: Netlify deployment ID
            timeout: Maximum time to wait in seconds
            poll_interval: Polling interval in seconds

        Returns:
            NetlifyDeployment model

        Raises:
            TimeoutError: If deployment doesn't complete within timeout
        """
        start_time = datetime.now()
        while (datetime.now() - start_time).seconds < timeout:
            deployment = await self.get_deployment(deployment_id)

            if deployment.state == DeploymentState.READY:
                logger.info("Deployment ready", deployment_id=deployment_id)
                return deployment

            if deployment.state == DeploymentState.ERROR:
                raise RuntimeError("Deployment failed with error state")

            await asyncio.sleep(poll_interval)

        raise TimeoutError(
            f"Deployment {deployment_id} did not complete within {timeout} seconds"
        )

    async def set_env_vars(self, site_id: str, env_vars: dict[str, str]) -> None:
        """Set environment variables for a site.

        Args:
            site_id: Netlify site ID
            env_vars: Environment variables to set

        Raises:
            httpx.HTTPError: If setting env vars fails
        """
        try:
            # Get current build settings
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/sites/{site_id}",
                    headers=self.headers,
                )
                response.raise_for_status()
                site_data = response.json()

            # Update environment variables
            build_settings = site_data.get("build_settings", {})
            current_env = build_settings.get("env", {})
            current_env.update(env_vars)
            build_settings["env"] = current_env

            # Update site
            async with httpx.AsyncClient() as client:
                response = await client.patch(
                    f"{self.base_url}/sites/{site_id}",
                    headers=self.headers,
                    json={"build_settings": build_settings},
                )
                response.raise_for_status()

            logger.info(
                "Environment variables set",
                site_id=site_id,
                count=len(env_vars),
            )
        except httpx.HTTPError as e:
            logger.error(
                "Failed to set environment variables",
                error=str(e),
                site_id=site_id,
            )
            raise

    async def get_site(self, site_id: str) -> NetlifySite:
        """Get site details.

        Args:
            site_id: Netlify site ID

        Returns:
            NetlifySite model

        Raises:
            httpx.HTTPError: If retrieval fails
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/sites/{site_id}",
                    headers=self.headers,
                )
                response.raise_for_status()
                data = response.json()

            return NetlifySite(
                id=data["id"],
                name=data["name"],
                url=data["url"],
                admin_url=data["admin_url"],
                build_settings=data.get("build_settings", {}),
            )
        except httpx.HTTPError as e:
            logger.error("Failed to get site", error=str(e), site_id=site_id)
            raise

    async def create_site(
        self,
        name: str,
        build_command: str | None = None,
        publish_directory: str | None = None,
    ) -> NetlifySite:
        """Create a new Netlify site.

        Args:
            name: Site name
            build_command: Build command
            publish_directory: Publish directory

        Returns:
            NetlifySite model

        Raises:
            httpx.HTTPError: If site creation fails
        """
        try:
            payload: dict[str, Any] = {"name": name}

            if build_command or publish_directory:
                build_settings: dict[str, Any] = {}
                if build_command:
                    build_settings["cmd"] = build_command
                if publish_directory:
                    build_settings["dir"] = publish_directory
                payload["build_settings"] = build_settings

            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/sites",
                    headers=self.headers,
                    json=payload,
                )
                response.raise_for_status()
                data = response.json()

            logger.info("Site created", site_id=data["id"], name=name)

            return NetlifySite(
                id=data["id"],
                name=data["name"],
                url=data["url"],
                admin_url=data["admin_url"],
                build_settings=data.get("build_settings", {}),
            )
        except httpx.HTTPError as e:
            logger.error("Failed to create site", error=str(e), name=name)
            raise

    async def delete_site(self, site_id: str) -> None:
        """Delete a Netlify site.

        Args:
            site_id: Netlify site ID

        Raises:
            httpx.HTTPError: If deletion fails
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.delete(
                    f"{self.base_url}/sites/{site_id}",
                    headers=self.headers,
                )
                response.raise_for_status()

            logger.info("Site deleted", site_id=site_id)
        except httpx.HTTPError as e:
            logger.error("Failed to delete site", error=str(e), site_id=site_id)
            raise

    async def _ensure_site(
        self,
        name: str,
        build_command: str | None = None,
        publish_directory: str | None = None,
    ) -> NetlifySite:
        """Ensure site exists, create if not.

        Args:
            name: Site name
            build_command: Build command
            publish_directory: Publish directory

        Returns:
            NetlifySite model
        """
        try:
            # Try to find existing site by name
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/sites",
                    headers=self.headers,
                )
                response.raise_for_status()
                sites = response.json()

            for site_data in sites:
                if site_data["name"] == name:
                    logger.info("Using existing site", site_id=site_data["id"])
                    return NetlifySite(
                        id=site_data["id"],
                        name=site_data["name"],
                        url=site_data["url"],
                        admin_url=site_data["admin_url"],
                        build_settings=site_data.get("build_settings", {}),
                    )

            # Site doesn't exist, create it
            return await self.create_site(name, build_command, publish_directory)
        except httpx.HTTPError as e:
            logger.error("Failed to ensure site", error=str(e), name=name)
            raise

    async def _upload_files(
        self, site_id: str, deploy_id: str, source_path: str
    ) -> None:
        """Upload files for deployment.

        Args:
            site_id: Netlify site ID
            deploy_id: Deployment ID
            source_path: Path to source directory

        Raises:
            httpx.HTTPError: If upload fails
        """
        try:
            source = Path(source_path)

            if not source.exists():
                raise FileNotFoundError(f"Source path does not exist: {source_path}")

            # Create zip file
            zip_buffer = BytesIO()
            with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
                for file_path in source.rglob("*"):
                    if file_path.is_file():
                        # Skip common excluded patterns
                        if any(
                            part in file_path.parts
                            for part in [
                                ".git",
                                "node_modules",
                                ".netlify",
                                "__pycache__",
                            ]
                        ):
                            continue

                        relative_path = file_path.relative_to(source)
                        zip_file.write(file_path, relative_path)

            zip_buffer.seek(0)

            # Upload zip file
            headers = {
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/zip",
            }

            async with httpx.AsyncClient(timeout=300.0) as client:
                response = await client.put(
                    f"{self.base_url}/deploys/{deploy_id}/files",
                    headers=headers,
                    content=zip_buffer.read(),
                )
                response.raise_for_status()

            logger.info("Files uploaded", deploy_id=deploy_id, site_id=site_id)
        except httpx.HTTPError as e:
            logger.error(
                "Failed to upload files",
                error=str(e),
                deploy_id=deploy_id,
            )
            raise
