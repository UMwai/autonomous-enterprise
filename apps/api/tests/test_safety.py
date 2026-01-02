"""Tests for safety module."""

import pytest
from redis.asyncio import Redis

from ae_api.safety import ActionType, BudgetTracker, PolicyGate, Redactor


class TestPolicyGate:
    """Test PolicyGate functionality."""

    def test_allow_safe_code_execution(self):
        """Test that safe commands are allowed."""
        gate = PolicyGate(enable_code_execution=True)
        decision = gate.check_action(
            ActionType.EXECUTE_CODE,
            {"command": "echo hello"},
        )
        assert decision.allowed is True
        assert decision.requires_approval is False

    def test_block_destructive_commands(self):
        """Test that destructive commands are blocked."""
        gate = PolicyGate(enable_code_execution=True)

        destructive_commands = [
            "rm -rf /",
            "rm -rf *",
            "DROP DATABASE production",
            "DELETE FROM users",
            "dd if=/dev/zero of=/dev/sda",
        ]

        for command in destructive_commands:
            decision = gate.check_action(
                ActionType.EXECUTE_CODE,
                {"command": command},
            )
            assert decision.allowed is False, f"Command should be blocked: {command}"
            assert "destructive" in decision.reason.lower()

    def test_is_destructive(self):
        """Test destructive command detection."""
        gate = PolicyGate()

        assert gate.is_destructive("rm -rf /") is True
        assert gate.is_destructive("DROP TABLE users") is True
        assert gate.is_destructive("echo hello") is False
        assert gate.is_destructive("npm install") is False

    def test_disabled_action_type(self):
        """Test that disabled action types are blocked."""
        gate = PolicyGate(enable_code_execution=False)
        decision = gate.check_action(
            ActionType.EXECUTE_CODE,
            {"command": "echo hello"},
        )
        assert decision.allowed is False
        assert "disabled" in decision.reason.lower()

    def test_network_allowlist(self):
        """Test network allowlist validation."""
        gate = PolicyGate(enable_network_access=True)

        # Test with allowlist
        assert gate.validate_network_access(
            "https://api.github.com/users",
            ["api.github.com", "github.com"],
        ) is True

        # Test subdomain match
        assert gate.validate_network_access(
            "https://api.example.com/data",
            ["*.example.com"],
        ) is True

        # Test blocked URL
        assert gate.validate_network_access(
            "https://evil.com",
            ["api.github.com"],
        ) is False

        # Empty allowlist allows everything
        assert gate.validate_network_access(
            "https://anything.com",
            [],
        ) is True

    def test_approval_required_actions(self):
        """Test that sensitive actions require approval."""
        gate = PolicyGate(enable_deployments=True, enable_billing=True)

        deploy_decision = gate.check_action(ActionType.DEPLOY, {})
        assert deploy_decision.allowed is True
        assert deploy_decision.requires_approval is True

        billing_decision = gate.check_action(ActionType.CREATE_BILLING, {})
        assert billing_decision.allowed is True
        assert billing_decision.requires_approval is True


class TestBudgetTracker:
    """Test BudgetTracker functionality."""

    @pytest.fixture
    async def redis_client(self):
        """Create Redis client for testing."""
        redis = Redis(
            host="localhost",
            port=6379,
            decode_responses=True,
        )
        yield redis
        await redis.aclose()

    @pytest.fixture
    async def tracker(self, redis_client):
        """Create BudgetTracker instance."""
        return BudgetTracker(redis_client)

    @pytest.mark.asyncio
    async def test_create_budget(self, tracker):
        """Test budget creation."""
        status = await tracker.create_budget("test-run-1", 10.0)

        assert status.run_id == "test-run-1"
        assert status.limit == 10.0
        assert status.spent == 0.0
        assert status.remaining == 10.0
        assert status.exceeded is False

        # Cleanup
        await tracker.delete_budget("test-run-1")

    @pytest.mark.asyncio
    async def test_spend_tracking(self, tracker):
        """Test spending tracking."""
        await tracker.create_budget("test-run-2", 10.0)

        # Record first spend
        status = await tracker.spend("test-run-2", 3.0)
        assert status.spent == 3.0
        assert status.remaining == 7.0
        assert status.exceeded is False

        # Record second spend
        status = await tracker.spend("test-run-2", 2.5)
        assert status.spent == 5.5
        assert status.remaining == 4.5
        assert status.exceeded is False

        # Cleanup
        await tracker.delete_budget("test-run-2")

    @pytest.mark.asyncio
    async def test_budget_exceeded(self, tracker):
        """Test budget exceeded detection."""
        await tracker.create_budget("test-run-3", 5.0)

        # Spend within limit
        status = await tracker.spend("test-run-3", 4.0)
        assert status.exceeded is False

        # Exceed limit
        status = await tracker.spend("test-run-3", 2.0)
        assert status.exceeded is True
        assert status.remaining == 0.0

        # Cleanup
        await tracker.delete_budget("test-run-3")

    @pytest.mark.asyncio
    async def test_can_spend(self, tracker):
        """Test can spend check."""
        await tracker.create_budget("test-run-4", 10.0)

        # Spend some amount
        await tracker.spend("test-run-4", 7.0)

        # Check if can spend within remaining
        assert await tracker.check_can_spend("test-run-4", 2.0) is True

        # Check if can spend exceeding remaining
        assert await tracker.check_can_spend("test-run-4", 5.0) is False

        # Cleanup
        await tracker.delete_budget("test-run-4")

    @pytest.mark.asyncio
    async def test_invalid_budget_limit(self, tracker):
        """Test that invalid budget limits are rejected."""
        with pytest.raises(ValueError, match="positive"):
            await tracker.create_budget("test-run-5", -10.0)

        with pytest.raises(ValueError, match="positive"):
            await tracker.create_budget("test-run-6", 0.0)

    @pytest.mark.asyncio
    async def test_spend_on_nonexistent_budget(self, tracker):
        """Test that spending on non-existent budget fails."""
        with pytest.raises(ValueError, match="not found"):
            await tracker.spend("nonexistent-run", 1.0)


class TestRedactor:
    """Test Redactor functionality."""

    def test_redact_openai_key(self):
        """Test OpenAI API key redaction."""
        redactor = Redactor()
        text = "My API key is sk-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL"
        redacted = redactor.redact(text)
        assert "sk-1234567890" not in redacted
        assert "[REDACTED:OPENAI_API_KEY]" in redacted

    def test_redact_anthropic_key(self):
        """Test Anthropic API key redaction."""
        redactor = Redactor()
        text = "ANTHROPIC_API_KEY=sk-ant-" + "a" * 95
        redacted = redactor.redact(text)
        assert "sk-ant-" not in redacted
        assert "[REDACTED:ANTHROPIC_API_KEY]" in redacted

    def test_redact_aws_keys(self):
        """Test AWS credentials redaction."""
        redactor = Redactor()
        text = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE"
        redacted = redactor.redact(text)
        assert "AKIAIOSFODNN7EXAMPLE" not in redacted
        assert "[REDACTED:AWS_ACCESS_KEY]" in redacted

    def test_redact_jwt_token(self):
        """Test JWT token redaction."""
        redactor = Redactor()
        text = "Authorization: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.abc123"
        redacted = redactor.redact(text)
        assert "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" not in redacted
        assert "[REDACTED:JWT_TOKEN]" in redacted

    def test_redact_private_key(self):
        """Test private key redaction."""
        redactor = Redactor()
        text = """
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA1234567890
-----END RSA PRIVATE KEY-----
        """
        redacted = redactor.redact(text)
        assert "MIIEpAIBAAKCAQEA1234567890" not in redacted
        assert "[REDACTED:PRIVATE_KEY]" in redacted

    def test_redact_env_vars(self):
        """Test environment variable redaction."""
        redactor = Redactor()
        text = "DATABASE_URL=postgresql://user:pass@localhost/db"
        redacted = redactor.redact_env_vars(text, ["DATABASE_URL"])
        assert "postgresql://user:pass@localhost/db" not in redacted
        assert "DATABASE_URL=[REDACTED:ENV_VAR]" in redacted

    def test_add_custom_pattern(self):
        """Test adding custom redaction patterns."""
        redactor = Redactor()
        redactor.add_pattern("CUSTOM_TOKEN", r"CUSTOM-[A-Z0-9]{10}")

        text = "My token is CUSTOM-ABCD123456"
        redacted = redactor.redact(text)
        assert "CUSTOM-ABCD123456" not in redacted
        assert "[REDACTED:CUSTOM_TOKEN]" in redacted

    def test_remove_pattern(self):
        """Test removing redaction patterns."""
        redactor = Redactor()
        initial_count = len(redactor.patterns)

        # Remove a pattern
        removed = redactor.remove_pattern("OPENAI_API_KEY")
        assert removed is True
        assert len(redactor.patterns) == initial_count - 1

        # Try to remove non-existent pattern
        removed = redactor.remove_pattern("NONEXISTENT")
        assert removed is False

    def test_no_redaction_on_clean_text(self):
        """Test that clean text is not modified."""
        redactor = Redactor()
        text = "This is clean text with no secrets"
        redacted = redactor.redact(text)
        assert redacted == text
