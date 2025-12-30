# Autonomous Enterprise Architecture

## System Overview

Autonomous Enterprise is a comprehensive infrastructure (a "Harness") for accepting abstract economic intent and autonomously navigating the entire product lifecycle: ideation, market validation, development, deployment, and monetization.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER INTERFACE                                │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐        │
│  │   REST API     │  │   CLI Tools    │  │   Webhooks     │        │
│  └───────┬────────┘  └───────┬────────┘  └───────┬────────┘        │
│          └───────────────────┼───────────────────┘                  │
│                              │                                       │
│  ┌───────────────────────────▼───────────────────────────────────┐  │
│  │                    CONTROL PLANE (FastAPI)                      │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │  │
│  │  │ Genesis  │ │ Economy  │ │  Safety  │ │ Billing  │          │  │
│  │  │ Module   │ │ Module   │ │ Module   │ │ Module   │          │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │  │
│  └───────────────────────────┬───────────────────────────────────┘  │
│                              │                                       │
│  ┌───────────────────────────▼───────────────────────────────────┐  │
│  │                    ORCHESTRATION LAYER                          │  │
│  │  ┌──────────────────────┐  ┌──────────────────────┐           │  │
│  │  │     Temporal.io      │  │     LangGraph        │           │  │
│  │  │  (Durable Workflows) │  │  (Cognitive Engine)  │           │  │
│  │  └──────────────────────┘  └──────────────────────┘           │  │
│  └───────────────────────────┬───────────────────────────────────┘  │
│                              │                                       │
│  ┌───────────────────────────▼───────────────────────────────────┐  │
│  │                     EXECUTION LAYER                             │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │  │
│  │  │ Claude   │  │ Gemini   │  │  Codex   │  │   E2B    │       │  │
│  │  │ Harness  │  │ Harness  │  │ Harness  │  │ Sandbox  │       │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │  │
│  └───────────────────────────┬───────────────────────────────────┘  │
│                              │                                       │
│  ┌───────────────────────────▼───────────────────────────────────┐  │
│  │                   MONETIZATION LAYER                            │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐                     │  │
│  │  │  Stripe  │  │  Vercel  │  │  Domain  │                     │  │
│  │  │Payments  │  │  Deploy  │  │ Registry │                     │  │
│  │  └──────────┘  └──────────┘  └──────────┘                     │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Core Modules

### 1. Genesis Module (Market Intelligence)

**Location**: `apps/api/ae_api/genesis/`

**Purpose**: Market research, niche identification, and validation.

**Components**:

```
genesis/
├── niche_engine.py       # Niche identification
├── validator.py          # SEO/keyword validation
├── meta_pm.py            # MetaGPT-style roles
├── trend_analyzer.py     # Trend analysis
└── rag/
    ├── reddit_fetcher.py
    ├── hackernews_fetcher.py
    └── google_trends.py
```

**Flow**:
```
Economic Intent ("Build $500 MRR data tool")
    |
    v
+-------------------+
| Niche Engine      |
| - RAG trends      |
| - Market gaps     |
| - Opportunity ID  |
+-------------------+
    |
    v
+-------------------+
| Validator         |
| - SEO analysis    |
| - Keyword volume  |
| - Competition     |
+-------------------+
    |
    v
+-------------------+
| Meta-PM Roles     |
| - Product Manager |
| - Architect       |
| - Project Manager |
+-------------------+
    |
    v
Validated Niche with Spec
```

### 2. Economy Module (Model Router)

**Location**: `apps/api/ae_api/economy/`

**Purpose**: Intelligent model selection and cost optimization.

**Tier System**:

| Tier | Model | Use Case | Trigger |
|------|-------|----------|---------|
| 1 (Architect) | Claude Opus 4.5 | Architecture, debugging, security | Complexity > 8 |
| 2 (Builder) | GPT-5.2 | Implementation, tests, docs | Standard tasks |
| 3 (Intern) | Gemini 3 Pro | Formatting, linting, fast ops | Simple tasks |

**Router Logic**:
```python
class ModelRouter:
    def route(self, task: Task) -> Model:
        complexity = self.analyze_complexity(task)

        if complexity >= 8 or task.requires_security:
            return Model.CLAUDE_OPUS
        elif complexity >= 4:
            return Model.GPT_5
        else:
            return Model.GEMINI_PRO
```

### 3. Safety Module

**Location**: `apps/api/ae_api/safety/`

**Purpose**: Policy enforcement, budget control, and security.

**Components**:
```
safety/
├── policies.py         # Policy definitions
├── gates.py            # Policy gate enforcement
├── budget.py           # Budget tracking
├── redaction.py        # Secret redaction
└── audit.py            # Audit logging
```

**Policy Gates**:

| Action | Gate | Approval |
|--------|------|----------|
| Code execution | SANDBOX_REQUIRED | Auto if E2B |
| Deployment | DEPLOY_APPROVAL | Human review |
| Billing ops | BILLING_APPROVAL | Human review |
| Secret access | SECRET_ACCESS | Audit logged |

### 4. Orchestration Module

**Location**: `apps/api/ae_api/orchestration/`

**Purpose**: Workflow management and Temporal.io integration.

**Workflows**:
```
workflows/
├── genesis_workflow.ts      # Market intelligence
├── build_ship_workflow.ts   # Development + deployment
└── monetize_workflow.ts     # Payment setup
```

---

## Temporal.io Integration

### Workflow Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TEMPORAL SERVER                           │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │ Workflow Engine │  │  Task Queues    │                   │
│  └────────┬────────┘  └────────┬────────┘                   │
│           │                    │                             │
│           └────────┬───────────┘                             │
│                    │                                         │
└────────────────────┼─────────────────────────────────────────┘
                     │
     ┌───────────────┼───────────────┐
     │               │               │
     v               v               v
┌─────────┐   ┌─────────┐   ┌─────────┐
│ Genesis │   │  Build  │   │Monetize │
│ Workflow│   │ Workflow│   │Workflow │
└─────────┘   └─────────┘   └─────────┘
```

### Workflow Definition

```typescript
// workflows/genesis.ts
export async function genesisWorkflow(intent: string): Promise<Product> {
  // Step 1: Niche identification
  const niches = await activities.identifyNiches(intent);

  // Step 2: Validate niches
  const validatedNiches = await activities.validateNiches(niches);

  // Step 3: Generate specification
  const spec = await activities.generateSpec(validatedNiches[0]);

  // Step 4: Human approval
  await workflow.waitForSignal('approveSpec');

  return spec;
}
```

### Activity Definitions

```typescript
// activities/genesis.ts
export async function identifyNiches(intent: string): Promise<Niche[]> {
  // RAG-based niche identification
  const trends = await fetchTrends();
  const analysis = await analyzeMarketGaps(intent, trends);
  return rankNiches(analysis);
}
```

---

## LangGraph Cognitive Engine

### Write-Test-Fix Cycle

```
                    ┌──────────────────┐
                    │   Task Input     │
                    └────────┬─────────┘
                             │
                             v
              ┌──────────────────────────┐
              │       WRITE NODE         │
              │  (Generate code/content) │
              └──────────────┬───────────┘
                             │
                             v
              ┌──────────────────────────┐
              │       TEST NODE          │
              │  (Run tests/validation)  │
              └──────────────┬───────────┘
                             │
                    ┌────────┴────────┐
                    │                 │
                    v                 v
               [PASS]            [FAIL]
                    │                 │
                    v                 v
              ┌──────────┐   ┌──────────────┐
              │  OUTPUT  │   │  FIX NODE    │
              └──────────┘   │ (Error loop) │
                             └───────┬──────┘
                                     │
                                     └──────────> (back to WRITE)
```

### Graph Definition

```typescript
// langgraph/wtf_graph.ts
const wtfGraph = new StateGraph<WTFState>()
  .addNode("write", writeNode)
  .addNode("test", testNode)
  .addNode("fix", fixNode)
  .addEdge("write", "test")
  .addConditionalEdges("test", {
    pass: END,
    fail: "fix"
  })
  .addEdge("fix", "write")
  .compile();
```

---

## CLI Agent Harness

### Unified Interface

```typescript
// temporal/activities/cli/harness.ts
interface CLIHarness {
  execute(prompt: string, options: ExecuteOptions): Promise<ExecuteResult>;
}

class UnifiedCLIHarness implements CLIHarness {
  private providers: Map<string, CLIProvider> = new Map([
    ['claude', new ClaudeProvider()],
    ['gemini', new GeminiProvider()],
    ['codex', new CodexProvider()]
  ]);

  async execute(prompt: string, options: ExecuteOptions): Promise<ExecuteResult> {
    const provider = this.selectProvider(options);
    return provider.execute(prompt, options);
  }
}
```

### Provider Implementations

```typescript
// Claude Provider
class ClaudeProvider implements CLIProvider {
  async execute(prompt: string, options: ExecuteOptions): Promise<ExecuteResult> {
    const args = ['-p', prompt, '--output-format', 'stream-json'];
    return this.spawn('claude', args);
  }
}

// Gemini Provider
class GeminiProvider implements CLIProvider {
  async execute(prompt: string, options: ExecuteOptions): Promise<ExecuteResult> {
    const args = ['-m', options.model || 'gemini-3-pro', '-o', 'stream-json', '-y', prompt];
    return this.spawn('gemini', args);
  }
}

// Codex Provider
class CodexProvider implements CLIProvider {
  async execute(prompt: string, options: ExecuteOptions): Promise<ExecuteResult> {
    const args = ['exec', '-m', options.model || 'gpt-5.2', '-c', 'approval-policy', 'never', prompt];
    return this.spawn('codex', args);
  }
}
```

---

## Living Spec Protocol

### Template Structure

```markdown
# specs/protocol/CLAUDE.template.md

# Project: {{PROJECT_NAME}}

## Directive
You are building {{PRODUCT_DESCRIPTION}}.

## Mission Log
{{MISSION_LOG}}

## Error Registry
{{ERROR_REGISTRY}}

## Current Phase
{{CURRENT_PHASE}}

## Guidelines
1. Follow the specification exactly
2. Log all decisions
3. Handle errors gracefully
4. Document as you go
```

### Spec Generation

```python
def generate_living_spec(project: Project) -> str:
    template = load_template('CLAUDE.template.md')

    return template.format(
        PROJECT_NAME=project.name,
        PRODUCT_DESCRIPTION=project.description,
        MISSION_LOG=project.mission_log,
        ERROR_REGISTRY=project.error_registry,
        CURRENT_PHASE=project.current_phase
    )
```

---

## Data Flow

### Complete Product Pipeline

```
1. User Intent
   POST /api/v1/genesis/start
   {"intent": "Build $500 MRR CSV tool", "budget": 10.0}
        |
        v
2. Genesis Workflow
   - Niche identification (RAG)
   - Validation (SEO/keywords)
   - Spec generation (Meta-PM)
        |
        v
3. Human Approval
   Signal: approveSpec
        |
        v
4. Build Workflow
   - Write-Test-Fix loop (LangGraph)
   - CLI agent execution
   - Living spec updates
        |
        v
5. Deploy Workflow
   - Vercel deployment
   - Domain setup
   - SSL configuration
        |
        v
6. Monetize Workflow
   - Stripe product creation
   - Pricing tiers
   - Payment links
        |
        v
7. Complete
   {"product_url": "...", "payment_link": "..."}
```

---

## Database Schema

### PostgreSQL Tables

```sql
-- Projects
CREATE TABLE projects (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    intent TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'created',
    budget DECIMAL(10,2) DEFAULT 10.00,
    spent DECIMAL(10,2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP
);

-- Niches
CREATE TABLE niches (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    name VARCHAR(255),
    score DECIMAL(5,2),
    seo_data JSONB,
    validated BOOLEAN DEFAULT FALSE
);

-- Runs
CREATE TABLE runs (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    workflow_id VARCHAR(255),
    status VARCHAR(50),
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    output JSONB
);

-- Cost Tracking
CREATE TABLE costs (
    id UUID PRIMARY KEY,
    run_id UUID REFERENCES runs(id),
    model VARCHAR(100),
    tokens_in INTEGER,
    tokens_out INTEGER,
    cost DECIMAL(10,6)
);
```

---

## API Reference

### Endpoints

```
POST   /api/v1/genesis/start          # Start genesis workflow
GET    /api/v1/genesis/niches/{id}    # Get niche candidates
POST   /api/v1/genesis/validate/{id}  # Validate niche
POST   /api/v1/genesis/approve/{id}   # Approve and proceed

GET    /api/v1/runs                   # List runs
GET    /api/v1/runs/{id}              # Get run status
DELETE /api/v1/runs/{id}              # Cancel run

GET    /api/v1/specs/{id}             # Get living spec
GET    /api/v1/specs/{id}/claude.md   # Get CLAUDE.md

POST   /api/v1/model-router/route     # Route to model tier
POST   /api/v1/safety/check           # Policy check

POST   /api/v1/billing/products       # Create Stripe product
POST   /api/v1/billing/payment-links  # Create payment link

POST   /api/v1/deploy/vercel          # Deploy to Vercel
```

---

## Deployment Architecture

### Infrastructure

```
┌─────────────────────────────────────────────────────────────┐
│                     PRODUCTION                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  API Server │  │   Temporal  │  │  Postgres   │         │
│  │  (FastAPI)  │  │   Server    │  │  Database   │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         │                │                │                  │
│         └────────────────┴────────────────┘                  │
│                          │                                   │
│  ┌───────────────────────▼───────────────────────────────┐  │
│  │                    Redis                               │  │
│  │              (Caching + Queues)                        │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                 Temporal Workers                       │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐               │  │
│  │  │Worker 1 │  │Worker 2 │  │Worker 3 │               │  │
│  │  └─────────┘  └─────────┘  └─────────┘               │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Docker Compose

```yaml
version: '3.8'
services:
  api:
    build: ./apps/api
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql+asyncpg://ae:ae@postgres:5432/ae
      - REDIS_HOST=redis

  temporal:
    image: temporalio/auto-setup:latest
    ports:
      - "7233:7233"

  temporal-worker:
    build: ./workers/temporal-worker
    depends_on:
      - temporal

  postgres:
    image: postgres:15
    environment:
      - POSTGRES_USER=ae
      - POSTGRES_PASSWORD=ae
      - POSTGRES_DB=ae

  redis:
    image: redis:7-alpine
```

---

*Last Updated: December 2024*
