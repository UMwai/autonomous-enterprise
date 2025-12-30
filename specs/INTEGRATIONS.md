# Autonomous Enterprise Integrations

## Overview

Autonomous Enterprise integrates with multiple external services to enable end-to-end product lifecycle automation, from market research to monetization.

---

## LLM Provider Integrations

### 1. Anthropic (Claude)

**Purpose**: Tier 1 architect agent, complex reasoning

**Models**:
- Claude Opus 4.5 (primary)
- Claude Sonnet 4 (fallback)

**Authentication**:
```bash
ANTHROPIC_API_KEY=sk-ant-...
```

**Integration**:
```python
# apps/api/ae_api/economy/providers/anthropic.py
import anthropic

class AnthropicProvider:
    def __init__(self, api_key: str):
        self.client = anthropic.Anthropic(api_key=api_key)

    async def complete(self, prompt: str, model: str = "claude-opus-4.5") -> str:
        message = await self.client.messages.create(
            model=model,
            max_tokens=8000,
            messages=[{"role": "user", "content": prompt}]
        )
        return message.content[0].text
```

### 2. OpenAI (GPT/Codex)

**Purpose**: Tier 2 builder agent, implementation

**Models**:
- GPT-5.2 (primary)
- GPT-4 Turbo (fallback)

**Authentication**:
```bash
OPENAI_API_KEY=sk-...
```

**Integration**:
```python
# apps/api/ae_api/economy/providers/openai.py
import openai

class OpenAIProvider:
    def __init__(self, api_key: str):
        self.client = openai.OpenAI(api_key=api_key)

    async def complete(self, prompt: str, model: str = "gpt-5.2") -> str:
        response = await self.client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}]
        )
        return response.choices[0].message.content
```

### 3. Google AI (Gemini)

**Purpose**: Tier 3 intern agent, fast operations

**Models**:
- Gemini 3 Pro (primary)
- Gemini 3 Flash (fast mode)

**Authentication**:
```bash
GOOGLE_API_KEY=AIza...
```

**Integration**:
```python
# apps/api/ae_api/economy/providers/google.py
import google.generativeai as genai

class GoogleProvider:
    def __init__(self, api_key: str):
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel('gemini-3-pro')

    async def complete(self, prompt: str) -> str:
        response = await self.model.generate_content_async(prompt)
        return response.text
```

---

## CLI Tool Integrations

### Claude Code CLI

**Binary**: `claude`

**Command Formats**:
```bash
# Interactive (full access)
claude --dangerously-skip-permissions

# Print mode
claude -p "prompt"

# JSON output
claude --output-format stream-json
```

**Harness Integration**:
```typescript
// workers/temporal-worker/src/temporal/activities/cli/claude.ts
export async function executeClaude(prompt: string): Promise<ExecuteResult> {
  const process = spawn('claude', [
    '-p', prompt,
    '--output-format', 'stream-json'
  ]);

  return streamOutput(process);
}
```

### Gemini CLI

**Binary**: `gemini`

**Command Formats**:
```bash
# Model selection
gemini -m gemini-3-pro "prompt"

# Yolo mode (auto-approve)
gemini -y "prompt"

# JSON output
gemini -o stream-json "prompt"
```

**Harness Integration**:
```typescript
// workers/temporal-worker/src/temporal/activities/cli/gemini.ts
export async function executeGemini(prompt: string, model: string = 'gemini-3-pro'): Promise<ExecuteResult> {
  const process = spawn('gemini', [
    '-m', model,
    '-o', 'stream-json',
    '-y',
    prompt
  ]);

  return streamOutput(process);
}
```

### Codex CLI

**Binary**: `codex`

**Command Formats**:
```bash
# Execute with approval policy
codex exec -m gpt-5.2 -c approval-policy never "prompt"

# Sandbox modes
codex --sandbox danger-full-access exec "prompt"
```

**Harness Integration**:
```typescript
// workers/temporal-worker/src/temporal/activities/cli/codex.ts
export async function executeCodex(prompt: string, model: string = 'gpt-5.2'): Promise<ExecuteResult> {
  const process = spawn('codex', [
    'exec',
    '-m', model,
    '-c', 'approval-policy', 'never',
    prompt
  ]);

  return streamOutput(process);
}
```

---

## Orchestration Integrations

### Temporal.io

**Purpose**: Durable workflow execution

**Configuration**:
```bash
TEMPORAL_HOST=localhost:7233
TEMPORAL_NAMESPACE=default
```

**Client Integration**:
```python
# apps/api/ae_api/orchestration/temporal_client.py
from temporalio.client import Client

class TemporalClient:
    def __init__(self, host: str):
        self.host = host

    async def connect(self):
        self.client = await Client.connect(self.host)

    async def start_workflow(self, workflow: str, args: dict) -> str:
        handle = await self.client.start_workflow(
            workflow,
            args,
            id=f"{workflow}-{uuid.uuid4()}",
            task_queue="ae-tasks"
        )
        return handle.id
```

**Worker Integration**:
```typescript
// workers/temporal-worker/src/index.ts
import { Worker } from '@temporalio/worker';
import * as activities from './activities';
import * as workflows from './workflows';

async function run() {
  const worker = await Worker.create({
    workflowsPath: require.resolve('./workflows'),
    activities,
    taskQueue: 'ae-tasks',
  });

  await worker.run();
}
```

---

## Payment Integrations

### Stripe

**Purpose**: Payment processing and subscription management

**Configuration**:
```bash
STRIPE_API_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

**Product Creation**:
```python
# apps/api/ae_api/services/billing.py
import stripe

class StripeService:
    def __init__(self, api_key: str):
        stripe.api_key = api_key

    async def create_product(self, name: str, description: str) -> str:
        product = stripe.Product.create(
            name=name,
            description=description
        )
        return product.id

    async def create_price(self, product_id: str, amount: int, currency: str = 'usd') -> str:
        price = stripe.Price.create(
            product=product_id,
            unit_amount=amount,
            currency=currency,
            recurring={'interval': 'month'}
        )
        return price.id

    async def create_payment_link(self, price_id: str) -> str:
        link = stripe.PaymentLink.create(line_items=[{'price': price_id, 'quantity': 1}])
        return link.url
```

**Webhook Handler**:
```python
# apps/api/ae_api/api/v1/billing.py
@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig_header = request.headers.get('Stripe-Signature')

    event = stripe.Webhook.construct_event(
        payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
    )

    if event['type'] == 'checkout.session.completed':
        await handle_checkout_complete(event['data']['object'])

    return {"status": "ok"}
```

---

## Deployment Integrations

### Vercel

**Purpose**: Frontend and serverless deployment

**Configuration**:
```bash
VERCEL_TOKEN=...
VERCEL_ORG_ID=...
```

**Deployment Integration**:
```python
# apps/api/ae_api/services/deploy.py
import httpx

class VercelService:
    BASE_URL = "https://api.vercel.com"

    def __init__(self, token: str):
        self.token = token
        self.headers = {"Authorization": f"Bearer {token}"}

    async def create_project(self, name: str, repo_url: str) -> dict:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.BASE_URL}/v9/projects",
                headers=self.headers,
                json={
                    "name": name,
                    "gitRepository": {"repo": repo_url, "type": "github"}
                }
            )
            return response.json()

    async def trigger_deployment(self, project_id: str) -> dict:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.BASE_URL}/v13/deployments",
                headers=self.headers,
                json={"name": project_id}
            )
            return response.json()
```

### Netlify

**Purpose**: Alternative deployment platform

**Configuration**:
```bash
NETLIFY_AUTH_TOKEN=...
```

**Deployment Integration**:
```python
# apps/api/ae_api/services/deploy.py
class NetlifyService:
    BASE_URL = "https://api.netlify.com/api/v1"

    def __init__(self, token: str):
        self.token = token
        self.headers = {"Authorization": f"Bearer {token}"}

    async def create_site(self, name: str) -> dict:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.BASE_URL}/sites",
                headers=self.headers,
                json={"name": name}
            )
            return response.json()

    async def deploy_site(self, site_id: str, build_path: str) -> dict:
        # Deploy built files
        pass
```

---

## Sandbox Integrations

### E2B (Code Sandbox)

**Purpose**: Isolated code execution environment

**Configuration**:
```bash
E2B_API_KEY=...
```

**Sandbox Integration**:
```python
# apps/api/ae_api/safety/sandbox.py
from e2b import Sandbox

class E2BSandbox:
    def __init__(self, api_key: str):
        self.api_key = api_key

    async def execute(self, code: str, language: str = "python") -> dict:
        sandbox = Sandbox(api_key=self.api_key)

        try:
            result = await sandbox.run_code(code, language=language)
            return {
                "success": True,
                "output": result.stdout,
                "error": result.stderr
            }
        finally:
            await sandbox.close()
```

---

## Data Source Integrations

### Reddit API

**Purpose**: Trend analysis for niche identification

**Configuration**:
```bash
REDDIT_CLIENT_ID=...
REDDIT_CLIENT_SECRET=...
```

**Integration**:
```python
# apps/api/ae_api/genesis/rag/reddit.py
import praw

class RedditFetcher:
    def __init__(self, client_id: str, client_secret: str):
        self.reddit = praw.Reddit(
            client_id=client_id,
            client_secret=client_secret,
            user_agent="autonomous-enterprise/1.0"
        )

    async def fetch_trends(self, subreddits: list, limit: int = 100) -> list:
        posts = []
        for sub in subreddits:
            subreddit = self.reddit.subreddit(sub)
            for post in subreddit.hot(limit=limit):
                posts.append({
                    "title": post.title,
                    "score": post.score,
                    "comments": post.num_comments,
                    "subreddit": sub
                })
        return posts
```

### HackerNews API

**Purpose**: Tech trend analysis

**Integration**:
```python
# apps/api/ae_api/genesis/rag/hackernews.py
import httpx

class HackerNewsFetcher:
    BASE_URL = "https://hacker-news.firebaseio.com/v0"

    async def fetch_top_stories(self, limit: int = 100) -> list:
        async with httpx.AsyncClient() as client:
            # Get top story IDs
            response = await client.get(f"{self.BASE_URL}/topstories.json")
            story_ids = response.json()[:limit]

            # Fetch story details
            stories = []
            for sid in story_ids:
                resp = await client.get(f"{self.BASE_URL}/item/{sid}.json")
                stories.append(resp.json())

            return stories
```

### Google Trends

**Purpose**: Search trend validation

**Integration**:
```python
# apps/api/ae_api/genesis/rag/google_trends.py
from pytrends.request import TrendReq

class GoogleTrendsFetcher:
    def __init__(self):
        self.pytrends = TrendReq(hl='en-US', tz=360)

    async def get_interest(self, keywords: list) -> dict:
        self.pytrends.build_payload(keywords, timeframe='today 3-m')
        data = self.pytrends.interest_over_time()
        return data.to_dict()

    async def get_related_queries(self, keyword: str) -> dict:
        self.pytrends.build_payload([keyword])
        return self.pytrends.related_queries()
```

---

## Database Integrations

### PostgreSQL

**Purpose**: Primary data store

**Configuration**:
```bash
DATABASE_URL=postgresql+asyncpg://ae:ae@localhost:5432/ae
```

**Integration**:
```python
# apps/api/ae_api/db/session.py
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession

engine = create_async_engine(settings.DATABASE_URL, echo=True)

async def get_session() -> AsyncSession:
    async with AsyncSession(engine) as session:
        yield session
```

### Redis

**Purpose**: Caching and queues

**Configuration**:
```bash
REDIS_HOST=localhost
REDIS_PORT=6379
```

**Integration**:
```python
# apps/api/ae_api/cache/redis.py
import redis.asyncio as redis

class RedisClient:
    def __init__(self, host: str, port: int):
        self.client = redis.Redis(host=host, port=port)

    async def get(self, key: str) -> str:
        return await self.client.get(key)

    async def set(self, key: str, value: str, ttl: int = 3600):
        await self.client.setex(key, ttl, value)
```

---

## Environment Variables Summary

```bash
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
STRIPE_WEBHOOK_SECRET=
VERCEL_TOKEN=
NETLIFY_AUTH_TOKEN=

# Safety
E2B_API_KEY=

# Data Sources
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
```

---

*Last Updated: December 2024*
