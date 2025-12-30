# PR Autopilot - Coordinator-Worker Pattern

Autonomous pull request review system using the Coordinator-Worker handoff pattern.

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│  Temporal Workflow (prAutopilot.ts)             │
│  - Orchestrates agent execution loop             │
│  - Manages handoffs and state                    │
│  - Enforces budget and iteration limits          │
└────────────────────┬────────────────────────────┘
                     │
         ┌───────────▼───────────┐
         │   COORDINATOR         │  (GPT-5.2, Tier 2)
         │   - No tools          │
         │   - Routes to workers │
         └───────────┬───────────┘
                     │
         ┌───────────┼───────────┐
         │           │           │
    ┌────▼───┐  ┌───▼────┐  ┌───▼────┐
    │SECURITY│  │ GITHUB │  │ STYLE  │
    │(Opus)  │  │(GPT-5.2)│  │(Gemini)│
    │CVE scan│  │Code rev│  │Linting │
    └────┬───┘  └───┬────┘  └───┬────┘
         │          │           │
         └──────────┴───────────┘
                    │
         ┌──────────▼───────────┐
         │   COORDINATOR         │
         │   - Synthesizes       │
         │   - Posts review      │
         └───────────────────────┘
```

## Agent Definitions

### Coordinator Agent
- **Model**: GPT-5.2 (Tier 2)
- **Role**: Route to specialists, synthesize findings
- **Tools**: None (handoffs only)
- **Handoff targets**: security, github, style

### Security Worker
- **Model**: Claude Opus 4.5 (Tier 1)
- **Role**: CVE scanning, secret detection
- **Tools**: check_cve_database, get_changed_files, get_pr_diff
- **Handoff targets**: coordinator

### GitHub Worker
- **Model**: GPT-5.2 (Tier 2)
- **Role**: Code review, PR comments
- **Tools**: get_pr_diff, get_changed_files, post_pr_comment
- **Handoff targets**: coordinator

### Style Worker
- **Model**: Gemini 3 Pro Preview (Tier 3)
- **Role**: Code style and conventions
- **Tools**: get_changed_files, get_pr_diff
- **Handoff targets**: coordinator

## Handoff Protocol

Agents signal handoff by including structured JSON in their response:

```json
{
  "action": "handoff",
  "target": "security",
  "reason": "PR modifies package.json, need CVE scan",
  "context": {
    "dependency_files": ["package.json", "package-lock.json"]
  }
}
```

### Handoff Rules
1. Coordinator can hand off to any worker
2. Workers can only hand off back to Coordinator
3. No worker-to-worker handoffs (prevents complexity)
4. Loop detection prevents infinite handoffs
5. Max iterations enforced (default: 15)

## Tools

### get_pr_diff(context: PRContext)
Fetches unified diff for all changes in the PR.

```typescript
const result = await get_pr_diff({
  owner: 'myorg',
  repo: 'myrepo',
  pull_number: 123
});
// result.data contains full diff
```

### get_changed_files(context: PRContext)
Returns list of files modified in the PR with metadata.

```typescript
const result = await get_changed_files({
  owner: 'myorg',
  repo: 'myrepo',
  pull_number: 123
});
// result.data: FileChange[]
// { filename, status, additions, deletions, patch }
```

### post_pr_comment(context: PRContext, body: string, line?: number, path?: string)
Posts a comment on the PR (general or line-specific).

```typescript
// General comment
await post_pr_comment(context, "LGTM! 🚀");

// Line-specific comment
await post_pr_comment(
  context,
  "Consider using async/await here",
  42,
  "src/api.ts"
);
```

### check_cve_database(packageName: string, version: string, ecosystem: string)
Queries OSV database for known vulnerabilities.

```typescript
const result = await check_cve_database('axios', '0.21.1', 'npm');
// result.data: CVEVulnerability[]
// { cve_id, severity, description, fixed_version, references }
```

## Example Execution Flow

### Scenario: Check PR #123 for security issues

```typescript
// 1. Start workflow
const result = await client.workflow.execute(prAutopilot, {
  taskQueue: 'pr-autopilot',
  workflowId: 'pr-123-review',
  args: [{
    owner: 'autonomous-enterprise',
    repo: 'ae-platform',
    pull_number: 123,
    budget_limit: 5.0,
  }],
});

// 2. Workflow execution flow:

// Iteration 1: COORDINATOR
// - Fetches changed files
// - Detects package.json modification
// - Decision: Hand off to SECURITY
// - Output: { next_agent: 'security', reason: 'Dependency file changed' }

// Iteration 2: SECURITY
// - get_changed_files() → ['package.json', 'src/api.ts']
// - get_pr_diff() → extracts full diff
// - Parses package.json from diff
// - check_cve_database('axios', '0.21.1', 'npm')
// - Finds: CVE-2021-3749 (HIGH)
// - Finding: {
//     type: 'CVE',
//     severity: 'HIGH',
//     file: 'package.json',
//     message: 'axios@0.21.1 has CVE-2021-3749',
//     recommendation: 'Update to axios@1.6.0'
//   }
// - Decision: Hand off to COORDINATOR
// - Output: { findings: [...], next_agent: 'coordinator' }

// Iteration 3: COORDINATOR
// - Reviews SECURITY findings
// - Still has code changes to review
// - Decision: Hand off to GITHUB
// - Output: { next_agent: 'github' }

// Iteration 4: GITHUB
// - get_pr_diff() → reads code changes
// - get_changed_files() → ['src/api.ts']
// - Analyzes code quality
// - Finding: {
//     type: 'EDGE_CASE',
//     severity: 'MEDIUM',
//     file: 'src/api.ts',
//     line: 45,
//     message: 'Missing error handling for network timeout',
//     recommendation: 'Add try-catch for fetch operation'
//   }
// - post_pr_comment() → posts review
// - Decision: Hand off to COORDINATOR
// - Output: { findings: [...], next_agent: 'coordinator' }

// Iteration 5: COORDINATOR
// - All workers completed
// - Synthesizes findings:
//   * 1 HIGH severity (CVE)
//   * 1 MEDIUM severity (error handling)
// - Decision: Review complete
// - Output: { next_agent: null }

// Workflow completes
// Final output:
// {
//   success: true,
//   review_status: 'REQUEST_CHANGES', // HIGH severity blocks merge
//   findings: [
//     { type: 'CVE', severity: 'HIGH', ... },
//     { type: 'EDGE_CASE', severity: 'MEDIUM', ... }
//   ],
//   summary: {
//     high_severity: 1,
//     medium_severity: 1,
//     low_severity: 0,
//     info: 0
//   },
//   agents_executed: ['coordinator', 'security', 'github'],
//   total_cost: 0.09,
//   total_tokens: 4500,
//   metadata: { ... }
// }
```

## Integration with Existing Harness

The PR Autopilot can integrate with the existing CLI harness for LLM execution:

```typescript
import { runAgent, AgentProvider } from '../activities/cli/harness.js';

// Use existing harness for agent execution
const result = await runAgent({
  provider: 'claude', // or 'gemini', 'codex'
  workspace: '/tmp/pr-workspace',
  spec: {
    prompt: agentConfig.instructions,
    directives: [
      `Available tools: ${agentConfig.tools.join(', ')}`,
      `PR Context: ${JSON.stringify(prContext)}`,
      `Previous findings: ${JSON.stringify(previousFindings)}`,
    ],
  },
  timeout: 120000,
  budget: {
    maxCost: budgetRemaining,
  },
});

// Parse handoff signal from output
const handoff = parseHandoffSignal(result.output);
const findings = parseFindings(result.output);
```

## Safety Integration

PR Autopilot integrates with existing safety/policy gates:

```typescript
import { PolicyClient, ActionType } from '../../../safety/policyClient.js';

const policyClient = new PolicyClient();

// Before posting comment
const decision = await policyClient.checkAction(
  ActionType.NETWORK_ACCESS,
  {
    url: `https://api.github.com/repos/${owner}/${repo}/pulls/${pr}/comments`,
    operation: 'post_comment',
  }
);

policyClient.enforceDecision(decision);

// Before CVE check
await policyClient.checkAndEnforce(
  ActionType.NETWORK_ACCESS,
  { url: 'https://api.osv.dev/v1/query' }
);
```

## Budget Tracking

```typescript
// Workflow tracks cost per agent
state.cost_incurred += agentResponse.cost;

// Check budget before each iteration
if (state.cost_incurred >= budgetLimit) {
  state.completed = true;
  state.completion_reason = `Budget exceeded ($${budgetLimit})`;
  break;
}

// Report to economy module
await trackAgentCost({
  agent_type: agentType,
  cost: agentResponse.cost,
  tokens: agentResponse.tokens_used,
});
```

## Model Routing

Aligns with existing 3-tier routing:

| Agent | Tier | Model | Rationale |
|-------|------|-------|-----------|
| Coordinator | 2 | GPT-5.2 | Routing logic, synthesis |
| Security | 1 | Opus 4.5 | Security-critical analysis |
| GitHub | 2 | GPT-5.2 | Code review quality |
| Style | 3 | Gemini 3 | Fast, deterministic checks |

## Error Handling

```typescript
// Agent failures don't crash workflow
try {
  const response = await runPRAgent(...);
  if (!response.success) {
    // Log error, skip to next agent or terminate
    logger.error({ agent, error: response.error });
  }
} catch (error) {
  // Return error response, continue workflow
  return {
    success: false,
    agent: agentType,
    error: error.message,
    next_agent: null, // Terminate on critical error
  };
}

// Loop detection
if (detectLoop(state.agent_history, nextAgent)) {
  state.completed = true;
  state.completion_reason = 'Infinite loop detected';
}

// Max iterations
if (state.iteration >= maxIterations) {
  state.completed = true;
  state.completion_reason = 'Max iterations reached';
}
```

## Testing

```typescript
// Test individual agents
import { executeSecurity } from '../activities/prAutopilot/index.js';

const response = await executeSecurity({
  owner: 'test',
  repo: 'test',
  pull_number: 1,
});

assert(response.success);
assert(response.findings.length > 0);
assert(response.next_agent === AgentType.COORDINATOR);

// Test workflow
import { prAutopilot } from '../workflows/prAutopilot.js';

const result = await testEnv.client.workflow.execute(prAutopilot, {
  args: [{
    owner: 'test',
    repo: 'test',
    pull_number: 1,
    budget_limit: 1.0,
  }],
});

assert(result.success);
assert(result.review_status === 'APPROVE');
```

## Deployment

### Environment Variables
```bash
# Required
GITHUB_TOKEN=ghp_...
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...

# Optional
TEMPORAL_HOST=localhost:7233
DATABASE_URL=postgresql://...
```

### Register Workflow
```typescript
// workers/temporal-worker/src/temporal/worker.ts
import { prAutopilot } from './workflows/prAutopilot.js';
import * as prAutopilotActivities from './activities/prAutopilot/index.js';

const worker = await Worker.create({
  workflowsPath: require.resolve('./workflows'),
  activities: {
    ...existingActivities,
    ...prAutopilotActivities,
  },
  taskQueue: 'pr-autopilot',
});
```

### API Endpoint
```python
# apps/api/ae_api/api/v1/endpoints/pr_autopilot.py
@router.post("/pr/review")
async def review_pr(request: ReviewPRRequest):
    workflow_id = f"pr-{request.owner}-{request.repo}-{request.pull_number}"

    handle = await temporal_client.start_workflow(
        "prAutopilot",
        args=[{
            "owner": request.owner,
            "repo": request.repo,
            "pull_number": request.pull_number,
            "budget_limit": request.budget_limit or 5.0,
        }],
        id=workflow_id,
        task_queue="pr-autopilot",
    )

    result = await handle.result()
    return result
```

## Future Enhancements

1. **Custom Rules Engine**: Allow users to define custom review rules
2. **Auto-fix**: Let Style worker commit auto-fixable changes
3. **Learning**: Track which findings are accepted/rejected to improve routing
4. **Parallel Workers**: Run Security + GitHub in parallel (requires state merge)
5. **Human-in-Loop**: Pause for approval on high-severity findings
6. **Metrics Dashboard**: Track agent performance, cost, and accuracy
