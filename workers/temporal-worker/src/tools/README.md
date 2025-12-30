# Atomic Tools Layer

Composable, safe, and observable tool primitives for autonomous agents.

## Overview

The Atomic Tools Layer provides a unified interface for executing operations with built-in:

- **Policy Enforcement**: All operations checked against safety policies
- **Budget Tracking**: Automatic cost tracking and limits
- **Observability**: Comprehensive metrics and logging
- **Side Effect Tracking**: All changes tracked with optional rollback
- **Type Safety**: Full TypeScript support

## Architecture

```
┌─────────────────────────────────────────────┐
│  Tool Registry                               │
│  - Discover tools by name/category/risk     │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│  Tool Executor                               │
│  - Input validation                          │
│  - Budget checks                             │
│  - Policy enforcement                        │
│  - Cost tracking                             │
│  - Observability hooks                       │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│  Atomic Tools                                │
│  - ReadFileTool (SAFE)                       │
│  - GrepTool (SAFE)                           │
│  - ApplyPatchTool (LOW)                      │
│  - RunCommandTool (MEDIUM)                   │
│  - DeployVercelTool (CRITICAL)               │
│  - CreateStripeProductTool (CRITICAL)        │
│  - (More tools can be added...)              │
└──────────────────────────────────────────────┘
```

## Core Concepts

### Tool Categories

- **READ**: File reading operations (safe)
- **SEARCH**: Content search operations (safe)
- **INSPECT**: Code and runtime inspection (safe)
- **WRITE**: File creation operations (low risk)
- **EDIT**: File modification operations (low risk)
- **DELETE**: File and directory deletion (high risk)
- **SHELL**: Shell command execution (medium risk)
- **TEST**: Test execution and validation (low risk)
- **BUILD**: Build and compilation operations (medium risk)
- **NETWORK**: Network and HTTP operations (medium risk)
- **DEPLOY**: Deployment operations (high risk)
- **BILLING**: Billing and payment operations (critical risk)

### Risk Levels

- **SAFE**: Read-only operations, no side effects
- **LOW**: Isolated writes, easily reversible
- **MEDIUM**: Multiple files, harder to reverse
- **HIGH**: Destructive operations, deployments
- **CRITICAL**: Billing, production deployments

### Tool Context

Every tool execution receives a context with:

```typescript
interface ToolContext {
  workspace: string;           // Working directory
  runId: string;               // Unique run identifier
  phase: string;               // Current workflow phase
  budget: number;              // Budget limit in USD
  policyClient: PolicyClient;  // Policy enforcement
  budgetClient: BudgetClient;  // Budget tracking
  observer: ToolObserver;      // Metrics and logging
  env: Record<string, string>; // Environment variables
  signal?: AbortSignal;        // Cancellation support
}
```

### Tool Results

All tools return a standardized result:

```typescript
interface ToolResult<T> {
  success: boolean;           // Whether execution succeeded
  data?: T;                   // Typed output data
  output?: string;            // Human-readable output
  errors?: ToolError[];       // Errors if failed
  cost: number;               // Actual cost in USD
  duration: number;           // Execution time in ms
  sideEffects: SideEffect[];  // Changes with optional rollback
}
```

## Available Tools

### ReadFileTool

Read file contents with optional pagination.

```typescript
const result = await executor.execute(
  readTool,
  {
    path: 'src/index.ts',
    encoding: 'utf-8',
    offset: 0,      // Optional: start line
    limit: 100,     // Optional: number of lines
  },
  context
);
```

### GrepTool

Search file contents using ripgrep.

```typescript
const result = await executor.execute(
  grepTool,
  {
    pattern: 'import.*from',
    path: 'src',
    fileType: 'ts',
    ignoreCase: false,
    showLineNumbers: true,
    maxResults: 50,
    mode: 'content',  // or 'files'
  },
  context
);
```

### ApplyPatchTool

Apply text patches to files with backup and rollback.

```typescript
const result = await executor.execute(
  patchTool,
  {
    path: 'src/config.ts',
    oldText: 'const PORT = 3000',
    newText: 'const PORT = 8080',
    replaceAll: false,
    createBackup: true,
  },
  context
);

// Rollback if needed
if (!result.success) {
  for (const effect of result.sideEffects) {
    await effect.rollbackAction?.();
  }
}
```

### RunCommandTool

Execute shell commands with policy checks.

```typescript
const result = await executor.execute(
  commandTool,
  {
    command: 'npm',
    args: ['test'],
    cwd: '/path/to/project',
    timeout: 60000,
    stripAnsi: true,
  },
  context
);
```

### DeployVercelTool (CRITICAL)

Deploy applications to Vercel hosting platform.

**Requires human approval** when policy enforcement is enabled.

```typescript
const result = await executor.execute(
  deployTool,
  {
    projectName: 'my-saas-app',
    sourcePath: '/path/to/project',
    envVars: {
      NODE_ENV: 'production',
      API_KEY: 'secret-key',
    },
    buildCommand: 'npm run build',
    outputDirectory: 'dist',
    waitForCompletion: true,
    timeoutSeconds: 600,
  },
  context
);

// Handle approval requirement
if (!result.success && result.errors?.[0]?.code === 'APPROVAL_REQUIRED') {
  const actionId = result.errors[0].context?.action_id;
  // Use ApprovalClient to request and wait for approval
  await approvalClient.requestAndWait({ action_id: actionId, ... });
}
```

### CreateStripeProductTool (CRITICAL)

Create Stripe products with pricing configuration.

**Requires human approval** when policy enforcement is enabled.

```typescript
const result = await executor.execute(
  stripeTool,
  {
    name: 'Premium Plan',
    description: 'Full access to all features',
    priceInCents: 2999,  // $29.99
    currency: 'usd',
    interval: 'month',    // or 'year'
    oneTime: false,       // recurring by default
    trialPeriodDays: 14,
    metadata: {
      feature_set: 'premium',
      tier: '2',
    },
  },
  context
);

// Handle approval requirement
if (!result.success && result.errors?.[0]?.code === 'APPROVAL_REQUIRED') {
  const actionId = result.errors[0].context?.action_id;
  // Use ApprovalClient to request and wait for approval
  await approvalClient.requestAndWait({ action_id: actionId, ... });
}
```

## Usage Examples

### Basic Execution

```typescript
import {
  createDefaultRegistry,
  createConsoleObserver,
  ToolExecutor,
} from './tools/index.js';

// Create registry
const registry = createDefaultRegistry();

// Create executor
const executor = new ToolExecutor();

// Create context
const context = {
  workspace: '/path/to/workspace',
  runId: 'run-123',
  phase: 'build',
  budget: 10.0,
  policyClient: new PolicyClient(),
  budgetClient: new BudgetClient(),
  observer: createConsoleObserver(),
  env: process.env,
};

// Execute a tool
const tool = registry.get('read_file');
const result = await executor.execute(
  tool,
  { path: 'README.md' },
  context
);
```

### Sequential Execution

```typescript
const results = await executor.executeSequence(
  [
    { tool: registry.get('read_file')!, input: { path: 'test.txt' } },
    { tool: registry.get('apply_patch')!, input: { ... } },
    { tool: registry.get('run_command')!, input: { command: 'npm test' } },
  ],
  context,
  false // Stop on first error
);
```

### Parallel Execution

```typescript
const results = await executor.executeParallel(
  [
    { tool: registry.get('grep')!, input: { pattern: 'TODO' } },
    { tool: registry.get('grep')!, input: { pattern: 'FIXME' } },
    { tool: registry.get('grep')!, input: { pattern: 'console.log' } },
  ],
  context
);
```

### Retry on Transient Failures

```typescript
const result = await executor.executeWithRetry(
  tool,
  input,
  context,
  3,      // maxRetries
  1000    // retryDelay in ms
);
```

## Adding New Tools

To add a new tool:

1. **Create the tool class**:

```typescript
export class MyCustomTool implements AtomicTool<MyInput, MyOutput> {
  readonly name = 'my_tool';
  readonly description = 'Does something useful';
  readonly category = ToolCategory.WRITE;
  readonly riskLevel = RiskLevel.LOW;
  readonly estimatedCost = 0.001;

  validateInput(input: MyInput): string[] {
    const errors: string[] = [];
    // Add validation logic
    return errors;
  }

  async execute(
    input: MyInput,
    context: ToolContext
  ): Promise<ToolResult<MyOutput>> {
    const startTime = Date.now();

    try {
      // Check policy if needed
      const decision = await context.policyClient.checkAction(...);
      if (!decision.allowed) {
        return { success: false, ... };
      }

      // Do the work
      const result = await doWork(input);

      // Track side effects
      const sideEffects: SideEffect[] = [{
        type: 'my_operation',
        description: 'Did something',
        resources: ['...'],
        rollbackAction: async () => { /* undo */ },
      }];

      return {
        success: true,
        data: result,
        cost: this.estimatedCost,
        duration: Date.now() - startTime,
        sideEffects,
      };
    } catch (error) {
      return { success: false, errors: [...], ... };
    }
  }
}
```

2. **Register the tool**:

```typescript
// In registry.ts or your setup code
registry.register(new MyCustomTool());
```

## Design Principles

1. **Atomic**: Each tool does one thing well
2. **Composable**: Tools can be chained and combined
3. **Safe**: Policy and budget enforcement by default
4. **Observable**: All operations tracked and logged
5. **Reversible**: Side effects can be rolled back
6. **Typed**: Full TypeScript type safety
7. **Testable**: Tools are pure functions of input + context

## Integration with Workflows

Tools are designed to be used in Temporal workflows and activities:

```typescript
// In a Temporal activity
export async function executeToolActivity(
  toolName: string,
  input: unknown,
  runId: string
): Promise<ToolResult> {
  const registry = createDefaultRegistry();
  const executor = new ToolExecutor();

  const context = createToolContext(runId);
  const tool = registry.get(toolName);

  if (!tool) {
    throw new Error(`Tool not found: ${toolName}`);
  }

  return executor.execute(tool, input, context);
}
```

## Testing

Tools are easily testable with mock contexts:

```typescript
import { describe, it, expect } from 'vitest';

describe('ReadFileTool', () => {
  it('reads a file successfully', async () => {
    const tool = new ReadFileTool();
    const context = createMockContext();

    const result = await tool.execute(
      { path: 'test.txt' },
      context
    );

    expect(result.success).toBe(true);
    expect(result.data?.content).toBeDefined();
  });
});
```

## Implemented Tools Summary

| Tool | Category | Risk Level | Cost | Description |
|------|----------|------------|------|-------------|
| `read_file` | READ | SAFE | $0.0001 | Read file contents with pagination |
| `grep` | SEARCH | SAFE | $0.0001 | Search files using ripgrep |
| `apply_patch` | EDIT | LOW | $0.0001 | Apply text patches with rollback |
| `run_command` | SHELL | MEDIUM | $0.001 | Execute shell commands |
| `deploy_vercel` | DEPLOY | CRITICAL | $0.05 | Deploy to Vercel (requires approval) |
| `create_stripe_product` | BILLING | CRITICAL | $0.01 | Create Stripe products (requires approval) |

## Future Enhancements

- [ ] WriteTool for creating new files
- [ ] DeleteTool for removing files/directories
- [ ] GitTool for git operations (clone, commit, push, PR)
- [ ] HttpTool for HTTP requests
- [ ] TestTool for running tests
- [ ] BuildTool for building projects
- [ ] DeployNetlifyTool for Netlify deployments
- [ ] Database tools (read/write)
- [ ] LLM tools (with token tracking)
- [ ] File system operations (copy, move, mkdir)
- [ ] Archive tools (zip, tar, etc.)
- [ ] Docker tools (build, run, push)

## References

- **Safety Module**: `../safety/README.md`
- **Policy Client**: `../safety/policyClient.ts`
- **Budget Client**: `../safety/budgets.ts`
- **Example Usage**: `./example.ts`
