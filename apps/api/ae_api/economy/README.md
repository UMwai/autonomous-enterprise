# Model Router (Cognitive Economy)

The Model Router is an intelligent LLM routing system that automatically selects the most cost-effective model for each task based on complexity, risk, and budget constraints.

## Architecture

The system consists of three main components:

### 1. Task Classifier (`classifier.py`)

Analyzes incoming prompts to determine:
- **Complexity Score** (1-10): Uses Claude Opus 4.5 to semantically analyze task complexity
- **Risk Level**: Keyword-based detection of sensitive operations (deployments, deletions, etc.)
- **Suggested Tier**: Maps complexity score to appropriate model tier

**Complexity Mapping:**
- Score 1-3 → TIER3 (Intern) - Simple tasks
- Score 4-7 → TIER2 (Builder) - Standard tasks
- Score 8-10 → TIER1 (Architect) - Complex tasks

**Risk Detection:**
- Sensitive: deploy, delete, billing, security, production, etc.
- Moderate: update, modify, config, integration, etc.
- Safe: All other tasks

### 2. Model Router (`router.py`)

Routes tasks to appropriate models and manages costs:

**Model Tiers (Premium - heavily subsidized):**
- **TIER1 (Architect)**: Claude Opus 4.5, GPT-5.2 xhigh - Maximum intelligence
- **TIER2 (Builder)**: GPT-5.2 xhigh, Gemini 3 Pro - High intelligence
- **TIER3 (Intern)**: Gemini 3 Pro, Claude Opus 4.5 - Fast, high quality

**Features:**
- Automatic tier selection based on classification
- Manual tier override support
- Cost estimation before execution
- Budget tracking per run
- Automatic tier downgrade when budget is exceeded

### 3. Provider Implementations (`providers/`)

Unified interface for multiple LLM providers (Premium models):
- **OpenAI**: GPT-5.2 xhigh, O3, O4-mini
- **Anthropic**: Claude Opus 4.5, Claude Sonnet 4
- **Google**: Gemini 3 Pro Preview, Gemini 2.5

Each provider implements:
- `complete()`: Generate text completion
- `get_pricing()`: Get per-token pricing
- `calculate_cost()`: Calculate actual cost from usage

## API Endpoints

### POST `/api/v1/model-router/route`

Route a prompt to determine the best model.

**Request:**
```json
{
  "prompt": "Implement user authentication with JWT",
  "context": {"project": "web-app"},
  "override_tier": null,
  "run_id": "run-123"
}
```

**Response:**
```json
{
  "tier": "TIER2",
  "model_id": "gemini-1.5-pro",
  "provider": "google",
  "estimated_cost": 0.000125,
  "reasoning": "Classification: Standard implementation task...",
  "classification": {
    "complexity": "medium",
    "risk": "moderate",
    "complexity_score": 6,
    "reasoning": "...",
    "suggested_tier": "TIER2"
  }
}
```

### GET `/api/v1/model-router/tiers`

Get information about all available tiers.

**Response:**
```json
{
  "TIER1": {
    "tier": "TIER1",
    "models": [
      {"provider": "anthropic", "model": "claude-opus-4-5-20251101"},
      {"provider": "openai", "model": "gpt-5.2-xhigh"}
    ],
    "use_cases": [
      "Architecture design and system planning",
      "Complex debugging and root cause analysis",
      "..."
    ],
    "default_model": ["anthropic", "claude-opus-4-5-20251101"]
  }
}
```

### POST `/api/v1/model-router/complete`

Route and complete a prompt in one call.

**Request:**
```json
{
  "prompt": "Write a Python function to validate email addresses",
  "temperature": 0.7,
  "max_tokens": 2000,
  "run_id": "run-123"
}
```

**Response:**
```json
{
  "content": "def validate_email(email: str) -> bool:\n    ...",
  "routing_decision": { ... },
  "actual_cost": 0.000087,
  "usage": {
    "input_tokens": 42,
    "output_tokens": 150,
    "total_tokens": 192
  }
}
```

### GET `/api/v1/model-router/budget/{run_id}`

Get budget information for a run.

**Response:**
```json
{
  "run_id": "run-123",
  "usage": 0.45,
  "budget": 10.0,
  "remaining": 9.55,
  "utilization": 4.5
}
```

### DELETE `/api/v1/model-router/budget/{run_id}`

Reset budget tracking for a run.

## Usage Examples

### Basic Classification

```python
from ae_api.economy.classifier import SemanticClassifier
from ae_api.config import get_settings

settings = get_settings()
classifier = SemanticClassifier(settings)

result = await classifier.classify(
    "Design a microservices architecture for e-commerce"
)

print(f"Complexity: {result.complexity}")  # HIGH
print(f"Risk: {result.risk}")              # SAFE
print(f"Suggested Tier: {result.suggested_tier}")  # TIER1
```

### Intelligent Routing

```python
from ae_api.economy.router import ModelRouter
from ae_api.economy.classifier import SemanticClassifier

classifier = SemanticClassifier(settings)
router = ModelRouter(settings, classifier)

decision = await router.route(
    prompt="Implement user authentication",
    run_id="my-run"
)

print(f"Selected: {decision.provider} - {decision.model_id}")
print(f"Estimated cost: ${decision.estimated_cost:.6f}")
```

### Complete with Routing

```python
from ae_api.economy.providers import AnthropicProvider

provider = AnthropicProvider(settings)

# Route the task
decision = await router.route("Write a haiku about AI")

# Complete using selected model
completion = await provider.complete(
    prompt="Write a haiku about AI",
    model=decision.model_id,
    temperature=0.7,
    max_tokens=100
)

print(completion.content)
print(f"Actual cost: ${completion.cost:.6f}")

# Record usage
router.record_usage("my-run", completion.cost)
```

### Budget-Aware Routing

```python
# Set a budget
settings.default_run_budget = 5.0

run_id = "budget-demo"

# Router automatically downgrades tier if budget exceeded
for i in range(10):
    decision = await router.route(
        prompt="Complex task",
        run_id=run_id
    )

    # Check if budget allows
    if router.enforce_budget(run_id, decision.estimated_cost):
        # Execute and record
        router.record_usage(run_id, decision.estimated_cost)
    else:
        print(f"Budget exceeded at iteration {i}")
        break

# Check final usage
usage = router.get_run_usage(run_id)
print(f"Total spent: ${usage:.2f}")
```

## Configuration

Configure model preferences in `.env`:

```bash
# API Keys
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...

# Default Models per Tier (Premium - heavily subsidized)
TIER1_MODEL=claude-opus-4-5-20251101
TIER2_MODEL=gpt-5.2-xhigh
TIER3_MODEL=gemini-3-pro-preview

# Budget Settings
DEFAULT_RUN_BUDGET=10.0
MAX_RUN_BUDGET=100.0
```

## Cost Optimization Strategies

### 1. Automatic Tier Selection
The classifier routes all tasks to premium models for maximum intelligence:
- Code formatting → Gemini 3 Pro ($10.0 per 1M input tokens)
- Feature implementation → GPT-5.2 xhigh ($20.0 per 1M input tokens)
- Architecture design → Claude Opus 4.5 ($15.0 per 1M input tokens)

### 2. Budget Enforcement
Set per-run budgets to prevent cost overruns:
- Router tracks spending per run_id
- Automatically downgrades tiers when approaching budget
- Returns budget status in routing decisions

### 3. Risk-Based Upgrades
Sensitive operations automatically use higher-tier models:
- Deletions, deployments → Always TIER1
- Ensures critical operations get best models

### 4. Manual Overrides
Override automatic routing when needed:
```python
# Force use of best model
decision = await router.route(
    prompt="...",
    override_tier=ModelTier.TIER1_ARCHITECT
)
```

## Testing

Run the example script:

```bash
cd /home/umwai/autonomous-enterprise/apps/api
python3 examples/model_router_example.py
```

## Pricing Reference

**TIER1 (Architect):**
- Claude Sonnet: $3.00 / $15.00 per 1M tokens (in/out)
- GPT-4o: $2.50 / $10.00 per 1M tokens

**TIER2 (Builder):**
- Gemini Pro: $1.25 / $5.00 per 1M tokens
- GPT-4o Mini: $0.15 / $0.60 per 1M tokens

**TIER3 (Intern):**
- Gemini Flash: $0.075 / $0.30 per 1M tokens
- Claude Haiku: $0.80 / $4.00 per 1M tokens

## Future Enhancements

- [ ] Add response quality feedback loop
- [ ] Track success rates per tier
- [ ] Implement A/B testing between models
- [ ] Add support for local/open-source models
- [ ] Cache common classifications
- [ ] Add batch routing API
- [ ] Implement cost analytics dashboard
