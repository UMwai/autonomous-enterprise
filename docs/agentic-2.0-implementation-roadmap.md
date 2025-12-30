# Agentic Engineering 2.0 Implementation Roadmap

> Small code footprint + Heavy tool calling = Outsized impact

This document synthesizes the 4 parallel design tracks into a cohesive implementation plan for evolving from "God tool" patterns to composable, observable, and controllable agentic systems.

## Executive Summary

| Track | Status | Key Deliverables |
|-------|--------|-----------------|
| 1. Atomic Tools Layer | Designed | Types, Registry, Executor, Migration Strategy |
| 2. HITL Approval Gateway | Designed | ApprovalQueue, API Endpoints, ApprovalClient |
| 3. PR Autopilot (PoC) | **Implemented** | Coordinator-Worker pattern, Handoff protocol |
| 4. MCP Integration | **Implemented** | Server configs, Types, Architecture docs |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     ORCHESTRATION LAYER                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Temporal   │  │  Coordinator │  │    Router    │          │
│  │   Workflow   │──│    Agent     │──│   (Handoff)  │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                      SAFETY LAYER                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │    Policy    │  │    Budget    │  │   Approval   │          │
│  │    Client    │──│   Tracker    │──│    Queue     │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                      EXECUTION LAYER                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Atomic     │  │     MCP      │  │    CLI       │          │
│  │   Tools      │──│   Servers    │──│   Harness    │          │
│  │  (Registry)  │  │  (Dynamic)   │  │  (Fallback)  │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Phases

### Phase 1: Foundation (Weeks 1-2)
> Focus: Core safety infrastructure and atomic tools

#### 1.1 HITL Approval Gateway
**Priority: CRITICAL** - Blocks deployment workflows

Files to create:
```
apps/api/ae_api/safety/approvals.py     # ApprovalQueue with Redis
apps/api/ae_api/api/v1/endpoints/approvals.py  # REST API
workers/temporal-worker/src/safety/approvalClient.ts  # TS client
```

Key interfaces:
```typescript
// ApprovalStatus lifecycle
PENDING → APPROVED | REJECTED | EXPIRED | CANCELLED

// Integration point
await policyClient.checkAndApprove(
  ActionType.DEPLOY,
  context,
  workflowId,
  runId
);
```

#### 1.2 Atomic Tools Core
**Priority: HIGH** - Foundation for all tool execution

Files to create:
```
workers/temporal-worker/src/tools/types.ts      # AtomicTool, ToolContext, ToolResult
workers/temporal-worker/src/tools/registry.ts   # DefaultToolRegistry
workers/temporal-worker/src/tools/executor.ts   # ToolExecutor with policy/budget
```

Core primitives:
| Tool | Category | Risk Level |
|------|----------|------------|
| `read_file` | READ | SAFE |
| `grep` | SEARCH | SAFE |
| `apply_patch` | EDIT | LOW |
| `write_file` | WRITE | LOW |
| `run_command` | SHELL | MEDIUM |
| `deploy` | DEPLOY | CRITICAL |

### Phase 2: Integration (Weeks 3-4)
> Focus: Connect new tools with existing harness

#### 2.1 Harness Mode Selection
Update `harness.ts` with `ExecutionMode` enum:

```typescript
enum ExecutionMode {
  FULL_CLI = 'full_cli',      // Current "God tool" - fallback
  ATOMIC_TOOLS = 'atomic_tools',  // Explicit tool plan
  AGENT_TOOLS = 'agent_tools',    // Agent chooses dynamically
}
```

Migration strategy:
1. **Dual mode** - Run both, compare results
2. **Gradual rollout** - Genesis → ATOMIC, complex → FULL_CLI
3. **Full migration** - ATOMIC default, FULL_CLI fallback

#### 2.2 MCP Server Integration
Leverage existing MCP configs in `src/mcp/`:

```typescript
// Already implemented
import { MCP_SERVERS } from './mcp/servers.config.js';

// GitHub, Stripe, Vercel servers configured
// Per-tool permissions defined
// Budget limits set
```

### Phase 3: Coordinator-Worker Pattern (Weeks 5-6)
> Focus: Multi-agent orchestration with handoffs

#### 3.1 PR Autopilot Validation
Already implemented in `src/agents/prAutopilot/`:

| Agent | Role | Tools |
|-------|------|-------|
| Coordinator | Routes work | None (handoffs only) |
| Security | CVE scanning | `check_cve_database` |
| GitHub | PR operations | `get_pr_diff`, `post_comment` |
| Style | Code quality | `run_linter`, `check_formatting` |

Handoff protocol:
```json
{
  "action": "handoff",
  "target": "security",
  "reason": "Found import of crypto library",
  "context": { "file": "src/auth.ts" }
}
```

#### 3.2 Additional Specialist Agents
Extend pattern to:
- **Test Agent** - Run tests, analyze failures
- **Deploy Agent** - Handle deployments (with HITL)
- **Billing Agent** - Stripe operations (with HITL)

## Files Created by Design Agents

### PR Autopilot (Implemented)
```
workers/temporal-worker/src/agents/prAutopilot/
├── definitions.ts      # Agent configs, handoff targets
├── protocol.ts         # HandoffSignal, Finding types
├── tools.ts            # get_pr_diff, check_cve_database
├── types.d.ts          # Type declarations
└── __tests__/
    └── workflow.test.ts

workers/temporal-worker/src/temporal/activities/prAutopilot/
└── index.ts            # runPRAgent activity
```

### MCP Integration (Implemented)
```
workers/temporal-worker/src/mcp/
├── types.ts            # MCPServerConfig, ToolPermission
└── servers.config.ts   # GitHub, Stripe, Vercel configs

docs/
├── mcp-integration-design.md
├── mcp-architecture-diagram.md
└── mcp-migration-checklist.md
```

### Atomic Tools (Designed, not written)
```
workers/temporal-worker/src/tools/
├── types.ts            # AtomicTool, ToolCategory, RiskLevel
├── registry.ts         # DefaultToolRegistry
├── executor.ts         # ToolExecutor
├── read.ts             # ReadFileTool
├── grep.ts             # GrepTool
├── edit.ts             # ApplyPatchTool
└── bash.ts             # RunCommandTool
```

### HITL Approval (Designed, not written)
```
apps/api/ae_api/safety/
└── approvals.py        # ApprovalQueue, ApprovalRequest

apps/api/ae_api/api/v1/endpoints/
└── approvals.py        # REST API endpoints

workers/temporal-worker/src/safety/
└── approvalClient.ts   # TypeScript client
```

## Key Design Decisions

### 1. Tool-Level Observability
Every tool call produces structured `ToolResult`:
```typescript
interface ToolResult<T> {
  success: boolean;
  data?: T;
  output: string;
  errors: ToolError[];
  cost?: number;
  duration: number;
  sideEffects?: SideEffect[];  // For rollback
}
```

### 2. Policy Enforcement Points
Risk-based enforcement at tool level:
```typescript
// SAFE/LOW: Auto-approve
// MEDIUM: Log + budget check
// HIGH: Policy check required
// CRITICAL: HITL approval required
```

### 3. Backward Compatibility
Full CLI mode remains available:
- Default for complex multi-step tasks
- Fallback when atomic tools fail
- Gradually phase out over 3 phases

### 4. Budget Tracking Granularity
Per-tool cost estimation and tracking:
```typescript
// Before execution
const cost = await tool.estimateCost(input);
const canSpend = await budgetClient.canSpend(runId, cost);

// After execution
await budgetClient.spend(runId, result.cost);
```

## Success Metrics

| Metric | Current | Target | How to Measure |
|--------|---------|--------|----------------|
| Tool Observability | 10% | 100% | Structured logs per tool call |
| Policy Enforcement | Throws | Waits | HITL approvals for CRITICAL ops |
| Cost Attribution | Run-level | Tool-level | Per-tool cost in ToolResult |
| Rollback Support | None | File ops | SideEffect tracking |
| Agent Specialization | 1 (God) | 4+ | Coordinator + specialists |

## Migration Checklist

- [ ] Create `src/tools/types.ts` with core interfaces
- [ ] Implement `ReadFileTool`, `GrepTool`, `ApplyPatchTool`
- [ ] Create `ToolRegistry` and `ToolExecutor`
- [ ] Create `apps/api/ae_api/safety/approvals.py`
- [ ] Add approval API endpoints
- [ ] Create `approvalClient.ts` in worker
- [ ] Update `policyClient.ts` with `checkAndApprove()`
- [ ] Add `ExecutionMode` to harness
- [ ] Implement dual-mode execution for validation
- [ ] Test PR Autopilot workflow end-to-end
- [ ] Connect MCP servers to tool registry
- [ ] Create additional specialist agents

## Next Steps

1. **Immediate**: Implement HITL Approval Gateway (blocks production deployments)
2. **This Week**: Write atomic tools core (types, registry, executor)
3. **Next Week**: Test PR Autopilot with real PR
4. **Following**: Connect MCP servers, add specialists

## References

- Atomic Tools Design: Agent output `acf41b6`
- HITL Approval Design: Agent output `af5e457`
- PR Autopilot: `src/agents/prAutopilot/`
- MCP Integration: `src/mcp/` and `docs/mcp-*.md`
