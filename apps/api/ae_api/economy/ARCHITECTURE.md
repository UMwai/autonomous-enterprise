# Model Router Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Model Router System                          │
│                    (Cognitive Economy)                           │
└─────────────────────────────────────────────────────────────────┘

                              │
                              │ Task Prompt
                              ▼
                    ┌──────────────────┐
                    │   Classifier     │
                    │  (Haiku-based)   │
                    └──────────────────┘
                              │
                              │ Classification Result
                              │ (Complexity, Risk, Score)
                              ▼
                    ┌──────────────────┐
                    │  Model Router    │
                    │  (Decision Engine)│
                    └──────────────────┘
                              │
                ┌─────────────┼─────────────┐
                │             │             │
                ▼             ▼             ▼
           ┌────────┐   ┌────────┐   ┌────────┐
           │ TIER1  │   │ TIER2  │   │ TIER3  │
           │Architect│   │Builder │   │Intern  │
           └────────┘   └────────┘   └────────┘
                │             │             │
                ▼             ▼             ▼
         ┌──────────┐   ┌──────────┐  ┌──────────┐
         │  Claude  │   │  Gemini  │  │  Gemini  │
         │  Sonnet  │   │   Pro    │  │  Flash   │
         │  GPT-4o  │   │ GPT-4o-M │  │  Haiku   │
         └──────────┘   └──────────┘  └──────────┘
                │             │             │
                └─────────────┼─────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │    Response      │
                    │  + Cost Tracking │
                    └──────────────────┘
```

## Component Architecture

### 1. Task Classifier (`classifier.py`)

```
Input: Task Prompt + Context
   │
   ▼
┌──────────────────────────────────┐
│  Semantic Analysis (Haiku LLM)  │
│  • Analyzes task complexity      │
│  • Returns score 1-10            │
└──────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────┐
│  Risk Detection (Keywords)       │
│  • Checks sensitive operations   │
│  • Returns SAFE/MODERATE/        │
│    SENSITIVE                     │
└──────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────┐
│  Tier Mapping                    │
│  • Score 1-3 → TIER3            │
│  • Score 4-7 → TIER2            │
│  • Score 8-10 → TIER1           │
│  • SENSITIVE → Force TIER1      │
└──────────────────────────────────┘
   │
   ▼
Output: ClassificationResult
```

### 2. Model Router (`router.py`)

```
Input: Prompt + Classification + Budget
   │
   ▼
┌──────────────────────────────────┐
│  Tier Selection                  │
│  • Use classification result     │
│  • Or apply manual override      │
└──────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────┐
│  Model Selection                 │
│  • Get default model for tier    │
│  • Check provider availability   │
└──────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────┐
│  Cost Estimation                 │
│  • Calculate input tokens        │
│  • Estimate output tokens        │
│  • Apply tier pricing            │
└──────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────┐
│  Budget Check                    │
│  • Check current usage           │
│  • Enforce budget limit          │
│  • Downgrade tier if needed      │
└──────────────────────────────────┘
   │
   ▼
Output: RoutingDecision
```

### 3. Provider Layer (`providers/`)

```
┌─────────────────────────────────────────────┐
│          BaseProvider (Interface)           │
│  • complete(prompt, model, **kwargs)       │
│  • get_pricing(model)                      │
│  • calculate_cost(tokens)                  │
└─────────────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
        ▼            ▼            ▼
┌────────────┐ ┌────────────┐ ┌────────────┐
│  OpenAI    │ │ Anthropic  │ │  Google    │
│  Provider  │ │  Provider  │ │  Provider  │
├────────────┤ ├────────────┤ ├────────────┤
│ GPT-4o     │ │ Claude     │ │ Gemini Pro │
│ GPT-4o-M   │ │ Sonnet     │ │ Gemini     │
│ GPT-3.5    │ │ Haiku      │ │ Flash      │
└────────────┘ └────────────┘ └────────────┘
```

## Data Flow

### Complete Request Flow

```
1. API Request
   POST /api/v1/model-router/complete
   {
     "prompt": "Implement user auth",
     "run_id": "run-123"
   }

2. Classification
   SemanticClassifier.classify()
   ├─ Haiku analyzes complexity → Score: 6
   ├─ Keyword check → Risk: MODERATE
   └─ Tier mapping → TIER2

3. Routing Decision
   ModelRouter.route()
   ├─ Select TIER2 model → gemini-1.5-pro
   ├─ Estimate cost → $0.000125
   ├─ Check budget → OK (within limit)
   └─ Return decision

4. Completion
   GoogleProvider.complete()
   ├─ Call Gemini API
   ├─ Track token usage
   └─ Calculate actual cost → $0.000118

5. Budget Recording
   ModelRouter.record_usage()
   └─ Update run_id total → $0.000118

6. Response
   {
     "content": "Here's a JWT implementation...",
     "routing_decision": {...},
     "actual_cost": 0.000118,
     "usage": {"input_tokens": 42, "output_tokens": 180}
   }
```

## Decision Tree

```
Task Prompt
    │
    ▼
[Classify Complexity]
    │
    ├─ Score 1-3 ────────────────────┐
    │                                 │
    ├─ Score 4-7 ──────────────┐     │
    │                           │     │
    └─ Score 8-10 ──────┐      │     │
                         │      │     │
[Check Risk]            │      │     │
    │                   │      │     │
    ├─ SAFE ────────────┼──────┼─────┤
    │                   │      │     │
    ├─ MODERATE ────────┼──────┼─────┤
    │                   │      │     │
    └─ SENSITIVE ───────┼──────┼─────┼─→ Force TIER1
                        │      │     │
                        ▼      ▼     ▼
                    TIER1  TIER2  TIER3
                        │      │     │
[Check Budget]          │      │     │
    │                   │      │     │
    ├─ Over budget ─────┼──────┼─────┤
    │                   │      │     │
    └─ Within budget ───┼──────┼─────┤
                        │      │     │
[Downgrade if needed]   │      │     │
    │                   │      │     │
    └───────────────────┴──────┴─────┘
                        │
                        ▼
                [Select Model]
                        │
                        ▼
                [Execute & Track]
```

## Tier Configuration

```
┌─────────────────────────────────────────────────────┐
│ TIER1 (Architect)                                   │
├─────────────────────────────────────────────────────┤
│ Models:                                             │
│   • claude-3-5-sonnet-20241022 ($3/$15 per 1M)     │
│   • gpt-4o ($2.5/$10 per 1M)                       │
│                                                     │
│ Use Cases:                                         │
│   • Architecture design                            │
│   • Complex debugging                              │
│   • Security reviews                               │
│   • Performance optimization                       │
│   • All SENSITIVE operations                       │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ TIER2 (Builder)                                     │
├─────────────────────────────────────────────────────┤
│ Models:                                             │
│   • gemini-1.5-pro ($1.25/$5 per 1M)              │
│   • gpt-4o-mini ($0.15/$0.6 per 1M)               │
│                                                     │
│ Use Cases:                                         │
│   • Feature implementation                         │
│   • Writing tests                                  │
│   • Documentation                                  │
│   • API integration                                │
│   • Code refactoring                               │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ TIER3 (Intern)                                      │
├─────────────────────────────────────────────────────┤
│ Models:                                             │
│   • gemini-1.5-flash ($0.075/$0.3 per 1M)         │
│   • claude-3-5-haiku-20241022 ($0.8/$4 per 1M)    │
│                                                     │
│ Use Cases:                                         │
│   • Code formatting                                │
│   • Simple queries                                 │
│   • Template generation                            │
│   • File conversions                               │
│   • Basic lookups                                  │
└─────────────────────────────────────────────────────┘
```

## Budget Management

```
Run Lifecycle:
    │
    ▼
[Initialize Run]
    run_id: "run-123"
    budget: $10.00
    usage: $0.00
    │
    ▼
[Request 1: Complex Task]
    ├─ Route → TIER1
    ├─ Cost: $0.003
    ├─ Usage: $0.003 (0.03%)
    └─ Remaining: $9.997
    │
    ▼
[Request 2-50: Various Tasks]
    ├─ Route → Mixed tiers
    ├─ Cost: $4.50
    ├─ Usage: $4.503 (45%)
    └─ Remaining: $5.497
    │
    ▼
[Request 51: Complex Task]
    ├─ Would route to TIER1
    ├─ Cost would be $0.008
    ├─ Check: $4.503 + $0.008 = $4.511 < $10.00 ✓
    ├─ Execute with TIER1
    └─ Update usage
    │
    ▼
[Request 100: Complex Task]
    ├─ Would route to TIER1
    ├─ Cost would be $0.008
    ├─ Check: $9.95 + $0.008 = $9.958 < $10.00 ✓
    ├─ Execute with TIER1
    └─ Usage: $9.958 (99.58%)
    │
    ▼
[Request 101: Complex Task]
    ├─ Would route to TIER1
    ├─ Cost would be $0.008
    ├─ Check: $9.958 + $0.008 = $9.966 > $10.00 ✗
    ├─ Downgrade to TIER2
    ├─ New cost: $0.001
    └─ Execute with TIER2
    │
    ▼
[Complete/Reset]
    └─ router.reset_run_budget("run-123")
```

## Integration Points

```
┌──────────────────────────────────────────────────┐
│         Autonomous Enterprise System             │
└──────────────────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
        ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│   Genesis    │ │   Safety     │ │  Temporal    │
│   Module     │ │   Module     │ │  Workflows   │
└──────────────┘ └──────────────┘ └──────────────┘
        │               │               │
        └───────────────┼───────────────┘
                        │
                        ▼
            ┌─────────────────────┐
            │   Model Router      │
            │  (Cognitive Economy)│
            └─────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
        ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Observability│ │   Billing    │ │   Database   │
│   (Logging)  │ │  (Stripe)    │ │  (Postgres)  │
└──────────────┘ └──────────────┘ └──────────────┘
```

## Performance Characteristics

```
Classification:
    ├─ Haiku API call: ~200ms
    ├─ Keyword check: <1ms
    └─ Total: ~200ms

Routing Decision:
    ├─ Tier selection: <1ms
    ├─ Cost estimation: <1ms
    ├─ Budget check: <1ms
    └─ Total: <10ms

Completion:
    ├─ TIER1 (Sonnet): 2-5s
    ├─ TIER2 (Gemini Pro): 1-3s
    └─ TIER3 (Flash): 0.5-2s

Total Latency:
    └─ Classification (200ms) + Routing (10ms) + Completion (varies)
```

## Cost Optimization

```
Traditional Approach (Always Sonnet):
    1000 requests × $0.003/request = $3.00

Smart Routing Approach:
    400 simple tasks   × $0.000015/req = $0.006 (TIER3)
    500 standard tasks × $0.000125/req = $0.063 (TIER2)
    100 complex tasks  × $0.003000/req = $0.300 (TIER1)
    ─────────────────────────────────────────────
    Total = $0.369

Savings: $2.631 (87.7% reduction)
```

## Error Handling

```
Request Flow with Errors:

┌─────────────┐
│   Request   │
└─────────────┘
       │
       ▼
┌─────────────────┐
│  Classify       │
│  • Haiku fails? │──→ Fallback to default tier (TIER2)
└─────────────────┘
       │
       ▼
┌─────────────────┐
│  Route          │
│  • No provider? │──→ HTTP 503 "Provider not configured"
└─────────────────┘
       │
       ▼
┌─────────────────┐
│  Complete       │
│  • API error?   │──→ HTTP 500 with error details
│  • Timeout?     │──→ Retry with backoff
└─────────────────┘
       │
       ▼
┌─────────────────┐
│  Record Usage   │
│  • Never fails  │──→ Graceful degradation
└─────────────────┘
```

## Monitoring & Observability

All routing decisions are logged with structured logging:

```json
{
  "event": "task_routed",
  "run_id": "run-123",
  "tier": "TIER2",
  "model": "gemini-1.5-pro",
  "complexity_score": 6,
  "risk": "moderate",
  "estimated_cost": 0.000125,
  "reasoning": "Standard implementation task",
  "timestamp": "2025-12-16T10:30:00Z"
}
```
