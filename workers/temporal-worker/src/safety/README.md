# Safety Clients (TypeScript)

TypeScript clients for interacting with the safety and governance API.

## Components

### 1. Policy Client (`policyClient.ts`)

Client for checking actions against safety policies.

**Example:**
```typescript
import { PolicyClient, ActionType } from './safety';

const client = new PolicyClient('http://localhost:8000');

// Check code execution
const decision = await client.checkCodeExecution('npm install express');

if (!decision.allowed) {
  throw new Error(`Action blocked: ${decision.reason}`);
}

if (decision.requires_approval) {
  // Request human approval
  console.log('Action requires human approval');
}

// Check and enforce in one call (throws if not allowed)
await client.checkAndEnforce(ActionType.EXECUTE_CODE, {
  command: 'npm install express'
});
```

**Methods:**
- `checkAction(action, context)` - Check if action is allowed
- `checkCodeExecution(command)` - Check code execution
- `checkDeployment(platform, config)` - Check deployment
- `checkBilling(operation, amount)` - Check billing operation
- `checkDeleteFiles(paths)` - Check file deletion
- `checkNetworkAccess(url, allowlist)` - Check network access
- `enforceDecision(decision)` - Enforce a decision (throws if not allowed)
- `checkAndEnforce(action, context)` - Check and enforce in one call

### 2. Budget Client (`budgets.ts`)

Client for tracking and enforcing spending budgets.

**Example:**
```typescript
import { BudgetClient } from './safety';

const client = new BudgetClient('http://localhost:8000');

// Create budget
await client.createBudget('run-123', 10.0);

// Check before spending
const canSpend = await client.canSpend('run-123', 0.05);

if (canSpend) {
  // Record spend
  const status = await client.spend('run-123', 0.05);
  console.log(`Spent: $${status.spent}, Remaining: $${status.remaining}`);
}

// Spend with automatic enforcement (throws if would exceed)
const status = await client.spendWithEnforcement('run-123', 0.05);
```

**Methods:**
- `createBudget(runId, limit)` - Create new budget
- `spend(runId, amount)` - Record spending
- `getStatus(runId)` - Get current budget status
- `canSpend(runId, amount)` - Check if spending is allowed
- `deleteBudget(runId)` - Delete budget
- `isExceeded(runId)` - Check if budget is exceeded
- `enforceLimit(runId, amount)` - Enforce limit (throws if would exceed)
- `spendWithEnforcement(runId, amount)` - Spend with automatic enforcement

## Integration with Temporal Activities

```typescript
import { Context } from '@temporalio/activity';
import { PolicyClient, BudgetClient, ActionType } from '../safety';

const policyClient = new PolicyClient(process.env.API_URL);
const budgetClient = new BudgetClient(process.env.API_URL);

export async function executeCodeActivity(
  runId: string,
  command: string
): Promise<ExecutionResult> {
  // Check policy
  await policyClient.checkAndEnforce(ActionType.EXECUTE_CODE, { command });

  // Check budget (assume $0.01 per execution)
  await budgetClient.enforceLimit(runId, 0.01);

  // Execute code
  const result = await executeInSandbox(command);

  // Record actual cost
  const actualCost = calculateCost(result);
  await budgetClient.spend(runId, actualCost);

  return result;
}
```

## E2B Sandbox (`temporal/activities/sandbox/e2b.ts`)

Secure code execution using E2B sandboxes.

**Example:**
```typescript
import { E2BSandbox } from '../temporal/activities/sandbox';

// Create sandbox
const session = await E2BSandbox.create('base');

try {
  // Upload files
  await E2BSandbox.uploadFiles(session, [
    { path: '/workspace/index.js', content: 'console.log("Hello");' }
  ]);

  // Execute command
  const result = await E2BSandbox.execute(session, 'node /workspace/index.js', 30000);

  console.log(`Exit code: ${result.exitCode}`);
  console.log(`Output: ${result.stdout}`);

  if (result.timedOut) {
    console.log('Execution timed out');
  }

  // Download results
  const files = await E2BSandbox.downloadFiles(session, ['/workspace/output.txt']);

} finally {
  // Always cleanup
  await E2BSandbox.destroy(session);
}
```

**Methods:**
- `create(template, limits)` - Create new sandbox session
- `execute(session, command, timeout)` - Execute command
- `uploadFiles(session, files)` - Upload files to sandbox
- `downloadFiles(session, paths)` - Download files from sandbox
- `listFiles(session, path)` - List files in directory
- `installPackages(session, packages, packageManager)` - Install packages
- `destroy(session)` - Cleanup sandbox
- `getSessionInfo(session)` - Get session information
- `isAlive(session)` - Check if sandbox is responsive

## Configuration

Environment variables:

```bash
# API endpoints
API_URL=http://localhost:8000

# E2B API key
E2B_API_KEY=your-key-here
```

## Error Handling

All clients throw descriptive errors:

```typescript
try {
  await policyClient.checkAndEnforce(ActionType.EXECUTE_CODE, {
    command: 'rm -rf /'
  });
} catch (error) {
  // Error: Action blocked by policy: Command contains destructive patterns
  console.error(error.message);
}

try {
  await budgetClient.spendWithEnforcement('run-123', 100.0);
} catch (error) {
  // Error: Budget limit exceeded: Would spend $100, but only $9.95 remaining
  console.error(error.message);
}
```

## Testing

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyClient, ActionType } from './policyClient';

describe('PolicyClient', () => {
  let client: PolicyClient;

  beforeEach(() => {
    client = new PolicyClient('http://localhost:8000');
  });

  it('should allow safe commands', async () => {
    const decision = await client.checkCodeExecution('echo hello');
    expect(decision.allowed).toBe(true);
  });

  it('should block destructive commands', async () => {
    const decision = await client.checkCodeExecution('rm -rf /');
    expect(decision.allowed).toBe(false);
  });
});
```

## Best Practices

1. **Always use try-finally for sandboxes** - Ensure cleanup even on errors
2. **Set appropriate timeouts** - Prevent infinite loops
3. **Check budgets before expensive operations** - Use `canSpend()` first
4. **Use enforcement methods** - `checkAndEnforce()` and `spendWithEnforcement()` are safer
5. **Handle timeout gracefully** - Check `result.timedOut` flag
6. **Monitor sandbox health** - Use `isAlive()` for long-running sessions
7. **Redact secrets in logs** - Never log sandbox output without redaction
