# Model Router Quick Start Guide

## Installation

The Model Router is already integrated into the Autonomous Enterprise API. Just ensure your environment variables are configured:

```bash
# Required: At least one LLM provider API key
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...

# Optional: Model preferences (defaults shown)
TIER1_MODEL=claude-3-5-sonnet-20241022
TIER2_MODEL=gemini-1.5-pro
TIER3_MODEL=gemini-1.5-flash

# Optional: Budget settings (defaults shown)
DEFAULT_RUN_BUDGET=10.0
MAX_RUN_BUDGET=100.0
```

## Python Usage

### Basic Routing

```python
from ae_api.config import get_settings
from ae_api.economy.classifier import SemanticClassifier
from ae_api.economy.router import ModelRouter

# Initialize
settings = get_settings()
classifier = SemanticClassifier(settings)
router = ModelRouter(settings, classifier)

# Route a task
decision = await router.route("Implement user authentication")

print(f"Use {decision.provider} - {decision.model_id}")
print(f"Estimated cost: ${decision.estimated_cost:.6f}")
```

### With Completion

```python
from ae_api.economy.providers import AnthropicProvider

# Route the task
decision = await router.route("Write a Python function to validate emails")

# Get provider and complete
provider = AnthropicProvider(settings)
completion = await provider.complete(
    prompt="Write a Python function to validate emails",
    model=decision.model_id,
    temperature=0.7,
    max_tokens=500
)

print(completion.content)
print(f"Actual cost: ${completion.cost:.6f}")
```

### Budget Tracking

```python
run_id = "my-project-run"

# Route with budget tracking
decision = await router.route(
    prompt="Implement feature X",
    run_id=run_id
)

# Execute and record cost
# ... perform completion ...
router.record_usage(run_id, actual_cost)

# Check remaining budget
usage = router.get_run_usage(run_id)
print(f"Spent: ${usage:.2f}")
```

### Manual Tier Override

```python
from ae_api.economy.router import ModelTier

# Force use of highest tier
decision = await router.route(
    prompt="Simple task",
    override_tier=ModelTier.TIER1_ARCHITECT
)
```

## REST API Usage

### 1. Route a Prompt

```bash
curl -X POST http://localhost:8000/api/v1/model-router/route \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Implement JWT authentication",
    "run_id": "project-123"
  }'
```

Response:
```json
{
  "tier": "TIER2",
  "model_id": "gemini-1.5-pro",
  "provider": "google",
  "estimated_cost": 0.000125,
  "reasoning": "Classification: Standard implementation task requiring medium complexity",
  "classification": {
    "complexity": "medium",
    "risk": "moderate",
    "complexity_score": 6,
    "reasoning": "Authentication implementation requires security knowledge",
    "suggested_tier": "TIER2"
  }
}
```

### 2. Get Available Tiers

```bash
curl http://localhost:8000/api/v1/model-router/tiers
```

### 3. Complete a Prompt (Route + Generate)

```bash
curl -X POST http://localhost:8000/api/v1/model-router/complete \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Write a haiku about AI",
    "temperature": 0.8,
    "max_tokens": 100,
    "run_id": "creative-123"
  }'
```

Response:
```json
{
  "content": "Silicon minds think\nPatterns emerge from chaos\nWisdom without soul",
  "routing_decision": {
    "tier": "TIER2",
    "model_id": "gemini-1.5-pro",
    "provider": "google",
    "estimated_cost": 0.000050,
    "reasoning": "..."
  },
  "actual_cost": 0.000048,
  "usage": {
    "input_tokens": 12,
    "output_tokens": 18,
    "total_tokens": 30
  }
}
```

### 4. Check Budget

```bash
curl http://localhost:8000/api/v1/model-router/budget/project-123
```

Response:
```json
{
  "run_id": "project-123",
  "usage": 0.45,
  "budget": 10.0,
  "remaining": 9.55,
  "utilization": 4.5
}
```

### 5. Reset Budget

```bash
curl -X DELETE http://localhost:8000/api/v1/model-router/budget/project-123
```

## Common Use Cases

### Use Case 1: Code Formatting (TIER3)

```python
# Automatic routing to cheapest model
decision = await router.route("Format this Python code according to PEP 8")
# → TIER3 (Gemini Flash) - $0.000008 per request
```

### Use Case 2: Feature Implementation (TIER2)

```python
decision = await router.route("Implement a REST API endpoint for user registration")
# → TIER2 (Gemini Pro) - $0.000125 per request
```

### Use Case 3: Architecture Design (TIER1)

```python
decision = await router.route(
    "Design a scalable microservices architecture for an e-commerce platform"
)
# → TIER1 (Claude Sonnet) - $0.003 per request
```

### Use Case 4: Sensitive Operations (Auto-upgrade to TIER1)

```python
decision = await router.route("Deploy the application to production")
# → TIER1 (forced upgrade due to 'deploy' keyword)
```

## Cost Comparison

| Task Type | Old (Always Sonnet) | New (Smart Routing) | Savings |
|-----------|-------------------|-------------------|---------|
| Format code | $0.0030 | $0.000008 | 99.7% |
| Simple query | $0.0030 | $0.000015 | 99.5% |
| Write tests | $0.0045 | $0.000200 | 95.6% |
| Implement feature | $0.0060 | $0.000300 | 95.0% |
| Debug complex issue | $0.0090 | $0.009000 | 0% (uses TIER1) |

**Average savings: 80-95% on typical development workloads**

## Integration with FastAPI Endpoints

```python
from fastapi import APIRouter, Depends
from ae_api.economy.router import ModelRouter
from ae_api.api.v1.endpoints.model_router import get_router

router = APIRouter()

@router.post("/my-endpoint")
async def my_endpoint(
    model_router: ModelRouter = Depends(get_router)
):
    # Use model router in your endpoint
    decision = await model_router.route("Your task here")
    # ... use decision to select model ...
```

## Monitoring & Debugging

### Enable Logging

The classifier uses the configured model to analyze tasks. To see classification reasoning:

```python
import structlog
logger = structlog.get_logger()

result = await classifier.classify("Your task")
logger.info(
    "Task classified",
    complexity=result.complexity,
    tier=result.suggested_tier,
    reasoning=result.reasoning
)
```

### Track Costs

```python
# Before a batch of operations
initial = router.get_run_usage(run_id)

# ... perform operations ...

# After
final = router.get_run_usage(run_id)
print(f"Batch cost: ${final - initial:.4f}")
```

## Tips for Cost Optimization

1. **Let the router decide**: Don't override unless necessary
2. **Batch similar tasks**: Process multiple simple tasks together
3. **Set appropriate budgets**: Prevents runaway costs
4. **Monitor usage**: Regular budget checks in long-running processes
5. **Use context wisely**: More context = higher costs

## Troubleshooting

### "Provider not configured" error

Ensure you have at least one API key set:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
# or
export OPENAI_API_KEY=sk-...
# or
export GOOGLE_API_KEY=...
```

### Budget exceeded

```python
# Check current usage
usage = router.get_run_usage(run_id)
print(f"Current usage: ${usage:.4f}")

# Reset if needed
router.reset_run_budget(run_id)
```

### Task classified incorrectly

```python
# Override the classification
decision = await router.route(
    prompt="...",
    override_tier=ModelTier.TIER1_ARCHITECT  # Force specific tier
)
```

## Next Steps

- Read the full [README.md](./README.md) for architecture details
- Check [examples/model_router_example.py](../../examples/model_router_example.py) for more examples
- Review [tests/test_model_router.py](../../tests/test_model_router.py) for usage patterns
- Integrate with your Autonomous Enterprise workflows
