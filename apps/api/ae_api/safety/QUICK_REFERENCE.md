# Safety Module - Quick Reference

## Python Quick Reference

### Import Safety Components

```python
from ae_api.safety import (
    PolicyGate, ActionType, PolicyDecision,
    BudgetTracker, BudgetStatus,
    Redactor, SecretPattern
)
```

### Check Policy

```python
gate = PolicyGate(enable_code_execution=True)
decision = gate.check_action(
    ActionType.EXECUTE_CODE,
    {"command": "npm install"}
)

if not decision.allowed:
    raise Exception(decision.reason)
```

### Track Budget

```python
from redis.asyncio import Redis

redis = Redis(host="localhost", port=6379, decode_responses=True)
tracker = BudgetTracker(redis)

# Create
await tracker.create_budget("run-123", 10.0)

# Check
can_spend = await tracker.check_can_spend("run-123", 0.05)

# Spend
status = await tracker.spend("run-123", 0.05)

# Get Status
status = await tracker.get_status("run-123")
```

### Redact Secrets

```python
redactor = Redactor()

# Redact all known secret patterns
text = "API key: sk-1234567890abcdef"
clean = redactor.redact(text)  # "API key: [REDACTED:OPENAI_API_KEY]"

# Redact environment variables
env_text = "DATABASE_URL=postgresql://user:pass@host/db"
clean = redactor.redact_env_vars(env_text, ["DATABASE_URL"])
```

## TypeScript Quick Reference

### Import Safety Clients

```typescript
import { PolicyClient, BudgetClient, ActionType } from './safety';
import { E2BSandbox } from './temporal/activities/sandbox';
```

### Check Policy

```typescript
const client = new PolicyClient('http://localhost:8000');

// Check
const decision = await client.checkCodeExecution('npm install');

// Check and enforce (throws if not allowed)
await client.checkAndEnforce(ActionType.EXECUTE_CODE, {
  command: 'npm test'
});
```

### Track Budget

```typescript
const client = new BudgetClient('http://localhost:8000');

// Create
await client.createBudget('run-123', 10.0);

// Check
const canSpend = await client.canSpend('run-123', 0.05);

// Spend
const status = await client.spend('run-123', 0.05);

// Enforce (throws if would exceed)
await client.enforceLimit('run-123', 0.05);
```

### Use E2B Sandbox

```typescript
// Create
const session = await E2BSandbox.create('base');

try {
  // Upload files
  await E2BSandbox.uploadFiles(session, [
    { path: '/workspace/test.js', content: 'console.log("hi");' }
  ]);

  // Execute
  const result = await E2BSandbox.execute(
    session,
    'node /workspace/test.js',
    30000  // timeout
  );

  console.log(result.stdout);

} finally {
  // Always cleanup
  await E2BSandbox.destroy(session);
}
```

### Safe Execution

```typescript
import { safeExecuteCode } from './temporal/activities/sandbox/safeExecute';

const result = await safeExecuteCode({
  runId: 'run-123',
  command: 'npm test',
  timeout: 60000,
  allowedDomains: ['registry.npmjs.org'],
});

console.log(`Exit: ${result.exitCode}`);
console.log(`Cost: $${result.cost}`);
console.log(`Budget left: $${result.budgetRemaining}`);
```

## API Endpoints

### Base URL
`http://localhost:8000/api/v1/safety`

### Check Policy
```bash
curl -X POST http://localhost:8000/api/v1/safety/check \
  -H "Content-Type: application/json" \
  -d '{
    "action": "execute_code",
    "context": {"command": "npm install"}
  }'
```

### Create Budget
```bash
curl -X POST http://localhost:8000/api/v1/safety/budget/create \
  -H "Content-Type: application/json" \
  -d '{
    "run_id": "run-123",
    "limit": 10.0
  }'
```

### Record Spend
```bash
curl -X POST http://localhost:8000/api/v1/safety/budget/spend \
  -H "Content-Type: application/json" \
  -d '{
    "run_id": "run-123",
    "amount": 0.05
  }'
```

### Get Budget Status
```bash
curl http://localhost:8000/api/v1/safety/budget/run-123
```

### Check Can Spend
```bash
curl -X POST http://localhost:8000/api/v1/safety/budget/can-spend \
  -H "Content-Type: application/json" \
  -d '{
    "run_id": "run-123",
    "amount": 0.05
  }'
```

## Action Types

```python
# Python
from ae_api.safety import ActionType

ActionType.EXECUTE_CODE      # Code execution
ActionType.DEPLOY            # Deployments
ActionType.CREATE_BILLING    # Billing operations
ActionType.DELETE_FILES      # File deletion
ActionType.NETWORK_ACCESS    # Network requests
```

```typescript
// TypeScript
import { ActionType } from './safety';

ActionType.EXECUTE_CODE
ActionType.DEPLOY
ActionType.CREATE_BILLING
ActionType.DELETE_FILES
ActionType.NETWORK_ACCESS
```

## Common Patterns

### Pattern 1: Safe Workflow Execution

```typescript
async function safeWorkflow(runId: string) {
  const policy = new PolicyClient();
  const budget = new BudgetClient();

  // 1. Check policy
  await policy.checkAndEnforce(ActionType.EXECUTE_CODE, {
    command: 'npm test'
  });

  // 2. Check budget
  await budget.enforceLimit(runId, 0.10);

  // 3. Execute safely
  const result = await safeExecuteCode({
    runId,
    command: 'npm test',
  });

  // 4. Check result
  if (result.exitCode !== 0) {
    throw new Error(`Tests failed: ${result.stderr}`);
  }

  return result;
}
```

### Pattern 2: Batch Execution with Budget

```python
async def execute_with_budget(run_id: str, commands: list[str]):
    tracker = BudgetTracker(redis)

    for cmd in commands:
        # Check before each command
        if not await tracker.check_can_spend(run_id, 0.01):
            raise Exception("Budget exceeded")

        # Execute
        result = execute_command(cmd)

        # Record actual cost
        await tracker.spend(run_id, 0.01)

    return await tracker.get_status(run_id)
```

### Pattern 3: Secure Logging

```python
from ae_api.safety import Redactor
import structlog

redactor = Redactor()
logger = structlog.get_logger()

def safe_log(message: str, **context):
    # Redact all values
    safe_context = {
        k: redactor.redact(str(v))
        for k, v in context.items()
    }
    logger.info(redactor.redact(message), **safe_context)
```

## Environment Variables

```bash
# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0
REDIS_PASSWORD=

# E2B
E2B_API_KEY=your-key-here

# API
API_URL=http://localhost:8000

# Budgets
DEFAULT_RUN_BUDGET=10.0
MAX_RUN_BUDGET=100.0
```

## Testing

### Python
```bash
pytest tests/test_safety.py -v
```

### TypeScript
```bash
npm test src/safety
```

## Troubleshooting

### Budget Not Found
```
Error: Budget not found for run_id: xyz
```
Solution: Create budget first with `create_budget()`

### Policy Blocked
```
Error: Action blocked by policy: Command contains destructive patterns
```
Solution: Review command for dangerous operations (rm -rf, DROP, etc.)

### Redis Connection Failed
```
Error: Connection refused
```
Solution: Ensure Redis is running: `docker run -d -p 6379:6379 redis:7-alpine`

### E2B Sandbox Timeout
```
Error: Execution timed out
```
Solution: Increase timeout parameter or optimize command

## Best Practices

1. Always use `try-finally` for sandbox cleanup
2. Check policies before expensive operations
3. Set appropriate timeouts for all executions
4. Redact logs before storage/transmission
5. Use `checkAndEnforce()` for simpler code
6. Monitor budget thresholds with alerts
7. Test destructive pattern detection regularly
8. Keep secret patterns up to date
9. Use allowlists for network access
10. Require approval for production deployments
