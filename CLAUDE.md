# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Autonomous Enterprise is a "Harness" - infrastructure for accepting abstract economic intent (e.g., "generate a data tool to earn $500 MRR") and autonomously navigating the product lifecycle: ideation, market validation, development, deployment, and monetization.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  FastAPI Control Plane (Python)                 │
│  apps/api/ae_api/                               │
│  - REST API, orchestration, economy, safety     │
└────────────────────┬────────────────────────────┘
                     │ Temporal RPC
┌────────────────────▼────────────────────────────┐
│  Temporal Worker (TypeScript)                   │
│  workers/temporal-worker/src/                   │
│  - Workflows, LangGraph, CLI harness            │
└────────────────────┬────────────────────────────┘
                     │ CLI subprocess
┌────────────────────▼────────────────────────────┐
│  CLI Agents (Claude Code, Gemini CLI, Codex)    │
│  - Autonomous code generation                   │
└─────────────────────────────────────────────────┘
```

### Key Modules

| Module | Path | Purpose |
|--------|------|---------|
| Genesis | `apps/api/ae_api/genesis/` | Market intelligence, niche identification, MetaGPT roles |
| Economy | `apps/api/ae_api/economy/` | Model router (3-tier LLM routing), cost tracking |
| Safety | `apps/api/ae_api/safety/` | Policy gates, budget tracking, secret redaction |
| Orchestration | `apps/api/ae_api/orchestration/` | Temporal client, workflow IDs |
| CLI Harness | `workers/temporal-worker/src/temporal/activities/cli/` | Unified interface for Claude/Gemini/Codex CLIs |
| Workflows | `workers/temporal-worker/src/temporal/workflows/` | genesis, build_ship, monetize |

### Model Router Tiers (Premium Only)

| Tier | Model | Use Case |
|------|-------|----------|
| Tier 1 | Claude Opus 4.5 | Architecture, debugging, security |
| Tier 2 | GPT-5.2 | Implementation, tests, docs |
| Tier 3 | Gemini 3 Pro Preview | Formatting, linting, fast ops |

## Commands

```bash
# Install dependencies
pnpm install
cd apps/api && pip install -e ".[dev]" && cd ../..

# Start infrastructure
docker-compose -f infra/docker-compose.yml up -d

# Run API (Python)
pnpm dev:api                    # uvicorn ae_api.main:app --reload

# Run Temporal worker (TypeScript)
pnpm dev:worker                 # tsx watch src/index.ts

# Database migrations
cd apps/api && alembic upgrade head

# Tests
pnpm test                       # Run all tests
cd apps/api && pytest tests/ -v # Python tests only
cd workers/temporal-worker && pnpm test  # TypeScript tests

# Linting
pnpm lint                       # All workspaces
cd apps/api && ruff check ae_api  # Python only
cd apps/api && mypy ae_api        # Type check

# Build
pnpm build                      # TypeScript build
```

## API Endpoints

Base URL: `http://localhost:8000/api/v1`

- `POST /genesis/start` - Start market intelligence workflow
- `GET /runs/{run_id}` - Get workflow status
- `GET /specs/{project_id}/claude.md` - Get living specification
- `POST /model-router/route` - Route prompt to appropriate tier
- `POST /safety/check` - Check action policy
- `POST /billing/products` - Create Stripe product
- `POST /deploy/vercel` - Deploy to Vercel

## Key Files

| File | Purpose |
|------|---------|
| `apps/api/ae_api/main.py` | FastAPI app entry |
| `apps/api/ae_api/config.py` | Environment settings |
| `workers/temporal-worker/src/temporal/workflows/genesis.ts` | Genesis workflow |
| `workers/temporal-worker/src/temporal/activities/cli/harness.ts` | CLI agent harness |
| `apps/api/ae_api/economy/router.py` | Model routing logic |
| `apps/api/ae_api/safety/policies.py` | Policy enforcement |
| `specs/protocol/CLAUDE.template.md` | Living spec template |

## Environment Variables

Required in `.env`:
```
# LLM Providers
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_API_KEY=

# Infrastructure
DATABASE_URL=postgresql+asyncpg://ae:ae@localhost:5432/ae
REDIS_HOST=localhost
TEMPORAL_HOST=localhost:7233

# Billing/Deploy
STRIPE_API_KEY=
VERCEL_TOKEN=

# Safety
E2B_API_KEY=
```

## Living Spec Protocol

The system generates `CLAUDE.md`/`GEMINI.md` files for each product using templates in `specs/protocol/`. These contain:
- Project directives
- Mission log (execution history)
- Error registry (for Write→Test→Fix loops)
- Current phase

## Safety Constraints

- Budget tracking per run (default $10, max $100)
- Policy gates for code execution, deployments, billing ops
- Secret redaction before logging
- E2B sandbox for isolated execution
