"""Deployment API endpoints for Vercel and Netlify."""

from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ae_api.config import get_settings, Settings
from ae_api.services.vercel_service import VercelService, VercelDeployment
from ae_api.services.netlify_service import NetlifyService, NetlifyDeployment

logger = structlog.get_logger()
router = APIRouter()


def get_vercel_service(
    settings: Annotated[Settings, Depends(get_settings)]
) -> VercelService:
    """Get Vercel service dependency.

    Args:
        settings: Application settings

    Returns:
        VercelService instance

    Raises:
        HTTPException: If Vercel token is not configured
    """
    if not settings.vercel_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Vercel token not configured",
        )
    return VercelService(token=settings.vercel_token.get_secret_value())


def get_netlify_service(
    settings: Annotated[Settings, Depends(get_settings)]
) -> NetlifyService:
    """Get Netlify service dependency.

    Args:
        settings: Application settings

    Returns:
        NetlifyService instance

    Raises:
        HTTPException: If Netlify token is not configured
    """
    if not settings.netlify_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Netlify token not configured",
        )
    return NetlifyService(token=settings.netlify_token.get_secret_value())


class DeployToVercelRequest(BaseModel):
    """Request to deploy to Vercel."""

    project_name: str = Field(min_length=1, max_length=255)
    source_path: str = Field(description="Path to source directory")
    env_vars: dict[str, str] = Field(default_factory=dict)
    build_command: str | None = Field(default=None)
    output_directory: str | None = Field(default=None)


class DeployToNetlifyRequest(BaseModel):
    """Request to deploy to Netlify."""

    site_name: str = Field(min_length=1, max_length=255)
    source_path: str = Field(description="Path to source directory")
    env_vars: dict[str, str] = Field(default_factory=dict)
    build_command: str | None = Field(default=None)
    publish_directory: str | None = Field(default=None)


class SetEnvVarsRequest(BaseModel):
    """Request to set environment variables."""

    env_vars: dict[str, str] = Field(min_length=1)
    target: list[str] | None = Field(
        default=None,
        description="Target environments (Vercel only): production, preview, development",
    )


class DeploymentStatusResponse(BaseModel):
    """Unified deployment status response."""

    id: str
    url: str
    state: str
    platform: str
    created_at: str


@router.post("/vercel", response_model=VercelDeployment)
async def deploy_to_vercel(
    request: DeployToVercelRequest,
    vercel_service: Annotated[VercelService, Depends(get_vercel_service)],
) -> VercelDeployment:
    """Deploy a project to Vercel.

    Args:
        request: Deployment request
        vercel_service: Vercel service instance

    Returns:
        Vercel deployment details

    Raises:
        HTTPException: If deployment fails
    """
    try:
        deployment = await vercel_service.deploy(
            project_name=request.project_name,
            source_path=request.source_path,
            env_vars=request.env_vars,
            build_command=request.build_command,
            output_directory=request.output_directory,
        )
        logger.info(
            "Vercel deployment created via API",
            deployment_id=deployment.id,
            project_name=request.project_name,
        )
        return deployment
    except FileNotFoundError as e:
        logger.error("Source path not found", error=str(e), path=request.source_path)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Source path not found: {str(e)}",
        )
    except Exception as e:
        logger.error("Failed to deploy to Vercel", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to deploy to Vercel: {str(e)}",
        )


@router.post("/netlify", response_model=NetlifyDeployment)
async def deploy_to_netlify(
    request: DeployToNetlifyRequest,
    netlify_service: Annotated[NetlifyService, Depends(get_netlify_service)],
) -> NetlifyDeployment:
    """Deploy a site to Netlify.

    Args:
        request: Deployment request
        netlify_service: Netlify service instance

    Returns:
        Netlify deployment details

    Raises:
        HTTPException: If deployment fails
    """
    try:
        deployment = await netlify_service.deploy(
            site_name=request.site_name,
            source_path=request.source_path,
            env_vars=request.env_vars,
            build_command=request.build_command,
            publish_directory=request.publish_directory,
        )
        logger.info(
            "Netlify deployment created via API",
            deployment_id=deployment.id,
            site_name=request.site_name,
        )
        return deployment
    except FileNotFoundError as e:
        logger.error("Source path not found", error=str(e), path=request.source_path)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Source path not found: {str(e)}",
        )
    except Exception as e:
        logger.error("Failed to deploy to Netlify", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to deploy to Netlify: {str(e)}",
        )


@router.get("/{deployment_id}", response_model=DeploymentStatusResponse)
async def get_deployment_status(
    deployment_id: str,
    platform: str,
    settings: Annotated[Settings, Depends(get_settings)],
) -> DeploymentStatusResponse:
    """Get deployment status (platform-agnostic).

    Args:
        deployment_id: Deployment ID
        platform: Platform name (vercel or netlify)
        settings: Application settings

    Returns:
        Deployment status

    Raises:
        HTTPException: If retrieval fails or platform is invalid
    """
    try:
        if platform.lower() == "vercel":
            if not settings.vercel_token:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Vercel token not configured",
                )
            vercel_service = VercelService(
                token=settings.vercel_token.get_secret_value()
            )
            deployment = await vercel_service.get_deployment(deployment_id)
            return DeploymentStatusResponse(
                id=deployment.id,
                url=deployment.url,
                state=deployment.state.value,
                platform="vercel",
                created_at=deployment.created_at.isoformat(),
            )
        elif platform.lower() == "netlify":
            if not settings.netlify_token:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Netlify token not configured",
                )
            netlify_service = NetlifyService(
                token=settings.netlify_token.get_secret_value()
            )
            deployment = await netlify_service.get_deployment(deployment_id)
            return DeploymentStatusResponse(
                id=deployment.id,
                url=deployment.url,
                state=deployment.state.value,
                platform="netlify",
                created_at=deployment.created_at.isoformat(),
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid platform: {platform}. Must be 'vercel' or 'netlify'",
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get deployment status", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Failed to get deployment status: {str(e)}",
        )


@router.post("/vercel/{project_id}/env", response_model=dict[str, str])
async def set_vercel_env_vars(
    project_id: str,
    request: SetEnvVarsRequest,
    vercel_service: Annotated[VercelService, Depends(get_vercel_service)],
) -> dict[str, str]:
    """Set environment variables for a Vercel project.

    Args:
        project_id: Vercel project ID
        request: Environment variables request
        vercel_service: Vercel service instance

    Returns:
        Success response

    Raises:
        HTTPException: If setting env vars fails
    """
    try:
        await vercel_service.set_env_vars(
            project_id=project_id,
            env_vars=request.env_vars,
            target=request.target,
        )
        logger.info(
            "Vercel env vars set via API",
            project_id=project_id,
            count=len(request.env_vars),
        )
        return {
            "status": "success",
            "project_id": project_id,
            "count": len(request.env_vars),
        }
    except Exception as e:
        logger.error("Failed to set Vercel env vars", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to set environment variables: {str(e)}",
        )


@router.post("/netlify/{site_id}/env", response_model=dict[str, str])
async def set_netlify_env_vars(
    site_id: str,
    request: SetEnvVarsRequest,
    netlify_service: Annotated[NetlifyService, Depends(get_netlify_service)],
) -> dict[str, str]:
    """Set environment variables for a Netlify site.

    Args:
        site_id: Netlify site ID
        request: Environment variables request
        netlify_service: Netlify service instance

    Returns:
        Success response

    Raises:
        HTTPException: If setting env vars fails
    """
    try:
        await netlify_service.set_env_vars(
            site_id=site_id,
            env_vars=request.env_vars,
        )
        logger.info(
            "Netlify env vars set via API",
            site_id=site_id,
            count=len(request.env_vars),
        )
        return {
            "status": "success",
            "site_id": site_id,
            "count": len(request.env_vars),
        }
    except Exception as e:
        logger.error("Failed to set Netlify env vars", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to set environment variables: {str(e)}",
        )


@router.get("/vercel/{project_id}/domains", response_model=list[str])
async def get_vercel_domains(
    project_id: str,
    vercel_service: Annotated[VercelService, Depends(get_vercel_service)],
) -> list[str]:
    """Get domains for a Vercel project.

    Args:
        project_id: Vercel project ID
        vercel_service: Vercel service instance

    Returns:
        List of domain names

    Raises:
        HTTPException: If retrieval fails
    """
    try:
        domains = await vercel_service.get_domains(project_id)
        logger.info(
            "Vercel domains retrieved via API",
            project_id=project_id,
            count=len(domains),
        )
        return domains
    except Exception as e:
        logger.error("Failed to get Vercel domains", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Failed to get domains: {str(e)}",
        )
