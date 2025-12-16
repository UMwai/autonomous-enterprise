"""Artifact storage service for project artifacts."""

import hashlib
import json
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any
from uuid import uuid4

import structlog
from pydantic import BaseModel, Field

logger = structlog.get_logger()


class ArtifactType(str, Enum):
    """Artifact type enum."""

    SOURCE_CODE = "source_code"
    BUILD_OUTPUT = "build_output"
    DEPLOYMENT_PACKAGE = "deployment_package"
    CONFIGURATION = "configuration"
    DOCUMENTATION = "documentation"
    TEST_RESULTS = "test_results"
    LOGS = "logs"
    METRICS = "metrics"


class Artifact(BaseModel):
    """Artifact model."""

    id: str
    project_id: str
    type: ArtifactType
    path: str
    size_bytes: int
    checksum: str
    created_at: datetime
    metadata: dict[str, Any] = Field(default_factory=dict)
    content_type: str = "application/octet-stream"


class ArtifactStore:
    """Service for storing and retrieving project artifacts."""

    def __init__(
        self,
        storage_backend: str = "local",
        base_path: str = "/tmp/ae-artifacts",
        s3_bucket: str | None = None,
        s3_region: str = "us-east-1",
        minio_endpoint: str | None = None,
        minio_access_key: str | None = None,
        minio_secret_key: str | None = None,
    ) -> None:
        """Initialize artifact store.

        Args:
            storage_backend: Storage backend type ('local', 's3', or 'minio')
            base_path: Base path for local storage
            s3_bucket: S3 bucket name (for s3 backend)
            s3_region: S3 region (for s3 backend)
            minio_endpoint: MinIO endpoint URL (for minio backend)
            minio_access_key: MinIO access key (for minio backend)
            minio_secret_key: MinIO secret key (for minio backend)
        """
        self.storage_backend = storage_backend
        self.base_path = Path(base_path)
        self.s3_bucket = s3_bucket
        self.s3_region = s3_region
        self.minio_endpoint = minio_endpoint
        self.minio_access_key = minio_access_key
        self.minio_secret_key = minio_secret_key

        # Initialize storage backend
        if storage_backend == "local":
            self._init_local_storage()
        elif storage_backend == "s3":
            self._init_s3_storage()
        elif storage_backend == "minio":
            self._init_minio_storage()
        else:
            raise ValueError(
                f"Unsupported storage backend: {storage_backend}. "
                "Supported: 'local', 's3', 'minio'"
            )

        logger.info("Artifact store initialized", backend=storage_backend)

    def _init_local_storage(self) -> None:
        """Initialize local file system storage."""
        self.base_path.mkdir(parents=True, exist_ok=True)
        self._metadata_path = self.base_path / "metadata"
        self._metadata_path.mkdir(exist_ok=True)
        logger.info("Local storage initialized", path=str(self.base_path))

    def _init_s3_storage(self) -> None:
        """Initialize S3 storage backend."""
        try:
            import boto3

            self.s3_client = boto3.client("s3", region_name=self.s3_region)
            logger.info("S3 storage initialized", bucket=self.s3_bucket)
        except ImportError:
            raise ImportError(
                "boto3 is required for S3 storage. Install with: pip install boto3"
            )

    def _init_minio_storage(self) -> None:
        """Initialize MinIO storage backend."""
        try:
            from minio import Minio

            self.minio_client = Minio(
                self.minio_endpoint,
                access_key=self.minio_access_key,
                secret_key=self.minio_secret_key,
                secure=self.minio_endpoint.startswith("https://")
                if self.minio_endpoint
                else False,
            )
            logger.info("MinIO storage initialized", endpoint=self.minio_endpoint)
        except ImportError:
            raise ImportError(
                "minio is required for MinIO storage. Install with: pip install minio"
            )

    async def store(
        self,
        project_id: str,
        artifact_type: ArtifactType | str,
        content: bytes,
        metadata: dict[str, Any] | None = None,
        content_type: str = "application/octet-stream",
    ) -> Artifact:
        """Store an artifact.

        Args:
            project_id: Project ID
            artifact_type: Type of artifact
            content: Artifact content as bytes
            metadata: Optional metadata dictionary
            content_type: Content type (MIME type)

        Returns:
            Artifact model

        Raises:
            Exception: If storage fails
        """
        try:
            # Ensure artifact_type is enum
            if isinstance(artifact_type, str):
                artifact_type = ArtifactType(artifact_type)

            # Generate artifact ID and path
            artifact_id = str(uuid4())
            checksum = hashlib.sha256(content).hexdigest()
            size_bytes = len(content)

            # Construct storage path
            storage_path = f"{project_id}/{artifact_type.value}/{artifact_id}"

            # Store based on backend
            if self.storage_backend == "local":
                await self._store_local(storage_path, content)
            elif self.storage_backend == "s3":
                await self._store_s3(storage_path, content, content_type)
            elif self.storage_backend == "minio":
                await self._store_minio(storage_path, content, content_type)

            # Create artifact metadata
            artifact = Artifact(
                id=artifact_id,
                project_id=project_id,
                type=artifact_type,
                path=storage_path,
                size_bytes=size_bytes,
                checksum=checksum,
                created_at=datetime.utcnow(),
                metadata=metadata or {},
                content_type=content_type,
            )

            # Store metadata
            await self._store_metadata(artifact)

            logger.info(
                "Artifact stored",
                artifact_id=artifact_id,
                project_id=project_id,
                type=artifact_type.value,
                size_bytes=size_bytes,
            )

            return artifact
        except Exception as e:
            logger.error(
                "Failed to store artifact",
                error=str(e),
                project_id=project_id,
                type=artifact_type,
            )
            raise

    async def retrieve(self, artifact_id: str) -> bytes:
        """Retrieve artifact content.

        Args:
            artifact_id: Artifact ID

        Returns:
            Artifact content as bytes

        Raises:
            FileNotFoundError: If artifact not found
            Exception: If retrieval fails
        """
        try:
            # Get artifact metadata
            artifact = await self._get_metadata(artifact_id)

            if not artifact:
                raise FileNotFoundError(f"Artifact not found: {artifact_id}")

            # Retrieve based on backend
            if self.storage_backend == "local":
                content = await self._retrieve_local(artifact.path)
            elif self.storage_backend == "s3":
                content = await self._retrieve_s3(artifact.path)
            elif self.storage_backend == "minio":
                content = await self._retrieve_minio(artifact.path)
            else:
                raise ValueError(f"Unknown storage backend: {self.storage_backend}")

            # Verify checksum
            checksum = hashlib.sha256(content).hexdigest()
            if checksum != artifact.checksum:
                logger.warning(
                    "Checksum mismatch",
                    artifact_id=artifact_id,
                    expected=artifact.checksum,
                    actual=checksum,
                )

            logger.info("Artifact retrieved", artifact_id=artifact_id)
            return content
        except Exception as e:
            logger.error(
                "Failed to retrieve artifact", error=str(e), artifact_id=artifact_id
            )
            raise

    async def list_artifacts(
        self, project_id: str, artifact_type: ArtifactType | str | None = None
    ) -> list[Artifact]:
        """List artifacts for a project.

        Args:
            project_id: Project ID
            artifact_type: Optional artifact type filter

        Returns:
            List of Artifact models
        """
        try:
            artifacts = []

            if self.storage_backend == "local":
                # List from local metadata directory
                for metadata_file in self._metadata_path.glob("*.json"):
                    with open(metadata_file) as f:
                        data = json.load(f)
                        artifact = Artifact(**data)

                        # Filter by project_id and type
                        if artifact.project_id == project_id:
                            if artifact_type is None or artifact.type == artifact_type:
                                artifacts.append(artifact)
            elif self.storage_backend in ["s3", "minio"]:
                # For S3/MinIO, we'd need a metadata index
                # This is a simplified implementation
                logger.warning(
                    "List operation not fully implemented for S3/MinIO backends"
                )

            logger.info(
                "Artifacts listed", project_id=project_id, count=len(artifacts)
            )
            return artifacts
        except Exception as e:
            logger.error(
                "Failed to list artifacts", error=str(e), project_id=project_id
            )
            raise

    async def delete(self, artifact_id: str) -> None:
        """Delete an artifact.

        Args:
            artifact_id: Artifact ID

        Raises:
            FileNotFoundError: If artifact not found
            Exception: If deletion fails
        """
        try:
            # Get artifact metadata
            artifact = await self._get_metadata(artifact_id)

            if not artifact:
                raise FileNotFoundError(f"Artifact not found: {artifact_id}")

            # Delete based on backend
            if self.storage_backend == "local":
                await self._delete_local(artifact.path)
            elif self.storage_backend == "s3":
                await self._delete_s3(artifact.path)
            elif self.storage_backend == "minio":
                await self._delete_minio(artifact.path)

            # Delete metadata
            await self._delete_metadata(artifact_id)

            logger.info("Artifact deleted", artifact_id=artifact_id)
        except Exception as e:
            logger.error(
                "Failed to delete artifact", error=str(e), artifact_id=artifact_id
            )
            raise

    # Local storage methods
    async def _store_local(self, path: str, content: bytes) -> None:
        """Store artifact in local file system."""
        file_path = self.base_path / path
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(file_path, "wb") as f:
            f.write(content)

    async def _retrieve_local(self, path: str) -> bytes:
        """Retrieve artifact from local file system."""
        file_path = self.base_path / path
        with open(file_path, "rb") as f:
            return f.read()

    async def _delete_local(self, path: str) -> None:
        """Delete artifact from local file system."""
        file_path = self.base_path / path
        if file_path.exists():
            file_path.unlink()

    # S3 storage methods
    async def _store_s3(self, path: str, content: bytes, content_type: str) -> None:
        """Store artifact in S3."""
        self.s3_client.put_object(
            Bucket=self.s3_bucket,
            Key=path,
            Body=content,
            ContentType=content_type,
        )

    async def _retrieve_s3(self, path: str) -> bytes:
        """Retrieve artifact from S3."""
        response = self.s3_client.get_object(Bucket=self.s3_bucket, Key=path)
        return response["Body"].read()

    async def _delete_s3(self, path: str) -> None:
        """Delete artifact from S3."""
        self.s3_client.delete_object(Bucket=self.s3_bucket, Key=path)

    # MinIO storage methods
    async def _store_minio(
        self, path: str, content: bytes, content_type: str
    ) -> None:
        """Store artifact in MinIO."""
        from io import BytesIO

        self.minio_client.put_object(
            self.s3_bucket,
            path,
            BytesIO(content),
            len(content),
            content_type=content_type,
        )

    async def _retrieve_minio(self, path: str) -> bytes:
        """Retrieve artifact from MinIO."""
        response = self.minio_client.get_object(self.s3_bucket, path)
        return response.read()

    async def _delete_minio(self, path: str) -> None:
        """Delete artifact from MinIO."""
        self.minio_client.remove_object(self.s3_bucket, path)

    # Metadata methods
    async def _store_metadata(self, artifact: Artifact) -> None:
        """Store artifact metadata."""
        if self.storage_backend == "local":
            metadata_file = self._metadata_path / f"{artifact.id}.json"
            with open(metadata_file, "w") as f:
                json.dump(artifact.model_dump(mode="json"), f, indent=2, default=str)

    async def _get_metadata(self, artifact_id: str) -> Artifact | None:
        """Get artifact metadata."""
        if self.storage_backend == "local":
            metadata_file = self._metadata_path / f"{artifact_id}.json"
            if metadata_file.exists():
                with open(metadata_file) as f:
                    data = json.load(f)
                    return Artifact(**data)
        return None

    async def _delete_metadata(self, artifact_id: str) -> None:
        """Delete artifact metadata."""
        if self.storage_backend == "local":
            metadata_file = self._metadata_path / f"{artifact_id}.json"
            if metadata_file.exists():
                metadata_file.unlink()
