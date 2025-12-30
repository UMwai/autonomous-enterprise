# PR Autopilot - Execution Flow Diagram

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    GitHub Webhook/API Trigger                    │
│                    POST /api/v1/pr/review                        │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                  FastAPI Control Plane (Python)                  │
│                  apps/api/ae_api/                                │
│  - Validate request                                              │
│  - Check budget/policy                                           │
│  - Start Temporal workflow                                       │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼ (Temporal RPC)
┌─────────────────────────────────────────────────────────────────┐
│              Temporal Workflow: prAutopilot.ts                   │
│              workers/temporal-worker/src/temporal/workflows/     │
│                                                                   │
│  Main Orchestration Loop:                                        │
│  ┌────────────────────────────────────────────────────┐          │
│  │ while (!completed && iteration < max) {           │          │
│  │   response = runPRAgent(current_agent)            │          │
│  │   if (response.next_agent) {                      │          │
│  │     current_agent = response.next_agent           │          │
│  │   } else { completed = true }                     │          │
│  │ }                                                 │          │
│  └────────────────────────────────────────────────────┘          │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼ (Activity calls)
┌─────────────────────────────────────────────────────────────────┐
│           Temporal Activities: prAutopilot/index.ts              │
│           workers/temporal-worker/src/temporal/activities/       │
│                                                                   │
│  Agent Execution Functions:                                      │
│  - executeCoordinator()                                          │
│  - executeSecurity()                                             │
│  - executeGitHub()                                               │
│  - executeStyle()                                                │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                   ┌───────────┴───────────┐
                   │                       │
                   ▼                       ▼
        ┌──────────────────┐    ┌──────────────────┐
        │  Tool Execution  │    │  LLM API Calls   │
        │  tools.ts        │    │  (via harness)   │
        │                  │    │                  │
        │ - get_pr_diff    │    │ - Opus 4.5       │
        │ - get_files      │    │ - GPT-5.2        │
        │ - post_comment   │    │ - Gemini 3       │
        │ - check_cve      │    │                  │
        └────────┬─────────┘    └────────┬─────────┘
                 │                       │
                 ▼                       ▼
        ┌──────────────────┐    ┌──────────────────┐
        │ External APIs    │    │ Model Providers  │
        │ - GitHub API     │    │ - Anthropic      │
        │ - OSV CVE DB     │    │ - OpenAI         │
        │                  │    │ - Google         │
        └──────────────────┘    └──────────────────┘
```

## Detailed Agent Interaction Flow

```
START: PR #123 review requested
  │
  ├─> Fetch PR context (owner, repo, PR number)
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Iteration 1: COORDINATOR AGENT                                  │
│ Model: GPT-5.2 (Tier 2) - No tools, routing only                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ Input:                                                           │
│   - PR context: { owner, repo, pull_number: 123 }               │
│   - Previous responses: []                                       │
│                                                                  │
│ Actions:                                                         │
│   1. Call get_changed_files(context)                            │
│      → Result: ['package.json', 'src/api.ts', 'README.md']      │
│                                                                  │
│   2. Analyze file list:                                         │
│      - package.json detected → dependency change                │
│      - src/api.ts detected → code change                        │
│                                                                  │
│   3. Decision: Route to SECURITY first (dependencies critical)  │
│                                                                  │
│ Output:                                                          │
│   {                                                              │
│     agent: 'coordinator',                                        │
│     success: true,                                               │
│     summary: 'PR modifies dependencies - routing to security',  │
│     findings: [],                                                │
│     next_agent: 'security',                                      │
│     handoff_reason: 'Dependency files changed',                 │
│     tools_used: ['get_changed_files'],                          │
│     tokens_used: 500,                                            │
│     cost: 0.01                                                   │
│   }                                                              │
└─────────────────────────────────────────────────────────────────┘
  │
  │ HANDOFF: coordinator → security
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Iteration 2: SECURITY AGENT                                     │
│ Model: Claude Opus 4.5 (Tier 1) - Security-critical analysis    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ Input:                                                           │
│   - PR context                                                   │
│   - Previous responses: [coordinator response]                   │
│                                                                  │
│ Actions:                                                         │
│   1. get_changed_files(context)                                 │
│      → Filter: ['package.json']                                 │
│                                                                  │
│   2. get_pr_diff(context)                                       │
│      → Extract: Added 'axios@0.21.1'                            │
│                                                                  │
│   3. check_cve_database('axios', '0.21.1', 'npm')               │
│      → Found: CVE-2021-3749 (HIGH severity)                     │
│        Description: SSRF vulnerability                           │
│        Fixed in: 1.6.0                                           │
│                                                                  │
│   4. Scan diff for secrets:                                     │
│      → Pattern match for API keys, tokens                       │
│      → No secrets found                                         │
│                                                                  │
│   5. Decision: Critical finding, hand back to coordinator       │
│                                                                  │
│ Output:                                                          │
│   {                                                              │
│     agent: 'security',                                           │
│     success: true,                                               │
│     summary: 'Found 1 HIGH severity CVE',                       │
│     findings: [                                                  │
│       {                                                          │
│         type: 'CVE',                                             │
│         severity: 'HIGH',                                        │
│         file: 'package.json',                                    │
│         message: 'axios@0.21.1 has CVE-2021-3749 (SSRF)',       │
│         recommendation: 'Update to axios@1.6.0 or later',       │
│         cve_id: 'CVE-2021-3749'                                  │
│       }                                                          │
│     ],                                                           │
│     next_agent: 'coordinator',                                   │
│     handoff_reason: 'Security scan complete',                   │
│     tools_used: ['get_changed_files', 'get_pr_diff',            │
│                  'check_cve_database'],                         │
│     tokens_used: 2000,                                           │
│     cost: 0.05                                                   │
│   }                                                              │
└─────────────────────────────────────────────────────────────────┘
  │
  │ HANDOFF: security → coordinator
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Iteration 3: COORDINATOR AGENT                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ Input:                                                           │
│   - PR context                                                   │
│   - Previous responses: [coord, security]                        │
│   - Accumulated findings: [1 HIGH CVE]                          │
│                                                                  │
│ Actions:                                                         │
│   1. Review findings:                                            │
│      - Security: DONE (1 HIGH finding)                          │
│      - Code review: NOT STARTED                                 │
│      - Style: NOT STARTED                                       │
│                                                                  │
│   2. Decision: Route to GITHUB for code review                  │
│                                                                  │
│ Output:                                                          │
│   {                                                              │
│     agent: 'coordinator',                                        │
│     summary: 'Routing to code review',                          │
│     findings: [],                                                │
│     next_agent: 'github',                                        │
│     handoff_reason: 'Code changes need review',                 │
│     tokens_used: 400,                                            │
│     cost: 0.008                                                  │
│   }                                                              │
└─────────────────────────────────────────────────────────────────┘
  │
  │ HANDOFF: coordinator → github
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Iteration 4: GITHUB AGENT                                       │
│ Model: GPT-5.2 (Tier 2) - Code review and feedback              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ Input:                                                           │
│   - PR context                                                   │
│   - Previous findings: [CVE-2021-3749]                          │
│                                                                  │
│ Actions:                                                         │
│   1. get_pr_diff(context)                                       │
│      → Read full diff for src/api.ts                            │
│                                                                  │
│   2. Analyze code changes:                                      │
│      - New function: fetchUserData()                            │
│      - Uses axios (flagged by security)                         │
│      - Missing: error handling for network failures             │
│      - Missing: input validation                                │
│      - Missing: tests                                           │
│                                                                  │
│   3. Generate findings:                                         │
│      - MEDIUM: Missing error handling                           │
│      - MEDIUM: No input validation                              │
│      - LOW: No test coverage                                    │
│                                                                  │
│   4. post_pr_comment(context, review_body)                      │
│      → Posted review comment with findings                      │
│                                                                  │
│   5. Decision: Code review complete, hand back                  │
│                                                                  │
│ Output:                                                          │
│   {                                                              │
│     agent: 'github',                                             │
│     success: true,                                               │
│     summary: 'Code review complete - 3 issues found',           │
│     findings: [                                                  │
│       {                                                          │
│         type: 'EDGE_CASE',                                       │
│         severity: 'MEDIUM',                                      │
│         file: 'src/api.ts',                                      │
│         line: 45,                                                │
│         message: 'Missing error handling for network timeout',  │
│         recommendation: 'Add try-catch with timeout handling'   │
│       },                                                         │
│       {                                                          │
│         type: 'BUG',                                             │
│         severity: 'MEDIUM',                                      │
│         file: 'src/api.ts',                                      │
│         line: 42,                                                │
│         message: 'No input validation for userId parameter',    │
│         recommendation: 'Validate userId is a positive integer' │
│       },                                                         │
│       {                                                          │
│         type: 'EDGE_CASE',                                       │
│         severity: 'LOW',                                         │
│         file: 'tests/',                                          │
│         message: 'No tests for new fetchUserData function',     │
│         recommendation: 'Add unit and integration tests'        │
│       }                                                          │
│     ],                                                           │
│     next_agent: 'coordinator',                                   │
│     tools_used: ['get_pr_diff', 'post_pr_comment'],             │
│     tokens_used: 1500,                                           │
│     cost: 0.03                                                   │
│   }                                                              │
└─────────────────────────────────────────────────────────────────┘
  │
  │ HANDOFF: github → coordinator
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Iteration 5: COORDINATOR AGENT (FINAL)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ Input:                                                           │
│   - All responses: [coord, security, coord, github]             │
│   - Total findings: 4 (1 HIGH, 2 MEDIUM, 1 LOW)                 │
│                                                                  │
│ Actions:                                                         │
│   1. Review completion status:                                  │
│      ✓ Security: DONE                                           │
│      ✓ GitHub: DONE                                             │
│      ? Style: OPTIONAL (skipped for now)                        │
│                                                                  │
│   2. Synthesize findings:                                       │
│      - 1 HIGH severity (BLOCKS merge)                           │
│      - 2 MEDIUM severity (REQUEST changes)                      │
│      - 1 LOW severity (suggestion)                              │
│                                                                  │
│   3. Decision: All critical reviews complete                    │
│                                                                  │
│ Output:                                                          │
│   {                                                              │
│     agent: 'coordinator',                                        │
│     success: true,                                               │
│     summary: 'Review complete - 4 issues found',                │
│     findings: [],                                                │
│     next_agent: null,  ← TERMINATES workflow                    │
│     tokens_used: 300,                                            │
│     cost: 0.006                                                  │
│   }                                                              │
└─────────────────────────────────────────────────────────────────┘
  │
  │ WORKFLOW COMPLETE
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Post-Review Actions (in workflow)                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ 1. Merge all findings from agents                               │
│    → Total: 4 findings                                          │
│                                                                  │
│ 2. Calculate review status                                      │
│    → Status: REQUEST_CHANGES (due to HIGH severity)             │
│                                                                  │
│ 3. Format final review comment                                  │
│    → Summary: "4 issues found (1 blocking)"                     │
│    → Details: Grouped by severity                               │
│                                                                  │
│ 4. post_final_review(pr_context, findings, status)              │
│    → Posts comprehensive review to GitHub PR                    │
│                                                                  │
│ 5. Track costs                                                  │
│    → Total: $0.104 (within budget)                              │
│    → Tokens: 4700                                                │
│                                                                  │
│ 6. Return workflow result                                       │
└─────────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ FINAL OUTPUT                                                     │
├─────────────────────────────────────────────────────────────────┤
│ {                                                                │
│   success: true,                                                 │
│   review_status: 'REQUEST_CHANGES',                             │
│   findings: [                                                    │
│     { type: 'CVE', severity: 'HIGH', ... },                     │
│     { type: 'EDGE_CASE', severity: 'MEDIUM', ... },             │
│     { type: 'BUG', severity: 'MEDIUM', ... },                   │
│     { type: 'EDGE_CASE', severity: 'LOW', ... }                 │
│   ],                                                             │
│   summary: {                                                     │
│     high_severity: 1,                                            │
│     medium_severity: 2,                                          │
│     low_severity: 1,                                             │
│     info: 0                                                      │
│   },                                                             │
│   agents_executed: ['coordinator', 'security', 'github'],       │
│   total_cost: 0.104,                                             │
│   total_tokens: 4700,                                            │
│   metadata: {                                                    │
│     started_at: '2025-12-24T10:00:00Z',                         │
│     completed_at: '2025-12-24T10:02:15Z',                       │
│     duration_ms: 135000,                                         │
│     iterations: 5                                                │
│   }                                                              │
│ }                                                                │
└─────────────────────────────────────────────────────────────────┘

END: PR review posted to GitHub
```

## Cost Breakdown

```
Agent          | Model      | Tokens | Cost    | % of Total
---------------|------------|--------|---------|------------
Coordinator #1 | GPT-5.2    | 500    | $0.010  | 9.6%
Security       | Opus 4.5   | 2000   | $0.050  | 48.1%
Coordinator #2 | GPT-5.2    | 400    | $0.008  | 7.7%
GitHub         | GPT-5.2    | 1500   | $0.030  | 28.8%
Coordinator #3 | GPT-5.2    | 300    | $0.006  | 5.8%
---------------|------------|--------|---------|------------
TOTAL          |            | 4700   | $0.104  | 100%
```

Key observations:
- Security agent (Opus 4.5) is 48% of cost but critical for CVE detection
- Coordinator overhead is ~23% (3 calls for routing)
- 5 iterations to complete (2.5 hops: Coord→Security→Coord→GitHub→Coord)

## Error Scenarios

### Scenario A: Budget Exceeded

```
Iteration 1: COORDINATOR → next: security
Iteration 2: SECURITY → cost += $0.05, total = $0.05
Iteration 3: COORDINATOR → next: github
Iteration 4: GITHUB → cost += $0.03, total = $0.08
Iteration 5: COORDINATOR → next: style
Iteration 6: STYLE → cost += $0.01, total = $0.09
⚠️  BUDGET CHECK: $0.09 < $0.10 → CONTINUE
Iteration 7: COORDINATOR → next: security (re-check)
Iteration 8: SECURITY → cost += $0.05, total = $0.14
❌ BUDGET CHECK: $0.14 >= $0.10 → TERMINATE

Result: {
  success: false,
  error: 'Budget limit exceeded ($0.10)',
  findings: [...all findings collected so far...],
  total_cost: 0.14
}
```

### Scenario B: Infinite Loop Detected

```
Iteration 1: COORDINATOR → next: security
Iteration 2: SECURITY → next: coordinator
Iteration 3: COORDINATOR → next: security (again)
Iteration 4: SECURITY → next: coordinator (again)
Iteration 5: COORDINATOR → next: security (again)
❌ LOOP DETECTED: Pattern A→B→A→B→A

Result: {
  success: false,
  error: 'Agent handoff loop detected',
  agent_history: ['coordinator', 'security', 'coordinator',
                  'security', 'coordinator']
}
```

### Scenario C: Agent Failure

```
Iteration 1: COORDINATOR → next: security
Iteration 2: SECURITY execution fails (GitHub API timeout)
❌ Tool error: get_pr_diff() → timeout

Agent returns:
{
  success: false,
  error: 'GitHub API timeout',
  findings: [],
  next_agent: null  ← Terminates workflow
}

Workflow handles gracefully:
- Logs error
- Returns partial results
- Still posts available findings
```
