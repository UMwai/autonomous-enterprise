"""Workflow ID generation utilities for stable, deterministic workflow identification."""

import hashlib


def genesis_workflow_id(intent_hash: str) -> str:
    """
    Generate a deterministic workflow ID for Genesis workflow.

    Args:
        intent_hash: Hash of the user intent to ensure uniqueness

    Returns:
        Workflow ID in format "genesis-{hash}"
    """
    return f"genesis-{intent_hash}"


def genesis_workflow_id_from_intent(intent: str) -> str:
    """
    Generate a Genesis workflow ID directly from intent string.

    Args:
        intent: The user's intent/prompt

    Returns:
        Workflow ID in format "genesis-{hash}"
    """
    # Create a stable hash of the intent
    intent_hash = hashlib.sha256(intent.encode()).hexdigest()[:16]
    return genesis_workflow_id(intent_hash)


def build_workflow_id(project_id: str) -> str:
    """
    Generate a deterministic workflow ID for Build workflow.

    Args:
        project_id: Unique project identifier

    Returns:
        Workflow ID in format "build-{project_id}"
    """
    return f"build-{project_id}"


def deploy_workflow_id(project_id: str, version: str) -> str:
    """
    Generate a deterministic workflow ID for Deploy workflow.

    Args:
        project_id: Unique project identifier
        version: Version string or tag

    Returns:
        Workflow ID in format "deploy-{project_id}-{version}"
    """
    # Sanitize version string for workflow ID compatibility
    safe_version = version.replace("/", "-").replace(":", "-")
    return f"deploy-{project_id}-{safe_version}"


def monetize_workflow_id(project_id: str) -> str:
    """
    Generate a deterministic workflow ID for Monetization workflow.

    Args:
        project_id: Unique project identifier

    Returns:
        Workflow ID in format "monetize-{project_id}"
    """
    return f"monetize-{project_id}"


def test_workflow_id(project_id: str, test_suite: str | None = None) -> str:
    """
    Generate a deterministic workflow ID for Test workflow.

    Args:
        project_id: Unique project identifier
        test_suite: Optional test suite identifier

    Returns:
        Workflow ID in format "test-{project_id}" or "test-{project_id}-{suite}"
    """
    if test_suite:
        safe_suite = test_suite.replace("/", "-").replace(":", "-")
        return f"test-{project_id}-{safe_suite}"
    return f"test-{project_id}"
