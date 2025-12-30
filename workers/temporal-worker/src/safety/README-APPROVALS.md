# HITL Approval Gateway

Human-in-the-loop approval system for sensitive operations in the Autonomous Enterprise.

## Overview

The HITL Approval Gateway provides a structured way to request, track, and enforce human approvals for sensitive actions like deployments, billing operations, and code execution.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Temporal Worker (TypeScript)                   │
│  - Checks policy via PolicyClient               │
│  - Requests approval via ApprovalClient         │
│  - Waits for decision with polling              │
└────────────────────┬────────────────────────────┘
                     │ HTTP
┌────────────────────▼────────────────────────────┐
│  FastAPI API (Python)                           │
│  - /api/v1/approvals endpoints                  │
│  - ApprovalQueue with Redis backend             │
└────────────────────┬────────────────────────────┘
                     │ Redis
┌────────────────────▼────────────────────────────┐
│  Redis                                          │
│  - approval:{action_id} - Approval data         │
│  - approvals:pending - Sorted set by expiry    │
└─────────────────────────────────────────────────┘
```

## Workflow Integration

### 1. Policy Check First

Always check the policy before requesting approval:

```typescript
import { PolicyClient, ActionType } from '../safety';
import { ApprovalClient } from '../safety';

const policyClient = new PolicyClient();
const approvalClient = new ApprovalClient();

// Check policy
const decision = await policyClient.checkDeployment('vercel', config);

if (!decision.allowed) {
  throw new Error(`Deployment blocked: ${decision.reason}`);
}

// If requires approval, request it
if (decision.requires_approval) {
  const approval = await approvalClient.requestDeploymentApproval(
    'vercel',
    config,
    runId,
    3600 // 1 hour timeout
  );

  // Wait for human decision (polls every 5 seconds)
  await approvalClient.waitForApproval(approval.action_id);

  // If we get here, deployment was approved
  await deployToVercel(config);
}
```

### 2. Request and Wait Pattern

For workflows that need to block on approval:

```typescript
// Request approval and wait for decision in one call
const approval = await approvalClient.requestAndWait(
  {
    action_id: `deploy-${runId}-${Date.now()}`,
    action_type: 'deploy',
    description: 'Deploy trading bot to Vercel',
    context: { platform: 'vercel', config },
    run_id: runId,
    timeout_seconds: 3600,
  },
  5 // poll interval in seconds
);

// Approval was granted, proceed with action
logger.info({ approval }, 'Deployment approved, proceeding');
```

### 3. Async Pattern (Fire and Forget)

For background tasks that can continue later:

```typescript
// Request approval without blocking
const approval = await approvalClient.requestApproval({
  action_id: `billing-${operationId}`,
  action_type: 'create_billing',
  description: 'Create Stripe subscription',
  context: { operation: 'create_subscription', amount: 29.99 },
  run_id: runId,
  timeout_seconds: 7200, // 2 hours
});

// Store action_id for later retrieval
await context.storage.set('pending_billing_approval', approval.action_id);

// Continue workflow or signal external system
// Human will review via UI/API and make decision
```

### 4. Temporal Activity Pattern

Use within Temporal activities for automatic retry on approval rejection:

```typescript
import { Context } from '@temporalio/activity';

export async function deployToVercel(config: DeployConfig): Promise<DeployResult> {
  const context = Context.current();
  const runId = context.info.workflowExecution.runId;

  const policyClient = new PolicyClient();
  const approvalClient = new ApprovalClient();

  // Check policy
  const decision = await policyClient.checkDeployment('vercel', config);

  if (!decision.allowed) {
    throw new Error(`Deployment blocked: ${decision.reason}`);
  }

  // Request approval if needed
  if (decision.requires_approval) {
    try {
      await approvalClient.requestAndWait(
        {
          action_id: `deploy-vercel-${Date.now()}`,
          action_type: 'deploy',
          description: `Deploy ${config.projectName} to Vercel`,
          context: { platform: 'vercel', config },
          run_id: runId,
          timeout_seconds: 3600,
        },
        5
      );
    } catch (error) {
      // Approval rejected or expired
      throw new Error(`Deployment approval failed: ${error.message}`);
    }
  }

  // Execute deployment
  return await executeVercelDeployment(config);
}
```

## API Endpoints

### Create Approval Request

```bash
POST /api/v1/approvals/
Content-Type: application/json

{
  "action_id": "deploy-vercel-1234567890",
  "action_type": "deploy",
  "description": "Deploy trading bot to Vercel",
  "context": {
    "platform": "vercel",
    "config": { "projectName": "trading-bot" }
  },
  "run_id": "wf_abc123",
  "requested_by": "temporal-worker",
  "timeout_seconds": 3600
}
```

### List Pending Approvals

```bash
GET /api/v1/approvals/?run_id=wf_abc123&limit=50
```

### Get Approval Status

```bash
GET /api/v1/approvals/{action_id}
```

### Approve/Reject

```bash
POST /api/v1/approvals/{action_id}/decide
Content-Type: application/json

{
  "approved": true,
  "reason": "Deployment reviewed and approved",
  "decided_by": "admin@example.com"
}
```

### Cancel Approval

```bash
POST /api/v1/approvals/{action_id}/cancel?reason=Workflow+cancelled
```

### Cleanup Expired

```bash
POST /api/v1/approvals/cleanup
```

## States and Transitions

```
PENDING ──┬──> APPROVED (human decision)
          ├──> REJECTED (human decision)
          ├──> EXPIRED (timeout exceeded)
          └──> CANCELLED (workflow cancelled)
```

### State Descriptions

- **PENDING**: Waiting for human decision
- **APPROVED**: Human approved the action
- **REJECTED**: Human rejected the action
- **EXPIRED**: Timeout exceeded without decision
- **CANCELLED**: Workflow or system cancelled the request

## Helper Methods

### Code Execution

```typescript
const approval = await approvalClient.requestCodeExecutionApproval(
  'npm run migrate:production',
  runId,
  1800 // 30 minutes
);
```

### Deployment

```typescript
const approval = await approvalClient.requestDeploymentApproval(
  'vercel',
  { projectName: 'my-app' },
  runId,
  3600
);
```

### Billing

```typescript
const approval = await approvalClient.requestBillingApproval(
  'create_subscription',
  29.99,
  runId,
  7200 // 2 hours for billing review
);
```

## Error Handling

```typescript
try {
  await approvalClient.waitForApproval(actionId);
} catch (error) {
  if (error.message.includes('timeout exceeded')) {
    // Handle timeout
    logger.error('Approval request timed out');
    await handleApprovalTimeout();
  } else if (error.message.includes('not approved')) {
    // Handle rejection
    logger.error('Approval request rejected');
    await handleApprovalRejection();
  } else {
    // Handle other errors
    throw error;
  }
}
```

## Configuration

### Timeouts

Default timeout is 3600 seconds (1 hour). Adjust based on action urgency:

- Code execution: 30-60 minutes
- Deployment: 1-2 hours
- Billing: 2-4 hours (more review time)
- File deletion: 30 minutes

### Poll Intervals

Default poll interval is 5 seconds. Adjust for different scenarios:

- Interactive workflows: 3-5 seconds
- Background tasks: 10-30 seconds
- Long-running: 60 seconds

## Best Practices

1. **Always check policy first**: Use PolicyClient before ApprovalClient
2. **Use descriptive action_ids**: Include type, timestamp, and context
3. **Provide context**: Include all relevant information for human review
4. **Set appropriate timeouts**: Balance urgency vs review time
5. **Handle all states**: Account for approved, rejected, expired, cancelled
6. **Log decisions**: Track who approved/rejected and why
7. **Clean up expired**: Run periodic cleanup to prevent stale approvals
8. **Use helper methods**: Leverage requestCodeExecutionApproval, etc.

## UI Integration

The approval system is designed to integrate with a web UI where operators can:

1. View pending approvals for their runs
2. See detailed context about each action
3. Approve or reject with reasons
4. Track approval history
5. Set up notifications for urgent approvals

Example UI workflow:

```
1. Operator opens dashboard
2. Sees badge: "3 pending approvals"
3. Clicks to view list
4. Reviews details: "Deploy trading bot to Vercel"
5. Checks deployment config and test results
6. Clicks "Approve" with reason: "Tests passed, deploying to production"
7. Workflow continues automatically
```

## Monitoring and Alerts

Track these metrics:

- Pending approval count
- Average approval time
- Approval/rejection rate
- Expired approval count
- Approvals by action type
- Approvals by user

Set up alerts for:

- High pending count (>10)
- Long pending time (>2 hours)
- High rejection rate (>30%)
- Expired approvals

## Future Enhancements

- Multi-stage approvals (require N out of M approvers)
- Role-based approval routing
- Approval delegation/escalation
- Approval templates and policies
- Webhook notifications
- Audit logging to database
- Approval analytics dashboard
