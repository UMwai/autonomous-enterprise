# Safety Module Architecture

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Autonomous Enterprise                        │
│                         Safety & Governance                          │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         Frontend Layer                               │
│                                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │   React UI   │  │  Dashboard   │  │   Alerts     │              │
│  │  Components  │  │   Budget     │  │   Monitor    │              │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │
│         │                  │                  │                       │
└─────────┼──────────────────┼──────────────────┼───────────────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        FastAPI Control Plane                         │
│                                                                       │
│  ┌────────────────────────────────────────────────────────┐         │
│  │              Safety API Endpoints                       │         │
│  │  /api/v1/safety                                        │         │
│  │                                                        │         │
│  │  POST   /check                  - Policy check        │         │
│  │  POST   /budget/create          - Create budget       │         │
│  │  POST   /budget/spend           - Record spend        │         │
│  │  GET    /budget/{run_id}        - Get status          │         │
│  │  POST   /budget/can-spend       - Check limit         │         │
│  │  DELETE /budget/{run_id}        - Delete budget       │         │
│  └────────────────┬───────────────────────────────────────┘         │
│                   │                                                  │
└───────────────────┼──────────────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
        ▼                       ▼
┌──────────────┐        ┌──────────────┐
│ PolicyGate   │        │ BudgetTracker│
│              │        │              │
│ - Actions    │        │ - Create     │
│ - Patterns   │        │ - Spend      │
│ - Allowlist  │        │ - Check      │
│ - Approval   │        │ - Circuit    │
└──────────────┘        └──────┬───────┘
                               │
                               ▼
                        ┌──────────────┐
                        │    Redis     │
                        │              │
                        │ - Budget     │
                        │ - Spent      │
                        │ - Exceeded   │
                        └──────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                      Temporal Worker Layer                           │
│                                                                       │
│  ┌────────────────────────────────────────────────────────┐         │
│  │                    Workflows                            │         │
│  │                                                        │         │
│  │  buildAndDeployWorkflow()                             │         │
│  │  generateCodeWorkflow()                               │         │
│  │  deployProjectWorkflow()                              │         │
│  └────────────────────────────────────────────────────────┘         │
│         │                                                             │
│         ▼                                                             │
│  ┌────────────────────────────────────────────────────────┐         │
│  │                    Activities                           │         │
│  │                                                        │         │
│  │  safeExecuteCode()                                    │         │
│  │  safeExecuteBatch()                                   │         │
│  │  deployWithApproval()                                 │         │
│  └─────┬──────────────────────┬───────────────────────────┘         │
│        │                      │                                      │
└────────┼──────────────────────┼──────────────────────────────────────┘
         │                      │
         ▼                      ▼
  ┌─────────────┐        ┌─────────────┐
  │ Safety      │        │ E2B Sandbox │
  │ Clients     │        │             │
  │             │        │ - Create    │
  │ - Policy    │        │ - Execute   │
  │ - Budget    │        │ - Upload    │
  │ - Redactor  │        │ - Download  │
  └─────────────┘        │ - Destroy   │
                         └─────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                      External Services                               │
│                                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │     E2B      │  │    Redis     │  │   Temporal   │              │
│  │   Sandboxes  │  │   Cluster    │  │    Server    │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
└─────────────────────────────────────────────────────────────────────┘
```

## Component Interactions

### 1. Policy Check Flow

```
User Request
    │
    ▼
FastAPI Endpoint
    │
    ▼
PolicyGate.check_action()
    │
    ├──> Check if action type enabled
    │
    ├──> Check for destructive patterns
    │
    ├──> Check network allowlist
    │
    └──> Determine if approval required
         │
         ▼
    PolicyDecision
         │
         ├──> allowed: bool
         ├──> reason: string
         └──> requires_approval: bool
```

### 2. Budget Tracking Flow

```
Workflow Start
    │
    ▼
Create Budget
    │
    └──> Redis SET budget:{run_id} = limit
    └──> Redis SET spent:{run_id} = 0
         │
         ▼
Before Execution
    │
    └──> check_can_spend()
         │
         ├──> GET spent:{run_id}
         ├──> GET budget:{run_id}
         └──> Compare: spent + amount <= limit
              │
              ▼
         Can Spend?
              │
              ├──> Yes: Continue
              └──> No: Throw Error
                   │
After Execution
    │
    └──> spend()
         │
         └──> Redis INCRBYFLOAT spent:{run_id} amount
              │
              ├──> Check if exceeded
              └──> Update exceeded:{run_id}
```

### 3. Safe Execution Flow

```
safeExecuteCode()
    │
    ├──> 1. Check Policy
    │    └──> PolicyClient.checkCodeExecution()
    │
    ├──> 2. Check Budget
    │    └──> BudgetClient.canSpend()
    │
    ├──> 3. Create Sandbox
    │    └──> E2BSandbox.create()
    │
    ├──> 4. Upload Files
    │    └──> E2BSandbox.uploadFiles()
    │
    ├──> 5. Execute Command
    │    └──> E2BSandbox.execute()
    │         │
    │         ├──> Heartbeat to Temporal
    │         └──> Timeout protection
    │
    ├──> 6. Redact Secrets
    │    └──> Redactor.redact()
    │
    ├──> 7. Record Cost
    │    └──> BudgetClient.spend()
    │
    └──> 8. Cleanup
         └──> E2BSandbox.destroy()
```

## Data Models

### PolicyDecision

```typescript
interface PolicyDecision {
  allowed: boolean;           // Whether action is permitted
  reason: string;             // Explanation for decision
  requires_approval: boolean; // Needs human approval
}
```

### BudgetStatus

```typescript
interface BudgetStatus {
  run_id: string;      // Unique run identifier
  spent: number;       // Amount spent (USD)
  limit: number;       // Budget limit (USD)
  remaining: number;   // Remaining budget (USD)
  exceeded: boolean;   // Whether limit exceeded
}
```

### ExecutionResult

```typescript
interface ExecutionResult {
  stdout: string;       // Command output
  stderr: string;       // Error output
  exitCode: number;     // Exit code
  timedOut: boolean;    // Whether execution timed out
  cost?: number;        // Execution cost (USD)
  budgetRemaining?: number; // Budget remaining
}
```

## Redis Data Structure

```
Key Pattern: budget:{run_id}
Value: "10.0" (float as string)
TTL: 7 days

Key Pattern: spent:{run_id}
Value: "0.05" (float as string)
TTL: 7 days

Key Pattern: exceeded:{run_id}
Value: "0" or "1" (boolean as string)
TTL: 7 days
```

## Security Boundaries

```
┌─────────────────────────────────────────────────┐
│              Security Boundary 1                 │
│         API Request Validation                   │
│                                                  │
│  - Authentication                                │
│  - Input validation                              │
│  - Rate limiting                                 │
└─────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│              Security Boundary 2                 │
│          Policy Enforcement                      │
│                                                  │
│  - Action type check                             │
│  - Destructive pattern detection                 │
│  - Network allowlist                             │
│  - Approval requirements                         │
└─────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│              Security Boundary 3                 │
│           Budget Enforcement                     │
│                                                  │
│  - Pre-execution check                           │
│  - Atomic spend tracking                         │
│  - Circuit breaker                               │
└─────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│              Security Boundary 4                 │
│          Sandbox Isolation                       │
│                                                  │
│  - E2B containerized environment                 │
│  - Network isolation                             │
│  - File system isolation                         │
│  - Resource limits                               │
└─────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│              Security Boundary 5                 │
│           Output Sanitization                    │
│                                                  │
│  - Secret redaction                              │
│  - Log sanitization                              │
│  - Error message filtering                       │
└─────────────────────────────────────────────────┘
```

## Error Handling Strategy

```
┌──────────────────────────────────────┐
│        Error Categories              │
├──────────────────────────────────────┤
│                                      │
│  1. Policy Violations                │
│     - Block immediately              │
│     - Log for audit                  │
│     - Return clear error             │
│                                      │
│  2. Budget Exceeded                  │
│     - Stop workflow                  │
│     - Alert stakeholders             │
│     - Preserve state                 │
│                                      │
│  3. Sandbox Failures                 │
│     - Retry with backoff             │
│     - Cleanup resources              │
│     - Fallback to manual             │
│                                      │
│  4. Network Errors                   │
│     - Retry with exponential backoff │
│     - Circuit breaker pattern        │
│     - Graceful degradation           │
│                                      │
└──────────────────────────────────────┘
```

## Monitoring & Observability

```
┌─────────────────────────────────────────────────┐
│                  Metrics                         │
├─────────────────────────────────────────────────┤
│                                                  │
│  - policy_checks_total                           │
│  - policy_violations_total                       │
│  - budget_exceeded_total                         │
│  - sandbox_executions_total                      │
│  - sandbox_execution_duration_seconds            │
│  - budget_spent_dollars                          │
│  - budget_remaining_dollars                      │
│  - secrets_redacted_total                        │
│                                                  │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│                   Logs                           │
├─────────────────────────────────────────────────┤
│                                                  │
│  - Policy check results                          │
│  - Budget transactions                           │
│  - Sandbox lifecycle events                      │
│  - Command executions (redacted)                 │
│  - Error stack traces (redacted)                 │
│                                                  │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│                  Traces                          │
├─────────────────────────────────────────────────┤
│                                                  │
│  - End-to-end request flow                       │
│  - Temporal workflow execution                   │
│  - Activity execution spans                      │
│  - External API calls                            │
│                                                  │
└─────────────────────────────────────────────────┘
```

## Deployment Architecture

```
Production Environment
    │
    ├──> Load Balancer
    │         │
    │         ├──> FastAPI Pod 1
    │         ├──> FastAPI Pod 2
    │         └──> FastAPI Pod 3
    │
    ├──> Redis Cluster (Master + Replicas)
    │         │
    │         ├──> Master (writes)
    │         ├──> Replica 1 (reads)
    │         └──> Replica 2 (reads)
    │
    ├──> Temporal Cluster
    │         │
    │         ├──> Worker Pool 1
    │         ├──> Worker Pool 2
    │         └──> Worker Pool 3
    │
    └──> E2B Cloud
              │
              ├──> Sandbox Instance 1
              ├──> Sandbox Instance 2
              └──> Sandbox Instance N
```

## Scaling Considerations

- **PolicyGate**: Stateless, can scale horizontally
- **BudgetTracker**: Scales with Redis cluster
- **E2B Sandboxes**: Auto-scaling based on demand
- **Temporal Workers**: Horizontal pod autoscaling
- **Redis**: Cluster mode for high availability

## Future Enhancements

1. Machine learning for anomaly detection
2. Automated policy tuning based on usage
3. Budget forecasting and recommendations
4. Advanced secret detection with ML
5. Policy versioning and A/B testing
6. Distributed tracing integration
7. Real-time dashboard with WebSockets
