"""Policy enforcement and action validation for safety controls."""

import re
from enum import Enum
from typing import Any
from urllib.parse import urlparse

import structlog
from pydantic import BaseModel, Field

logger = structlog.get_logger()


class ActionType(str, Enum):
    """Types of actions that require policy checks."""

    EXECUTE_CODE = "execute_code"
    DEPLOY = "deploy"
    CREATE_BILLING = "create_billing"
    DELETE_FILES = "delete_files"
    NETWORK_ACCESS = "network_access"


class PolicyDecision(BaseModel):
    """Result of a policy check."""

    allowed: bool = Field(description="Whether the action is allowed")
    reason: str = Field(description="Explanation for the decision")
    requires_approval: bool = Field(
        default=False, description="Whether human approval is required"
    )


class PolicyGate:
    """Enforces security and safety policies on agent actions."""

    # Destructive command patterns
    DESTRUCTIVE_PATTERNS = [
        r"\brm\s+-rf\s+/",  # rm -rf /
        r"\brm\s+-rf\s+\*",  # rm -rf *
        r"\bDROP\s+DATABASE\b",  # DROP DATABASE
        r"\bDROP\s+TABLE\b",  # DROP TABLE
        r"\bTRUNCATE\s+TABLE\b",  # TRUNCATE TABLE
        r"\bDELETE\s+FROM\s+\w+\s*;?\s*$",  # DELETE FROM table without WHERE
        r">\s*/dev/sd[a-z]",  # Write to block device
        r"\bdd\s+if=.*of=/dev/",  # dd to device
        r"\bmkfs\.",  # Format filesystem
        r"\bformat\s+[a-z]:",  # Windows format
        r":\(\)\{\s*:\|:&\s*\};:",  # Fork bomb
    ]

    # Actions that always require human approval
    APPROVAL_REQUIRED_ACTIONS = {
        ActionType.DEPLOY,
        ActionType.CREATE_BILLING,
        ActionType.DELETE_FILES,
    }

    def __init__(
        self,
        enable_code_execution: bool = True,
        enable_network_access: bool = True,
        enable_deployments: bool = False,
        enable_billing: bool = False,
    ):
        """
        Initialize policy gate with configuration.

        Args:
            enable_code_execution: Whether to allow code execution
            enable_network_access: Whether to allow network access
            enable_deployments: Whether to allow deployments
            enable_billing: Whether to allow billing operations
        """
        self.enable_code_execution = enable_code_execution
        self.enable_network_access = enable_network_access
        self.enable_deployments = enable_deployments
        self.enable_billing = enable_billing

        # Compile destructive patterns once
        self._destructive_compiled = [
            re.compile(pattern, re.IGNORECASE) for pattern in self.DESTRUCTIVE_PATTERNS
        ]

    def check_action(self, action: ActionType, context: dict[str, Any]) -> PolicyDecision:
        """
        Check if an action is allowed under current policies.

        Args:
            action: Type of action to check
            context: Additional context for the decision (command, url, etc.)

        Returns:
            PolicyDecision with allowed status and reasoning
        """
        logger.info("Checking policy", action=action, context=context)

        # Check if action type is enabled
        if action == ActionType.EXECUTE_CODE and not self.enable_code_execution:
            return PolicyDecision(
                allowed=False,
                reason="Code execution is disabled by policy",
                requires_approval=False,
            )

        if action == ActionType.NETWORK_ACCESS and not self.enable_network_access:
            return PolicyDecision(
                allowed=False,
                reason="Network access is disabled by policy",
                requires_approval=False,
            )

        if action == ActionType.DEPLOY and not self.enable_deployments:
            return PolicyDecision(
                allowed=False,
                reason="Deployments are disabled by policy",
                requires_approval=False,
            )

        if action == ActionType.CREATE_BILLING and not self.enable_billing:
            return PolicyDecision(
                allowed=False,
                reason="Billing operations are disabled by policy",
                requires_approval=False,
            )

        # Check for destructive commands
        if action == ActionType.EXECUTE_CODE:
            command = context.get("command", "")
            if self.is_destructive(command):
                return PolicyDecision(
                    allowed=False,
                    reason=f"Command contains destructive patterns: {command}",
                    requires_approval=False,
                )

        # Check network allowlist
        if action == ActionType.NETWORK_ACCESS:
            url = context.get("url", "")
            allowlist = context.get("allowlist", [])
            if allowlist and not self.validate_network_access(url, allowlist):
                return PolicyDecision(
                    allowed=False,
                    reason=f"URL {url} is not in allowlist",
                    requires_approval=True,
                )

        # Check if human approval is required
        requires_approval = self.require_human_approval(action)

        return PolicyDecision(
            allowed=True,
            reason="Action allowed by policy",
            requires_approval=requires_approval,
        )

    def require_human_approval(self, action: ActionType) -> bool:
        """
        Check if an action requires human approval.

        Args:
            action: Type of action to check

        Returns:
            True if human approval is required
        """
        return action in self.APPROVAL_REQUIRED_ACTIONS

    def is_destructive(self, command: str) -> bool:
        """
        Check if a command contains destructive patterns.

        Args:
            command: Command string to check

        Returns:
            True if command is potentially destructive
        """
        for pattern in self._destructive_compiled:
            if pattern.search(command):
                logger.warning("Destructive command detected", command=command, pattern=pattern.pattern)
                return True
        return False

    def validate_network_access(self, url: str, allowlist: list[str]) -> bool:
        """
        Validate if a URL is allowed based on allowlist.

        Args:
            url: URL to validate
            allowlist: List of allowed domains/URLs

        Returns:
            True if URL is allowed
        """
        if not allowlist:
            # Empty allowlist means all URLs are allowed
            return True

        try:
            parsed = urlparse(url)
            hostname = parsed.hostname or ""

            for allowed in allowlist:
                # Check exact domain match
                if hostname == allowed:
                    return True

                # Check subdomain match (*.example.com)
                if allowed.startswith("*."):
                    domain = allowed[2:]
                    if hostname.endswith(domain):
                        return True

                # Check full URL match
                if url.startswith(allowed):
                    return True

            logger.warning("URL not in allowlist", url=url, allowlist=allowlist)
            return False

        except Exception as e:
            logger.error("Error validating URL", url=url, error=str(e))
            return False
