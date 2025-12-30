# Autonomous Enterprise Agent Design

## Agent Architecture Overview

Autonomous Enterprise implements a sophisticated multi-agent system with role-based specialization following the MetaGPT pattern, combined with intelligent model routing and safety-constrained execution.

---

## Agent Hierarchy

```
                    +---------------------------+
                    |   Orchestration Layer     |
                    |   (Temporal + LangGraph)  |
                    +-------------+-------------+
                                  |
            +---------------------+---------------------+
            |                     |                     |
            v                     v                     v
    +---------------+     +---------------+     +---------------+
    |   Meta-PM     |     |   Execution   |     |   Safety      |
    |   Roles       |     |   Agents      |     |   Agents      |
    +---------------+     +---------------+     +---------------+
    | Product Mgr   |     | Claude Agent  |     | Policy Gate   |
    | Architect     |     | Gemini Agent  |     | Budget Guard  |
    | Project Mgr   |     | Codex Agent   |     | Audit Logger  |
    +---------------+     +---------------+     +---------------+
```

---

## Meta-PM Architecture (MetaGPT Pattern)

### Role Definitions

#### 1. Product Manager Role

**Purpose**: Translate intent into product requirements

**System Prompt**:
```
You are a senior product manager. Your role is to:
1. Analyze market intent and identify customer needs
2. Define product requirements and success metrics
3. Prioritize features for MVP
4. Create user stories and acceptance criteria

Output a structured PRD (Product Requirements Document).
```

**Responsibilities**:
- Market analysis interpretation
- Requirement specification
- Feature prioritization
- Success metric definition

#### 2. Architect Role

**Purpose**: Design technical architecture and system design

**System Prompt**:
```
You are a senior software architect. Your role is to:
1. Design system architecture based on requirements
2. Select appropriate technologies
3. Define data models and APIs
4. Create technical specifications

Output a structured Architecture Design Document.
```

**Responsibilities**:
- Technology selection
- System design
- API specification
- Database schema design

#### 3. Project Manager Role

**Purpose**: Plan implementation and track progress

**System Prompt**:
```
You are a senior project manager. Your role is to:
1. Break down the project into milestones
2. Create task dependencies
3. Estimate effort and timeline
4. Track progress and risks

Output a structured Project Plan.
```

**Responsibilities**:
- Task decomposition
- Timeline estimation
- Risk identification
- Progress tracking

---

## Model Router Agents

### Tier 1: Architect Agent (Claude Opus 4.5)

**Role**: Complex reasoning, architecture, security

**Trigger Conditions**:
- Complexity score >= 8
- Security-related tasks
- Architecture decisions
- Debug complex issues

**System Prompt**:
```
You are an expert architect agent using Claude Opus 4.5.
Focus on:
- Deep architectural analysis
- Security considerations
- Complex problem decomposition
- Quality and maintainability
```

**Cost**: $15 / $75 per 1M tokens (input/output)

### Tier 2: Builder Agent (GPT-5.2)

**Role**: Implementation, tests, documentation

**Trigger Conditions**:
- Standard development tasks
- Test writing
- Documentation
- Feature implementation

**System Prompt**:
```
You are a senior developer agent using GPT-5.2.
Focus on:
- Clean code implementation
- Comprehensive testing
- Clear documentation
- Best practices
```

**Cost**: $15 / $60 per 1M tokens (input/output)

### Tier 3: Intern Agent (Gemini 3 Pro)

**Role**: Fast operations, formatting, linting

**Trigger Conditions**:
- Simple tasks
- Code formatting
- Linting fixes
- Quick lookups

**System Prompt**:
```
You are an efficient assistant agent using Gemini 3 Pro.
Focus on:
- Quick task completion
- Formatting and linting
- Simple transformations
- Fast responses
```

**Cost**: $10 / $40 per 1M tokens (input/output)

---

## Execution Agents (CLI Harness)

### Claude Code Agent

**CLI**: `claude`

**Capabilities**:
- Full filesystem access
- Code generation
- Deep reasoning
- Multi-step tasks

**Integration**:
```typescript
class ClaudeAgent {
  private cmd = 'claude';
  private args = ['-p', '--output-format', 'stream-json'];

  async execute(prompt: string, spec: LivingSpec): Promise<Result> {
    // Inject living spec context
    const fullPrompt = this.buildPrompt(prompt, spec);

    // Execute with streaming
    return this.spawn(this.cmd, [...this.args, fullPrompt]);
  }
}
```

### Gemini CLI Agent

**CLI**: `gemini`

**Capabilities**:
- 1M token context
- Research and exploration
- Fast iteration
- Web access

**Integration**:
```typescript
class GeminiAgent {
  private cmd = 'gemini';
  private args = ['-m', 'gemini-3-pro', '-y', '-o', 'stream-json'];

  async execute(prompt: string): Promise<Result> {
    return this.spawn(this.cmd, [...this.args, prompt]);
  }
}
```

### Codex CLI Agent

**CLI**: `codex`

**Capabilities**:
- Code generation
- Sandboxed execution
- Planning
- Implementation

**Integration**:
```typescript
class CodexAgent {
  private cmd = 'codex';
  private args = ['exec', '-m', 'gpt-5.2', '-c', 'approval-policy', 'never'];

  async execute(prompt: string): Promise<Result> {
    return this.spawn(this.cmd, [...this.args, prompt]);
  }
}
```

---

## Safety Agents

### Policy Gate Agent

**Purpose**: Enforce action policies before execution

**Policy Matrix**:

| Action | Policy | Gate Type |
|--------|--------|-----------|
| File Read | ALLOW | Auto |
| File Write | ALLOW | Auto |
| Code Execution | SANDBOX_REQUIRED | Auto if E2B |
| External API | RATE_LIMITED | Auto |
| Deployment | DEPLOY_APPROVAL | Human |
| Billing | BILLING_APPROVAL | Human |
| Secret Access | AUDIT_REQUIRED | Auto + Audit |

**Implementation**:
```python
class PolicyGateAgent:
    async def check(self, action: Action) -> PolicyResult:
        policy = self.get_policy(action.type)

        if policy.gate_type == GateType.HUMAN:
            return await self.request_human_approval(action)

        if policy.gate_type == GateType.SANDBOX:
            return self.require_sandbox(action)

        if policy.requires_audit:
            await self.audit_logger.log(action)

        return PolicyResult.ALLOW
```

### Budget Guard Agent

**Purpose**: Track and enforce budget limits

**Budget Tiers**:

| Level | Default | Max |
|-------|---------|-----|
| Per-Task | $1 | $5 |
| Per-Run | $10 | $100 |
| Per-Project | $100 | $1000 |

**Implementation**:
```python
class BudgetGuardAgent:
    async def check_budget(self, cost: Decimal, run_id: str) -> bool:
        run = await self.get_run(run_id)

        if run.spent + cost > run.budget:
            raise BudgetExhaustedError(f"Budget ${run.budget} exhausted")

        await self.record_cost(run_id, cost)
        return True

    async def estimate_cost(self, model: str, tokens: int) -> Decimal:
        rates = MODEL_RATES[model]
        return (tokens / 1_000_000) * rates['output']
```

### Audit Logger Agent

**Purpose**: Complete action audit trail

**Logged Events**:
- All model invocations
- File operations
- External API calls
- Deployment actions
- Billing operations

**Implementation**:
```python
class AuditLoggerAgent:
    async def log(self, event: AuditEvent):
        record = {
            'timestamp': datetime.utcnow(),
            'run_id': event.run_id,
            'action': event.action,
            'actor': event.actor,
            'details': self.redact_secrets(event.details),
            'result': event.result
        }
        await self.store.append(record)
```

---

## Agent Communication Protocol

### Message Format

```typescript
interface AgentMessage {
  id: string;
  from: AgentId;
  to: AgentId;
  type: MessageType;
  payload: Record<string, any>;
  timestamp: Date;
  runId: string;
}

enum MessageType {
  TASK_ASSIGN = 'task_assign',
  TASK_COMPLETE = 'task_complete',
  TASK_FAILED = 'task_failed',
  CONTEXT_UPDATE = 'context_update',
  APPROVAL_REQUEST = 'approval_request',
  APPROVAL_RESPONSE = 'approval_response'
}
```

### Communication Flow

```
Orchestrator                      Execution Agent
     |                                  |
     |-- TASK_ASSIGN ------------------>|
     |                                  |
     |<-- CONTEXT_UPDATE ---------------|
     |                                  |
     |<-- TASK_COMPLETE ----------------|
     |                                  |

Execution Agent                   Safety Agent
     |                                  |
     |-- APPROVAL_REQUEST ------------->|
     |                                  |
     |<-- APPROVAL_RESPONSE ------------|
     |                                  |
```

---

## Living Spec Protocol

### Spec Structure

```typescript
interface LivingSpec {
  projectName: string;
  directive: string;
  missionLog: MissionEntry[];
  errorRegistry: ErrorEntry[];
  currentPhase: Phase;
  artifacts: Artifact[];
}

interface MissionEntry {
  timestamp: Date;
  action: string;
  result: string;
  agent: AgentId;
}

interface ErrorEntry {
  timestamp: Date;
  error: string;
  resolution: string;
  status: 'open' | 'resolved';
}
```

### Spec Evolution

```
Initial Spec (Genesis)
    |
    v
+-------------------+
| Meta-PM Roles     |
| - Add requirements|
| - Add architecture|
| - Add plan        |
+-------------------+
    |
    v
Execution Phase
    |
    v
+-------------------+
| Execution Agents  |
| - Log actions     |
| - Record errors   |
| - Update progress |
+-------------------+
    |
    v
Final Spec (Complete)
```

---

## Error Handling

### Error Categories

| Category | Examples | Recovery |
|----------|----------|----------|
| Transient | Rate limit, timeout | Retry with backoff |
| Recoverable | Test failure, lint error | Write-Test-Fix loop |
| Fatal | Budget exhausted, auth failure | Halt and notify |

### Write-Test-Fix Loop

```
Task
  |
  v
+--------+
| WRITE  |---> Generate code/content
+--------+
  |
  v
+--------+
| TEST   |---> Run tests/validation
+--------+
  |
  +----> [PASS] --> Complete
  |
  +----> [FAIL]
           |
           v
      +--------+
      |  FIX   |---> Analyze error, generate fix
      +--------+
           |
           v
      (back to WRITE, max 3 iterations)
```

### Error Analysis Agent

```python
class ErrorAnalysisAgent:
    async def analyze(self, error: ExecutionError) -> FixStrategy:
        # Use Tier 1 agent for complex errors
        analysis = await self.architect_agent.analyze(
            error.message,
            error.context,
            error.stack_trace
        )

        return FixStrategy(
            diagnosis=analysis.diagnosis,
            fix_approach=analysis.fix_approach,
            code_changes=analysis.suggested_changes
        )
```

---

## Metrics & Observability

### Agent Metrics

```typescript
interface AgentMetrics {
  invocations: number;
  successRate: number;
  avgDuration: number;
  tokenUsage: TokenUsage;
  costTotal: Decimal;
  errorsByType: Record<string, number>;
}
```

### Telemetry Events

```python
class AgentTelemetry:
    def emit_start(self, agent_id: str, task_id: str):
        self.emit('agent.task.start', {
            'agent_id': agent_id,
            'task_id': task_id,
            'timestamp': datetime.utcnow()
        })

    def emit_complete(self, agent_id: str, task_id: str, duration: float):
        self.emit('agent.task.complete', {
            'agent_id': agent_id,
            'task_id': task_id,
            'duration_ms': duration * 1000,
            'timestamp': datetime.utcnow()
        })

    def emit_error(self, agent_id: str, task_id: str, error: str):
        self.emit('agent.task.error', {
            'agent_id': agent_id,
            'task_id': task_id,
            'error': error,
            'timestamp': datetime.utcnow()
        })
```

---

*Last Updated: December 2024*
