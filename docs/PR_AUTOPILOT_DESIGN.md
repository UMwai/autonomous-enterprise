# PR Autopilot Design - Coordinator-Worker Pattern

## Overview

PR Autopilot is an autonomous pull request review system built on the Coordinator-Worker (Handoff) pattern. It uses multiple specialized AI agents that collaborate to provide comprehensive PR reviews covering security, code quality, and style.

## Architecture

### Design Pattern: Coordinator-Worker (Flat Handoff)

The system uses a **flat architecture** with no deep nesting:
- One Coordinator agent that routes to specialists
- Three specialist Worker agents (Security, GitHub, Style)
- Workers cannot talk to each other - only back to Coordinator
- No hierarchies, no complex orchestration

```
COORDINATOR (GPT-5.2)
  ├─> SECURITY (Opus 4.5) ──┐
  ├─> GITHUB (GPT-5.2) ─────┤
  └─> STYLE (Gemini 3) ─────┴─> back to COORDINATOR
```

### Agent Roles

| Agent | Model | Tools | Responsibility |
|-------|-------|-------|----------------|
| **Coordinator** | GPT-5.2 (Tier 2) | None | Route to workers, synthesize findings |
| **Security** | Opus 4.5 (Tier 1) | CVE DB, Files, Diff | Scan for vulnerabilities, secrets |
| **GitHub** | GPT-5.2 (Tier 2) | Diff, Files, Comment | Code review, post feedback |
| **Style** | Gemini 3 (Tier 3) | Files, Diff | Style checks, formatting |

### Why This Pattern?

**Advantages:**
- **Separation of concerns**: Each agent has one job
- **Model optimization**: Use expensive models (Opus) only where critical
- **Debuggability**: Clear handoff trail, easy to trace
- **Scalability**: Add new workers without changing coordinator
- **Cost control**: Budget tracking per agent, terminate early if needed

**Trade-offs:**
- More token overhead (handoff coordination)
- Potentially slower than parallel execution
- Coordinator must be smart about routing

## File Structure

```
workers/temporal-worker/src/
├── agents/prAutopilot/
│   ├── definitions.ts          # Agent configs (model, tools, instructions)
│   ├── protocol.ts             # Handoff signals, structured responses
│   ├── tools.ts                # GitHub API, CVE DB, PR operations
│   ├── types.d.ts              # TypeScript type definitions
│   ├── README.md               # Usage documentation
│   └── __tests__/
│       └── workflow.test.ts    # Unit tests
├── temporal/
│   ├── workflows/
│   │   └── prAutopilot.ts      # Temporal workflow orchestration
│   └── activities/
│       ├── prAutopilot/
│       │   └── index.ts        # Activity implementations
│       └── index.ts            # Export all activities
```

## Key Components

### 1. Agent Definitions (`definitions.ts`)

Each agent is defined with:
```typescript
{
  name: AgentType,              // coordinator | security | github | style
  model: ModelTier,             // tier1 (Opus) | tier2 (GPT) | tier3 (Gemini)
  instructions: string,         // System prompt with responsibilities
  tools: string[],              // Available tools (empty for coordinator)
  handoff_targets?: AgentType[], // Agents this can hand off to
  max_iterations?: number,      // Prevent infinite loops
  temperature?: number,         // LLM temperature
}
```

### 2. Handoff Protocol (`protocol.ts`)

Agents signal handoff by outputting structured JSON:

```json
{
  "action": "handoff",
  "target": "security",
  "reason": "PR modifies package.json, need CVE scan",
  "context": {
    "dependency_files": ["package.json"]
  }
}
```

Agent responses include:
```typescript
{
  agent: AgentType,             // Who produced this
  success: boolean,             // Did it succeed?
  summary: string,              // What happened
  findings: Finding[],          // Issues discovered
  next_agent: AgentType | null, // Hand off to whom (null = done)
  handoff_reason?: string,      // Why handing off
  tools_used: string[],         // Tools called
  tokens_used: number,          // Tokens consumed
  cost: number,                 // Cost incurred
  duration: number,             // Execution time (ms)
}
```

### 3. Tools (`tools.ts`)

Four core tools for PR interaction:

**get_pr_diff(context)**
- Fetches unified diff for entire PR
- Returns: `string` (diff content)

**get_changed_files(context)**
- Lists all modified files with metadata
- Returns: `FileChange[]` (filename, status, additions, deletions, patch)

**post_pr_comment(context, body, line?, path?)**
- Posts general or line-specific comment
- Returns: `void` (success/error)

**check_cve_database(package, version, ecosystem)**
- Queries OSV database for vulnerabilities
- Returns: `CVEVulnerability[]` (cve_id, severity, description, fix)

### 4. Temporal Workflow (`workflows/prAutopilot.ts`)

Orchestrates the agent execution loop:

```typescript
// 1. Initialize state
state = {
  current_agent: COORDINATOR,
  agent_history: [],
  findings: [],
  cost_incurred: 0,
  iteration: 0,
  completed: false,
}

// 2. Main loop
while (!completed && iteration < max_iterations) {
  // Execute current agent
  response = await runPRAgent(current_agent, pr_context, ...)

  // Track cost and findings
  state.cost_incurred += response.cost
  state.findings.push(...response.findings)

  // Check for handoff
  if (response.next_agent) {
    // Validate handoff is legal
    if (isValidHandoff(current_agent, response.next_agent)) {
      current_agent = response.next_agent
    }
  } else {
    completed = true
  }

  // Check limits
  if (cost_incurred >= budget_limit) break
  if (detectLoop(agent_history)) break
}

// 3. Post final review to GitHub
await postFinalReview(findings, review_status)
```

### 5. Activities (`activities/prAutopilot/index.ts`)

Implements agent execution logic:

```typescript
async function runPRAgent(params) {
  switch (agent_type) {
    case COORDINATOR:
      return executeCoordinator(...)
    case SECURITY:
      return executeSecurity(...)
    case GITHUB:
      return executeGitHub(...)
    case STYLE:
      return executeStyle(...)
  }
}
```

Each executor:
1. Calls appropriate tools
2. Analyzes results
3. Generates findings
4. Decides next handoff
5. Returns AgentResponse

## Execution Flow Example

**Scenario**: Review PR #123 that modifies `package.json` and `src/api.ts`

```
┌─────────────────────────────────────────────────┐
│ Iteration 1: COORDINATOR                        │
│ - get_changed_files() → ['package.json', ...]  │
│ - Sees dependency file → route to SECURITY      │
│ - Output: { next_agent: 'security' }            │
└─────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│ Iteration 2: SECURITY                           │
│ - get_changed_files()                           │
│ - get_pr_diff()                                 │
│ - Parse package.json from diff                  │
│ - check_cve_database('axios', '0.21.1', 'npm')  │
│ - Finding: CVE-2021-3749 (HIGH)                 │
│ - Output: { findings: [...], next: 'coord' }    │
└─────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│ Iteration 3: COORDINATOR                        │
│ - Has security findings                         │
│ - Still has code to review                      │
│ - Output: { next_agent: 'github' }              │
└─────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│ Iteration 4: GITHUB                             │
│ - get_pr_diff()                                 │
│ - Analyzes code changes                         │
│ - Finding: Missing error handling (MEDIUM)      │
│ - post_pr_comment() → posts review              │
│ - Output: { findings: [...], next: 'coord' }    │
└─────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│ Iteration 5: COORDINATOR                        │
│ - All workers completed                         │
│ - Synthesizes: 1 HIGH, 1 MEDIUM                 │
│ - Output: { next_agent: null }                  │
│ - WORKFLOW COMPLETE                             │
└─────────────────────────────────────────────────┘

Final Result:
{
  success: true,
  review_status: 'REQUEST_CHANGES', // HIGH blocks merge
  findings: [CVE finding, error handling finding],
  agents_executed: ['coordinator', 'security', 'github'],
  total_cost: $0.09,
  total_tokens: 4500
}
```

## Integration Points

### 1. Existing CLI Harness

Can leverage existing `runAgent()` from `activities/cli/harness.ts`:

```typescript
import { runAgent } from '../cli/harness.js';

const result = await runAgent({
  provider: 'claude', // or 'gemini', 'codex'
  workspace: '/tmp/pr-workspace',
  spec: {
    prompt: agentConfig.instructions,
    directives: [
      `Tools: ${agentConfig.tools.join(', ')}`,
      `PR: ${prContext}`,
    ],
  },
  budget: { maxCost: budgetRemaining },
});

const handoff = parseHandoffSignal(result.output);
const findings = parseFindings(result.output);
```

### 2. Safety/Policy Gates

Integrates with `PolicyClient` for action approval:

```typescript
import { PolicyClient, ActionType } from '../../../safety/policyClient.js';

const policy = new PolicyClient();

// Before posting comment
await policy.checkAndEnforce(ActionType.NETWORK_ACCESS, {
  url: 'https://api.github.com/...',
});

// Before CVE check
await policy.checkAndEnforce(ActionType.NETWORK_ACCESS, {
  url: 'https://api.osv.dev/v1/query',
});
```

### 3. Model Router

Aligns with existing 3-tier economy:

```typescript
// In economy/router.py equivalent
const modelMap = {
  tier1: 'claude-opus-4.5',      // Security (critical)
  tier2: 'gpt-5.2',              // Coordinator, GitHub
  tier3: 'gemini-3-pro-preview', // Style (fast)
};
```

### 4. Budget Tracking

Uses existing budget tracking:

```typescript
await trackAgentCost({
  agent_type: agentType,
  cost: response.cost,
  tokens: response.tokens_used,
});

// Check before each iteration
if (state.cost_incurred >= budgetLimit) {
  state.completed = true;
  break;
}
```

## Safety Features

### 1. Handoff Validation
- Coordinator can only hand to workers
- Workers can only hand back to Coordinator
- No worker-to-worker handoffs
- No self-handoffs

### 2. Loop Detection
```typescript
// Detect patterns like: A→B→A→B→A
function detectLoop(history, nextAgent) {
  const recent = [...history.slice(-4), nextAgent];
  const pattern = recent.slice(-2);
  const prev = recent.slice(-4, -2);
  return pattern[0] === prev[0] && pattern[1] === prev[1];
}
```

### 3. Budget Limits
- Default: $5 per PR review
- Configurable per request
- Hard stop when exceeded

### 4. Iteration Limits
- Default: 15 iterations max
- Prevents runaway execution
- Configurable

### 5. Policy Gates
- Network access approval
- Code execution approval
- Deployment approval
- File deletion approval

## Cost Model

Estimated costs per PR review:

| Agent | Calls | Tokens | Cost |
|-------|-------|--------|------|
| Coordinator | 2-3 | 1000 | $0.02 |
| Security | 1 | 2000 | $0.05 |
| GitHub | 1 | 1500 | $0.03 |
| Style | 0-1 | 600 | $0.01 |
| **Total** | **4-6** | **~5000** | **~$0.10** |

Budget recommendations:
- Small PRs (<100 lines): $1
- Medium PRs (<500 lines): $3
- Large PRs (>500 lines): $5
- Complex PRs (architecture): $10

## Testing Strategy

### Unit Tests
```typescript
// Test protocol parsing
parseHandoffSignal(output) → HandoffSignal | null
parseFindings(output) → Finding[]
validateAgentResponse(response) → {valid, errors}

// Test agent definitions
getAgentConfig(type) → AgentConfig
getAllAgents() → AgentConfig[]

// Test review logic
calculateReviewStatus(findings) → {status, blocking_count}
mergeFindings(responses) → Finding[]
```

### Integration Tests
```typescript
// Test individual agents
executeSecurity(prContext) → AgentResponse
executeGitHub(prContext) → AgentResponse

// Test workflow
await client.workflow.execute(prAutopilot, {
  args: [{ owner, repo, pull_number }]
})
```

### End-to-End Tests
```typescript
// Real PR review
const result = await reviewPR({
  owner: 'autonomous-enterprise',
  repo: 'test-repo',
  pull_number: 123,
  budget_limit: 5.0,
});

expect(result.success).toBe(true);
expect(result.findings.length).toBeGreaterThan(0);
```

## Deployment

### Prerequisites
```bash
# NPM packages
pnpm add @octokit/rest @langchain/langgraph

# Environment variables
GITHUB_TOKEN=ghp_...
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
```

### Register with Temporal
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
    handle = await temporal_client.start_workflow(
        "prAutopilot",
        args=[request.dict()],
        id=f"pr-{request.owner}-{request.repo}-{request.pull_number}",
        task_queue="pr-autopilot",
    )
    return await handle.result()
```

## Future Enhancements

1. **Parallel Workers**: Run Security + GitHub simultaneously, merge results
2. **Custom Rules**: Allow users to define project-specific review rules
3. **Auto-fix**: Let Style worker commit fixes automatically
4. **Learning**: Track accepted/rejected findings to improve routing
5. **Human-in-Loop**: Pause for approval on high-severity findings
6. **Metrics**: Dashboard for agent performance, cost, accuracy
7. **Multi-repo**: Review across multiple repos in monorepo setup
8. **Incremental**: Only review changed lines, not full files

## Comparison to Alternatives

### vs. Single Agent Review
- **PR Autopilot**: Specialized agents, better quality, higher cost
- **Single Agent**: Faster, cheaper, less thorough

### vs. Parallel Workers
- **PR Autopilot**: Sequential, easier to debug, predictable cost
- **Parallel**: Faster, complex coordination, variable cost

### vs. Deep Hierarchy
- **PR Autopilot**: Flat, simple, limited to 2 hops
- **Hierarchy**: Complex, powerful, harder to control

## Lessons Learned

1. **Flat is better**: Two-hop pattern (Coord→Worker→Coord) is sweet spot
2. **Model routing matters**: Use Opus only where critical (30% cost savings)
3. **Handoff overhead**: Each handoff costs ~500 tokens for coordination
4. **Loop detection critical**: Without it, agents can get stuck
5. **Structured output**: JSON blocks are more reliable than text parsing
6. **Budget as first-class**: Must track and enforce at every step

## References

- Temporal workflows: `workers/temporal-worker/src/temporal/workflows/`
- Existing harness: `workers/temporal-worker/src/temporal/activities/cli/harness.ts`
- Safety policies: `workers/temporal-worker/src/safety/policyClient.ts`
- Model routing: `apps/api/ae_api/economy/router.py`
