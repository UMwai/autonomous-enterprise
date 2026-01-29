# Autonomous Enterprise API

FastAPI control plane for the Autonomous Enterprise system.

## Overview

This is the Python backend for the Autonomous Enterprise "Harness". It provides endpoints for:
- Genesis / Market Intelligence
- Orchestration control (Temporal)
- Model Routing (Cognitive Economy)
- Safety & Budgeting
- RAG & Vector Search
- External Service Integrations (Stripe, Vercel)

## Development

### Prerequisites
- Python 3.11+
- PostgreSQL + pgvector
- Redis
- Temporal

### Setup

```bash
# Install dependencies
pip install -e ".[dev]"

# Run tests
python -m pytest tests/
```

### Configuration
Configuration is handled via `.env` file and `ae_api.config.Settings`.

## Testing
Run tests using pytest:
```bash
python -m pytest tests/
```
