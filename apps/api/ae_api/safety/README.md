# Safety & Governance Module

This module provides safety controls, budget tracking, and secret redaction for the Autonomous Enterprise system.

## Components

### 1. Policy Gate (`policies.py`)

Enforces security and safety policies on agent actions.

**Action Types:**
- `EXECUTE_CODE` - Code execution in sandboxes
- `DEPLOY` - Deployments to cloud platforms
- `CREATE_BILLING` - Billing/payment operations
- `DELETE_FILES` - File deletion operations
- `NETWORK_ACCESS` - Network requests

**Features:**
- Destructive command detection (rm -rf, DROP TABLE, etc.)
- Network allowlist validation
- Human approval requirements for sensitive actions
- Configurable policy enforcement

**Example:**
```python
from ae_api.safety import PolicyGate, ActionType

gate = PolicyGate(
    enable_code_execution=True,
    enable_network_access=True,
    enable_deployments=False,  # Disabled in production
    enable_billing=False
)

# Check if action is allowed
decision = gate.check_action(
    ActionType.EXECUTE_CODE,
    {"command": "npm install"}
)

if not decision.allowed:
    raise Exception(f"Action blocked: {decision.reason}")

if decision.requires_approval:
    # Request human approval
    pass
```

### 2. Budget Tracker (`budgets.py`)

Tracks and enforces spending budgets using Redis.

**Features:**
- Per-run budget limits
- Atomic spend tracking
- Budget exceeded detection
- Circuit breaker for over-budget workflows

**Example:**
```python
from redis.asyncio import Redis
from ae_api.safety import BudgetTracker

redis = Redis(host="localhost", port=6379, decode_responses=True)
tracker = BudgetTracker(redis)

# Create budget
status = await tracker.create_budget(run_id="run-123", limit=10.0)

# Check before spending
can_spend = await tracker.check_can_spend(run_id="run-123", amount=0.05)

if can_spend:
    # Record spend
    status = await tracker.spend(run_id="run-123", amount=0.05)
    print(f"Spent: ${status.spent}, Remaining: ${status.remaining}")
```

### 3. Redactor (`redaction.py`)

Redacts sensitive information from logs and outputs.

**Detects:**
- API keys (OpenAI, Anthropic, AWS, Google, GitHub, Stripe)
- JWT tokens
- Private keys
- Passwords
- Bearer tokens
- Basic auth credentials

**Example:**
```python
from ae_api.safety import Redactor

redactor = Redactor()

# Redact secrets from text
text = "export OPENAI_API_KEY=sk-1234567890abcdef"
redacted = redactor.redact(text)
# Output: "export OPENAI_API_KEY=[REDACTED:OPENAI_API_KEY]"

# Redact environment variables
env_vars = ["DATABASE_URL", "SECRET_KEY"]
redacted = redactor.redact_env_vars(text, env_vars)
```

## API Endpoints

### POST `/api/v1/safety/check`

Check if an action is allowed.

**Request:**
```json
{
  "action": "execute_code",
  "context": {
    "command": "npm install express"
  }
}
```

**Response:**
```json
{
  "allowed": true,
  "reason": "Action allowed by policy",
  "requires_approval": false
}
```

### POST `/api/v1/safety/budget/create`

Create a new budget.

**Request:**
```json
{
  "run_id": "run-123",
  "limit": 10.0
}
```

**Response:**
```json
{
  "run_id": "run-123",
  "spent": 0.0,
  "limit": 10.0,
  "remaining": 10.0,
  "exceeded": false
}
```

### POST `/api/v1/safety/budget/spend`

Record spending.

**Request:**
```json
{
  "run_id": "run-123",
  "amount": 0.05
}
```

**Response:**
```json
{
  "run_id": "run-123",
  "spent": 0.05,
  "limit": 10.0,
  "remaining": 9.95,
  "exceeded": false
}
```

### GET `/api/v1/safety/budget/{run_id}`

Get budget status.

**Response:**
```json
{
  "run_id": "run-123",
  "spent": 0.05,
  "limit": 10.0,
  "remaining": 9.95,
  "exceeded": false
}
```

### POST `/api/v1/safety/budget/can-spend`

Check if spending is allowed.

**Request:**
```json
{
  "run_id": "run-123",
  "amount": 0.10
}
```

**Response:**
```json
{
  "can_spend": true,
  "current_status": {
    "run_id": "run-123",
    "spent": 0.05,
    "limit": 10.0,
    "remaining": 9.95,
    "exceeded": false
  }
}
```

## Configuration

Add to `.env`:

```bash
# Redis for budget tracking
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0
REDIS_PASSWORD=  # Optional

# Budget limits
DEFAULT_RUN_BUDGET=10.0
MAX_RUN_BUDGET=100.0
```

## Dependencies

```bash
# Redis with hiredis for better performance
redis[hiredis]>=5.0.0
```

## Testing

```python
import pytest
from ae_api.safety import PolicyGate, ActionType

def test_destructive_command_blocked():
    gate = PolicyGate()
    decision = gate.check_action(
        ActionType.EXECUTE_CODE,
        {"command": "rm -rf /"}
    )
    assert not decision.allowed
    assert "destructive" in decision.reason.lower()
```

## Security Best Practices

1. **Always check policies before execution** - Never execute untrusted code without policy checks
2. **Use allowlists for network access** - Restrict network access to known safe domains
3. **Require approval for sensitive actions** - Deployments and billing should require human approval
4. **Monitor budget usage** - Set up alerts when budgets are approaching limits
5. **Redact logs** - Always redact sensitive information before logging
6. **Regular pattern updates** - Keep secret detection patterns up to date
7. **Audit logs** - Log all policy decisions for security audits

## Architecture

```
┌─────────────────┐
│  Temporal       │
│  Workflow       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Safety API     │
│  Endpoints      │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐  ┌─────────┐
│ Policy │  │ Budget  │
│  Gate  │  │ Tracker │
└────────┘  └────┬────┘
                 │
                 ▼
            ┌────────┐
            │ Redis  │
            └────────┘
```

## Future Enhancements

- [ ] Add webhook support for approval requests
- [ ] Implement rate limiting per action type
- [ ] Add audit log persistence to database
- [ ] Support custom policy plugins
- [ ] Add budget forecasting and alerts
- [ ] Implement anomaly detection for spending patterns
- [ ] Add secret scanning for file uploads
