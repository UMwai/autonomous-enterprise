# Safety Module Integration Example

This document shows how to integrate all safety components into a complete workflow.

## Complete Workflow Example

### Temporal Workflow with Safety Controls

```typescript
import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities';

const { safeExecuteCode } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
  heartbeatTimeout: '30 seconds',
});

/**
 * Workflow for building and deploying a project with full safety controls.
 */
export async function buildAndDeployWorkflow(input: {
  runId: string;
  projectPath: string;
  deployPlatform: 'vercel' | 'netlify';
}): Promise<DeploymentResult> {
  const { runId, projectPath, deployPlatform } = input;

  // Step 1: Install dependencies
  const installResult = await safeExecuteCode({
    runId,
    command: 'npm install',
    workspaceFiles: [
      { path: '/workspace/package.json', content: readPackageJson() }
    ],
    timeout: 300000, // 5 minutes
  });

  if (installResult.exitCode !== 0) {
    throw new Error(`Dependency installation failed: ${installResult.stderr}`);
  }

  // Step 2: Run tests
  const testResult = await safeExecuteCode({
    runId,
    command: 'npm test',
    timeout: 120000, // 2 minutes
  });

  if (testResult.exitCode !== 0) {
    throw new Error(`Tests failed: ${testResult.stderr}`);
  }

  // Step 3: Build project
  const buildResult = await safeExecuteCode({
    runId,
    command: 'npm run build',
    timeout: 300000,
  });

  if (buildResult.exitCode !== 0) {
    throw new Error(`Build failed: ${buildResult.stderr}`);
  }

  // Step 4: Deploy (requires human approval via policy)
  const deployResult = await safeExecuteCode({
    runId,
    command: `${deployPlatform} deploy --prod`,
    timeout: 300000,
    allowedDomains: ['api.vercel.com', 'api.netlify.com'],
  });

  return {
    success: deployResult.exitCode === 0,
    url: parseDeploymentUrl(deployResult.stdout),
    totalCost: installResult.cost + testResult.cost + buildResult.cost + deployResult.cost,
    budgetRemaining: deployResult.budgetRemaining,
  };
}
```

### Activity Implementation

```typescript
// temporal/activities/build.ts
import { Context } from '@temporalio/activity';
import { E2BSandbox, SandboxSession } from './sandbox';
import { PolicyClient, BudgetClient, ActionType } from '../../safety';
import { Redactor } from './redaction';

const policyClient = new PolicyClient(process.env.API_URL);
const budgetClient = new BudgetClient(process.env.API_URL);
const redactor = new Redactor();

export async function safeExecuteCode(input: {
  runId: string;
  command: string;
  workspaceFiles?: Array<{ path: string; content: string }>;
  timeout?: number;
  allowedDomains?: string[];
}): Promise<ExecutionResult> {
  const { runId, command, workspaceFiles = [], timeout = 60000, allowedDomains } = input;

  let session: SandboxSession | null = null;

  try {
    // 1. Check policy
    const policyDecision = await policyClient.checkCodeExecution(command);

    if (!policyDecision.allowed) {
      throw new Error(`Policy check failed: ${policyDecision.reason}`);
    }

    if (policyDecision.requires_approval) {
      // In production, this would trigger a human approval workflow
      throw new Error(`Action requires human approval: ${policyDecision.reason}`);
    }

    // 2. Check budget
    const estimatedCost = 0.01; // $0.01 per execution
    const canSpend = await budgetClient.canSpend(runId, estimatedCost);

    if (!canSpend) {
      const status = await budgetClient.getStatus(runId);
      throw new Error(
        `Budget exceeded: ${status.spent}/${status.limit} USD spent`
      );
    }

    // 3. Create sandbox
    session = await E2BSandbox.create('base');

    // 4. Upload files
    if (workspaceFiles.length > 0) {
      await E2BSandbox.uploadFiles(session, workspaceFiles);
    }

    // 5. Execute command
    Context.current().heartbeat({ status: 'executing', command });
    const result = await E2BSandbox.execute(session, command, timeout);

    // 6. Redact sensitive information from output
    const redactedStdout = redactor.redact(result.stdout);
    const redactedStderr = redactor.redact(result.stderr);

    // 7. Record cost
    await budgetClient.spend(runId, estimatedCost);

    return {
      ...result,
      stdout: redactedStdout,
      stderr: redactedStderr,
      cost: estimatedCost,
    };

  } finally {
    // Always cleanup
    if (session) {
      await E2BSandbox.destroy(session);
    }
  }
}
```

### FastAPI Endpoint Integration

```python
from fastapi import APIRouter, Depends, HTTPException
from temporalio.client import Client
from ae_api.safety import PolicyGate, BudgetTracker, ActionType
from ae_api.config import get_settings

router = APIRouter()

@router.post("/projects/{project_id}/build-deploy")
async def build_and_deploy_project(
    project_id: str,
    deploy_platform: str,
    policy_gate: PolicyGate = Depends(get_policy_gate),
    budget_tracker: BudgetTracker = Depends(get_budget_tracker),
    temporal_client: Client = Depends(get_temporal_client),
):
    """
    Build and deploy a project with full safety controls.
    """
    settings = get_settings()
    run_id = f"build-deploy-{project_id}-{uuid4()}"

    try:
        # 1. Create budget
        budget_status = await budget_tracker.create_budget(
            run_id=run_id,
            limit=settings.default_run_budget,
        )

        # 2. Check deployment policy
        deploy_decision = policy_gate.check_action(
            ActionType.DEPLOY,
            {"platform": deploy_platform, "project_id": project_id},
        )

        if not deploy_decision.allowed:
            raise HTTPException(
                status_code=403,
                detail=f"Deployment blocked: {deploy_decision.reason}",
            )

        # 3. Start Temporal workflow
        handle = await temporal_client.start_workflow(
            "buildAndDeployWorkflow",
            args=[{
                "runId": run_id,
                "projectPath": f"/projects/{project_id}",
                "deployPlatform": deploy_platform,
            }],
            id=run_id,
            task_queue="autonomous-enterprise",
        )

        # 4. Return workflow ID for tracking
        return {
            "run_id": run_id,
            "workflow_id": handle.id,
            "budget_limit": budget_status.limit,
            "requires_approval": deploy_decision.requires_approval,
        }

    except Exception as e:
        # Cleanup budget on error
        await budget_tracker.delete_budget(run_id)
        raise
```

### Frontend Integration

```typescript
// React component for triggering builds with safety controls
import React, { useState } from 'react';

interface BuildStatus {
  runId: string;
  workflowId: string;
  budgetLimit: number;
  requiresApproval: boolean;
}

export function BuildDeployButton({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState<BuildStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBuildDeploy = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/v1/projects/${projectId}/build-deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deploy_platform: 'vercel',
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail);
      }

      const data: BuildStatus = await response.json();
      setStatus(data);

      if (data.requiresApproval) {
        alert('Deployment requires human approval. Please review and approve.');
      }

      // Poll for workflow status
      pollWorkflowStatus(data.workflowId);

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button onClick={handleBuildDeploy} disabled={loading}>
        {loading ? 'Building...' : 'Build & Deploy'}
      </button>

      {status && (
        <div>
          <p>Run ID: {status.runId}</p>
          <p>Budget Limit: ${status.budgetLimit}</p>
          {status.requiresApproval && (
            <p className="warning">⚠️ Requires Human Approval</p>
          )}
        </div>
      )}

      {error && <p className="error">Error: {error}</p>}
    </div>
  );
}
```

### Monitoring and Alerts

```python
# observability/budget_monitor.py
import asyncio
from ae_api.safety import BudgetTracker
from redis.asyncio import Redis

async def monitor_budget_thresholds(
    tracker: BudgetTracker,
    run_id: str,
    alert_thresholds: list[float] = [0.5, 0.8, 0.9],
):
    """
    Monitor budget usage and send alerts at thresholds.

    Args:
        tracker: Budget tracker instance
        run_id: Run ID to monitor
        alert_thresholds: Percentage thresholds for alerts (0.0-1.0)
    """
    alerted_at = set()

    while True:
        try:
            status = await tracker.get_status(run_id)
            usage_pct = status.spent / status.limit

            for threshold in alert_thresholds:
                if usage_pct >= threshold and threshold not in alerted_at:
                    await send_alert(
                        title=f"Budget Alert: {int(threshold * 100)}% Used",
                        message=f"Run {run_id} has used ${status.spent} of ${status.limit}",
                        severity="warning" if threshold < 0.9 else "critical",
                    )
                    alerted_at.add(threshold)

            if status.exceeded:
                await send_alert(
                    title="Budget Exceeded!",
                    message=f"Run {run_id} exceeded budget: ${status.spent} > ${status.limit}",
                    severity="critical",
                )
                break

        except Exception as e:
            logger.error(f"Error monitoring budget: {e}")

        await asyncio.sleep(10)  # Check every 10 seconds
```

### Logging with Redaction

```python
# observability/safe_logger.py
import structlog
from ae_api.safety import Redactor

# Initialize redactor with custom patterns
redactor = Redactor()
redactor.add_pattern("CUSTOM_TOKEN", r"myapp-[A-Z0-9]{20}")

# Create processor for automatic redaction
def redact_secrets(logger, method_name, event_dict):
    """Redact secrets from all log messages."""
    if "event" in event_dict:
        event_dict["event"] = redactor.redact(event_dict["event"])

    # Redact all string values
    for key, value in event_dict.items():
        if isinstance(value, str):
            event_dict[key] = redactor.redact(value)

    return event_dict

# Configure structlog with redaction
structlog.configure(
    processors=[
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        redact_secrets,  # Add redaction processor
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ],
)

logger = structlog.get_logger()

# Now all logs are automatically redacted
logger.info("API key set", api_key="sk-1234567890")
# Output: {"event": "API key set", "api_key": "[REDACTED:OPENAI_API_KEY]"}
```

## Complete Safety Flow

```
┌─────────────────┐
│   User Request  │
│  "Deploy App"   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  FastAPI Check  │
│  - Policy       │
│  - Budget       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Temporal Start  │
│  Workflow       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Activity: Safe  │
│  Execute Code   │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐  ┌─────────┐
│ Policy │  │ Budget  │
│ Check  │  │ Check   │
└────┬───┘  └────┬────┘
     │           │
     └─────┬─────┘
           ▼
    ┌─────────────┐
    │ E2B Sandbox │
    │  - Create   │
    │  - Upload   │
    │  - Execute  │
    │  - Download │
    │  - Destroy  │
    └──────┬──────┘
           │
           ▼
    ┌─────────────┐
    │  Redactor   │
    │ Redact Logs │
    └──────┬──────┘
           │
           ▼
    ┌─────────────┐
    │ Record Cost │
    │ to Budget   │
    └──────┬──────┘
           │
           ▼
    ┌─────────────┐
    │   Return    │
    │   Result    │
    └─────────────┘
```

## Testing the Complete Flow

```bash
# 1. Start Redis
docker run -d -p 6379:6379 redis:7-alpine

# 2. Start FastAPI
cd apps/api
uvicorn ae_api.main:app --reload

# 3. Start Temporal Worker
cd workers/temporal-worker
npm run dev

# 4. Test with curl
curl -X POST http://localhost:8000/api/v1/projects/my-app/build-deploy \
  -H "Content-Type: application/json" \
  -d '{"deploy_platform": "vercel"}'

# 5. Check budget status
curl http://localhost:8000/api/v1/safety/budget/build-deploy-my-app-{id}
```

This integration demonstrates production-ready safety controls with policy enforcement, budget tracking, secure execution, and comprehensive logging with secret redaction.
