"""Secret redaction for logging and observability."""

import re
from dataclasses import dataclass

import structlog

logger = structlog.get_logger()


@dataclass
class SecretPattern:
    """Pattern for detecting and redacting secrets."""

    name: str
    pattern: re.Pattern


class Redactor:
    """Redacts sensitive information from text."""

    # Common secret patterns
    DEFAULT_PATTERNS = [
        SecretPattern(
            name="AWS_ACCESS_KEY",
            pattern=re.compile(r"AKIA[0-9A-Z]{16}", re.IGNORECASE),
        ),
        SecretPattern(
            name="AWS_SECRET_KEY",
            pattern=re.compile(r"aws_secret_access_key\s*=\s*['\"]?([A-Za-z0-9/+=]{40})['\"]?", re.IGNORECASE),
        ),
        SecretPattern(
            name="OPENAI_API_KEY",
            pattern=re.compile(r"sk-[a-zA-Z0-9]{48}", re.IGNORECASE),
        ),
        SecretPattern(
            name="ANTHROPIC_API_KEY",
            pattern=re.compile(r"sk-ant-[a-zA-Z0-9\-]{95,}", re.IGNORECASE),
        ),
        SecretPattern(
            name="GOOGLE_API_KEY",
            pattern=re.compile(r"AIza[0-9A-Za-z\-_]{35}", re.IGNORECASE),
        ),
        SecretPattern(
            name="GITHUB_TOKEN",
            pattern=re.compile(r"gh[pousr]_[A-Za-z0-9]{36,}", re.IGNORECASE),
        ),
        SecretPattern(
            name="GENERIC_API_KEY",
            pattern=re.compile(r"api[_-]?key\s*[=:]\s*['\"]?([a-zA-Z0-9\-_]{20,})['\"]?", re.IGNORECASE),
        ),
        SecretPattern(
            name="STRIPE_KEY",
            pattern=re.compile(r"sk_live_[a-zA-Z0-9]{24,}", re.IGNORECASE),
        ),
        SecretPattern(
            name="STRIPE_SECRET",
            pattern=re.compile(r"rk_live_[a-zA-Z0-9]{24,}", re.IGNORECASE),
        ),
        SecretPattern(
            name="JWT_TOKEN",
            pattern=re.compile(r"eyJ[A-Za-z0-9\-_=]+\.eyJ[A-Za-z0-9\-_=]+\.?[A-Za-z0-9\-_.+/=]*", re.IGNORECASE),
        ),
        SecretPattern(
            name="PRIVATE_KEY",
            pattern=re.compile(
                r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[A-Za-z0-9+/=\s]+-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
                re.IGNORECASE | re.DOTALL,
            ),
        ),
        SecretPattern(
            name="PASSWORD",
            pattern=re.compile(r"password\s*[=:]\s*['\"]?([^'\">\s]{8,})['\"]?", re.IGNORECASE),
        ),
        SecretPattern(
            name="BEARER_TOKEN",
            pattern=re.compile(r"Bearer\s+([a-zA-Z0-9\-_.+/=]{20,})", re.IGNORECASE),
        ),
        SecretPattern(
            name="BASIC_AUTH",
            pattern=re.compile(r"Basic\s+([a-zA-Z0-9+/=]{20,})", re.IGNORECASE),
        ),
    ]

    def __init__(self, patterns: list[SecretPattern] | None = None):
        """
        Initialize redactor with secret patterns.

        Args:
            patterns: List of secret patterns to detect. Uses defaults if None.
        """
        self.patterns = patterns or self.DEFAULT_PATTERNS
        logger.info("Initialized redactor", pattern_count=len(self.patterns))

    def redact(self, text: str) -> str:
        """
        Redact secrets from text.

        Args:
            text: Text potentially containing secrets

        Returns:
            Text with secrets replaced by [REDACTED:{name}]
        """
        if not text:
            return text

        redacted_text = text
        redaction_count = 0

        for secret_pattern in self.patterns:
            matches = list(secret_pattern.pattern.finditer(redacted_text))
            if matches:
                for match in matches:
                    redacted_text = redacted_text.replace(
                        match.group(0), f"[REDACTED:{secret_pattern.name}]"
                    )
                    redaction_count += 1

        if redaction_count > 0:
            logger.debug("Redacted secrets", count=redaction_count)

        return redacted_text

    def redact_env_vars(self, text: str, env_vars: list[str]) -> str:
        """
        Redact specific environment variable values from text.

        Args:
            text: Text potentially containing env var values
            env_vars: List of environment variable names to redact

        Returns:
            Text with env var values redacted
        """
        if not text or not env_vars:
            return text

        redacted_text = text

        # Build patterns for each env var
        # Matches: VAR=value, VAR="value", VAR='value', export VAR=value
        for var_name in env_vars:
            # Pattern to match the variable assignment
            pattern = re.compile(
                rf"(?:export\s+)?{re.escape(var_name)}\s*=\s*['\"]?([^'\">\s]+)['\"]?",
                re.IGNORECASE,
            )

            matches = list(pattern.finditer(redacted_text))
            if matches:
                for match in matches:
                    # Replace the entire assignment with redacted version
                    redacted_text = redacted_text.replace(
                        match.group(0),
                        f"{var_name}=[REDACTED:ENV_VAR]",
                    )

        return redacted_text

    def add_pattern(self, name: str, pattern: str | re.Pattern) -> None:
        """
        Add a custom secret pattern.

        Args:
            name: Name for the secret type
            pattern: Regex pattern to detect the secret
        """
        compiled_pattern = pattern if isinstance(pattern, re.Pattern) else re.compile(pattern)
        self.patterns.append(SecretPattern(name=name, pattern=compiled_pattern))
        logger.info("Added custom pattern", name=name)

    def remove_pattern(self, name: str) -> bool:
        """
        Remove a secret pattern by name.

        Args:
            name: Name of the pattern to remove

        Returns:
            True if pattern was found and removed
        """
        original_count = len(self.patterns)
        self.patterns = [p for p in self.patterns if p.name != name]
        removed = len(self.patterns) < original_count

        if removed:
            logger.info("Removed pattern", name=name)

        return removed
