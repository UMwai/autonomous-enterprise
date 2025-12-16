# Autonomous Enterprise

> Self-Monetizing AI Agent Swarm - A comprehensive infrastructure for autonomous software development and monetization.

## Overview

Autonomous Enterprise is a "Harness" - a comprehensive, automated infrastructure capable of accepting abstract economic intent (e.g., "generate a data tool to earn $500 MRR") and autonomously navigating the entire product lifecycle: ideation, market validation, software development, deployment, and monetization.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Orchestration Layer                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  Temporal   │  │  LangGraph  │  │   Model     │             │
│  │  (Durable)  │  │ (Cognitive) │  │   Router    │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                     Execution Layer                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ Claude Code │  │ Gemini CLI  │  │ E2B Sandbox │             │
│  │   Harness   │  │   Harness   │  │  (Safety)   │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                   Monetization Layer                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   Stripe    │  │   Vercel    │  │   Domain    │             │
│  │  Payments   │  │  Deployment │  │  Registry   │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

## Modules

### 1. Genesis Module (Market Intelligence)
- **Niche Identification Engine**: RAG-powered trend analysis from Reddit, HackerNews, Google Trends
- **Validator Agent**: SEO/keyword validation with search volume, keyword difficulty, competitor analysis
- **Meta-PM Architecture**: Product Manager, Architect, Project Manager roles using MetaGPT pattern

### 2. Orchestration Layer
- **Temporal.io**: Durable execution with state persistence, retry logic, and workflow hibernation
- **LangGraph**: Cognitive orchestration with Write→Test→Error→Fix cycles

### 3. Execution Layer
- **CLI Agent Harness**: Programmatic control of Claude Code and Gemini CLI
- **Living Spec Protocol**: CLAUDE.md/GEMINI.md for persistent context

### 4. Cognitive Economy (Model Router)
- **Tier 1 (Architect)**: Claude Sonnet, GPT-4o for architecture and complex debugging
- **Tier 2 (Builder)**: Gemini Pro for implementation and tests
- **Tier 3 (Intern)**: Gemini Flash, local models for formatting and linting

### 5. Infrastructure & Safety
- **E2B Sandbox**: Isolated execution environment with resource limits
- **Policy Gates**: Action authorization for deployments and billing
- **Budget Tracking**: Per-run cost limits with circuit breakers

### 6. Monetization
- **Stripe Integration**: Automated product, pricing, and payment link creation
- **Deployment Automation**: Vercel/Netlify programmatic deployment

## Quick Start

### Prerequisites
- Node.js 20+
- Python 3.11+
- Docker & Docker Compose
- pnpm

### Installation

```bash
# Clone the repository
git clone https://github.com/UMWai/autonomous-enterprise.git
cd autonomous-enterprise

# Install dependencies
pnpm install
cd apps/api && pip install -e ".[dev]" && cd ../..

# Copy environment file
cp .env.example .env
# Edit .env with your API keys

# Start infrastructure
docker-compose -f infra/docker-compose.yml up -d

# Run migrations
cd apps/api && alembic upgrade head && cd ../..

# Start the API
pnpm dev:api

# Start the Temporal worker (in another terminal)
pnpm dev:worker
```

### Usage

```bash
# Start a Genesis workflow
curl -X POST http://localhost:8000/api/v1/genesis/start \
  -H "Content-Type: application/json" \
  -d '{"intent": "generate a CSV to JSON converter tool to earn $500 MRR", "budget": 10.0}'

# Check workflow status
curl http://localhost:8000/api/v1/runs/{workflow_id}

# View generated specification
curl http://localhost:8000/api/v1/specs/{project_id}/claude.md
```

## Project Structure

```
autonomous-enterprise/
├── apps/
│   └── api/                    # FastAPI control plane (Python)
│       └── ae_api/
│           ├── api/v1/         # REST API endpoints
│           ├── genesis/        # Market intelligence module
│           ├── orchestration/  # Temporal client
│           ├── economy/        # Model router
│           ├── safety/         # Policy & budget management
│           ├── rag/            # Vector store & embeddings
│           ├── services/       # External service integrations
│           └── db/             # Database models
├── workers/
│   └── temporal-worker/        # Temporal workflows (TypeScript)
│       └── src/
│           ├── temporal/       # Workflows & activities
│           ├── langgraph/      # Write-Test-Fix graph
│           └── spec/           # Living spec management
├── packages/
│   └── shared/                 # Shared types & contracts
├── specs/
│   └── protocol/               # Spec templates
└── infra/                      # Docker & Temporal config
```

## Configuration

### Model Routing Tiers

| Tier | Models | Use Cases | Cost |
|------|--------|-----------|------|
| Tier 1 | Claude Sonnet, GPT-4o | Architecture, debugging, security | $$$ |
| Tier 2 | Gemini Pro, GPT-4o Mini | Implementation, tests, docs | $$ |
| Tier 3 | Gemini Flash, Llama | Formatting, linting, conversion | $ |

### Budget Management

- Default run budget: $10 USD
- Maximum run budget: $100 USD
- Circuit breaker triggers at budget exhaustion

## API Reference

### Genesis
- `POST /api/v1/genesis/start` - Start market intelligence workflow
- `GET /api/v1/genesis/niches/{project_id}` - Get niche candidates
- `POST /api/v1/genesis/validate/{niche_id}` - Validate a niche
- `POST /api/v1/genesis/approve/{project_id}` - Approve and proceed

### Runs
- `GET /api/v1/runs` - List all runs
- `GET /api/v1/runs/{run_id}` - Get run details
- `DELETE /api/v1/runs/{run_id}` - Cancel a run

### Specs
- `GET /api/v1/specs/{project_id}` - Get living spec
- `GET /api/v1/specs/{project_id}/claude.md` - Get CLAUDE.md
- `GET /api/v1/specs/{project_id}/gemini.md` - Get GEMINI.md

### Billing
- `POST /api/v1/billing/products` - Create Stripe product
- `POST /api/v1/billing/payment-links` - Generate payment link
- `POST /api/v1/billing/webhooks/stripe` - Stripe webhook handler

### Deploy
- `POST /api/v1/deploy/vercel` - Deploy to Vercel
- `POST /api/v1/deploy/netlify` - Deploy to Netlify

## Development

```bash
# Run tests
pnpm test

# Lint
pnpm lint

# Type check
cd apps/api && mypy ae_api
cd workers/temporal-worker && pnpm run build
```

## License

MIT

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.
