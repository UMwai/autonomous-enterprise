# MCP Integration Quick Reference

## TL;DR

MCP (Model Context Protocol) provides a standardized way for AI agents to discover and invoke tools. Instead of writing custom wrappers for GitHub, Stripe, Vercel, etc., we use MCP servers that expose tools via a uniform protocol.

**Key Benefits**: Less code, automatic permissions, unified observability, dynamic tool discovery.

---

## File Structure

```
workers/temporal-worker/src/
├── mcp/
│   ├── types.ts              # TypeScript types for MCP
│   ├── servers.config.ts     # Server configurations & permissions
│   ├── manager.ts            # Server lifecycle & tool routing
│   ├── client.ts             # MCP protocol client wrapper
│   ├── permissions.ts        # Permission enforcement logic
│   ├── schemas.ts            # Zod schemas for tool validation
│   └── index.ts              # Public exports
└── temporal/
    └── activities/
        └── mcp/
            ├── stripe.ts     # Stripe activities (MCP-powered)
            ├── github.ts     # GitHub activities (MCP-powered)
            └── vercel.ts     # Vercel activities (MCP-powered)
```

---

## MCP Servers

| Server | Package | Tools | Docs |
|--------|---------|-------|------|
| GitHub | `@modelcontextprotocol/server-github` | PR, issues, repos, code search | [Official](https://github.com/modelcontextprotocol/servers) |
| Stripe | `@stripe/mcp-server` | Products, prices, subscriptions | [Official](https://stripe.com/docs/mcp) |
| Vercel | `@ae/mcp-server-vercel` (custom) | Deployments, projects, domains | Internal |

---

## Quick Start

### 1. Start MCP Manager

MCP manager starts automatically with Temporal worker:

```typescript
// workers/temporal-worker/src/index.ts
import { startMCPManager } from './mcp/manager.js';

const mcpManager = await startMCPManager();
// All configured servers start automatically
```

### 2. List Available Tools

```typescript
import { getMCPManager } from './mcp/manager.js';

const mcpManager = getMCPManager();
const tools = await mcpManager.listTools();

console.log(tools);
// [
//   { name: 'products_create', serverId: 'stripe', description: '...' },
//   { name: 'create_pull_request', serverId: 'github', description: '...' },
//   ...
// ]
```

### 3. Call a Tool

```typescript
const result = await mcpManager.callTool(
  'stripe',              // Server ID
  'products_create',     // Tool name
  {                      // Arguments
    name: 'Pro Plan',
    description: 'Professional tier',
  }
);

console.log(result);
// { id: 'prod_abc123', name: 'Pro Plan', active: true }
```

### 4. Create an Activity

```typescript
// workers/temporal-worker/src/temporal/activities/mcp/stripe.ts

import { getMCPManager } from '../../mcp/manager.js';
import { z } from 'zod';

const ProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
});

export async function createStripeProduct(input: {
  name: string;
  description: string;
}): Promise<{ id: string; name: string; active: boolean }> {
  const mcpManager = getMCPManager();

  const result = await mcpManager.callTool(
    'stripe',
    'products_create',
    input
  );

  return ProductSchema.parse(result);
}
```

---

## Adding a New MCP Server

### Step 1: Install MCP Server

```bash
cd workers/temporal-worker
pnpm add @notion/mcp-server
```

### Step 2: Configure Server

Add to `workers/temporal-worker/src/mcp/servers.config.ts`:

```typescript
{
  id: 'notion',
  name: 'Notion',
  description: 'Notion workspace integration',
  type: 'npm',
  package: '@notion/mcp-server',
  transport: 'stdio',
  env: {
    NOTION_API_KEY: process.env.NOTION_API_KEY || '',
  },
  permissions: {
    allowedAgents: ['langgraph', 'codex'],
    toolPermissions: {
      'create_page': {
        allowed: true,
        budgetLimit: { amount: 3, currency: 'USD' },
      },
      'search': { allowed: true },
      'delete_page': { allowed: false },
    },
    rateLimit: {
      maxCallsPerMinute: 10,
      maxCallsPerHour: 100,
    },
  },
  healthCheck: {
    enabled: true,
    interval: 60000,
    timeout: 5000,
  },
  autoStart: true,
  autoRestart: true,
}
```

### Step 3: Add API Key to .env

```bash
# .env
NOTION_API_KEY=secret_abc123xyz
```

### Step 4: Create Activities

```typescript
// workers/temporal-worker/src/temporal/activities/mcp/notion.ts

import { getMCPManager } from '../../mcp/manager.js';

export async function createNotionPage(input: {
  title: string;
  content: string;
}): Promise<{ id: string; url: string }> {
  const mcpManager = getMCPManager();

  return mcpManager.callTool('notion', 'create_page', input);
}

export async function searchNotion(query: string): Promise<any[]> {
  const mcpManager = getMCPManager();

  return mcpManager.callTool('notion', 'search', { query });
}
```

### Step 5: Export Activities

```typescript
// workers/temporal-worker/src/temporal/activities/index.ts

export * from './mcp/notion.js';
```

### Step 6: Restart Worker

```bash
pnpm dev:worker
```

Done! Notion integration is live.

---

## Permission Policies

### Agent Allowlist

Restrict which agents can use a server:

```typescript
permissions: {
  allowedAgents: ['langgraph', 'codex'], // Claude and Gemini blocked
}
```

### Tool-Level Permissions

Control individual tools:

```typescript
toolPermissions: {
  // Allow without restrictions
  'products_list': { allowed: true },

  // Allow with budget limit
  'products_create': {
    allowed: true,
    budgetLimit: { amount: 5, currency: 'USD' },
  },

  // Allow with approval
  'merge_pull_request': {
    allowed: true,
    requiresApproval: true,
  },

  // Block completely
  'delete_repository': { allowed: false },
}
```

### Rate Limiting

```typescript
rateLimit: {
  maxCallsPerMinute: 20,
  maxCallsPerHour: 200,
}
```

---

## Common Tasks

### Check Server Health

```typescript
const mcpManager = getMCPManager();
const stats = mcpManager.getStats();

console.log(stats);
// {
//   serversRunning: 3,
//   totalTools: 42,
//   serverHealth: [
//     { serverId: 'stripe', healthy: true, uptime: 3600 },
//     { serverId: 'github', healthy: true, uptime: 3600 },
//     { serverId: 'vercel', healthy: true, uptime: 3600 },
//   ]
// }
```

### Restart a Server

```typescript
await mcpManager.restartServer('stripe');
```

### Get Tool Schema

```typescript
const tool = await mcpManager.describeTool('stripe', 'products_create');

console.log(tool.inputSchema);
// {
//   type: 'object',
//   properties: {
//     name: { type: 'string' },
//     description: { type: 'string' },
//     metadata: { type: 'object' },
//   },
//   required: ['name']
// }
```

### Test Permission Denial

```typescript
const agent = {
  type: 'claude' as const,
  runId: 'test-run',
  projectId: 'test-project',
  phase: 'test',
};

// This will throw "Permission denied"
await mcpManager.callTool('stripe', 'products_create', {}, agent);
```

---

## Troubleshooting

### Server Won't Start

**Error**: `Server stripe failed to start`

**Fix**:
1. Check API key is set: `echo $STRIPE_API_KEY`
2. Check package is installed: `pnpm list @stripe/mcp-server`
3. Check server logs: Look for `[MCP:stripe]` in worker output
4. Try manual start: `npx @stripe/mcp-server` (should start on stdio)

### Tool Call Fails

**Error**: `Tool call failed: stripe.products_create`

**Debug**:
1. Check server health: `mcpManager.getStats()`
2. Check permissions: Is agent allowed? Is tool allowed?
3. Check budget: Has budget been exceeded?
4. Check rate limit: Too many calls?
5. Check MCP server logs: `[MCP:stripe]` output

### Permission Denied

**Error**: `Permission denied: claude cannot call stripe.products_create`

**Fix**:
1. Check `allowedAgents` in `servers.config.ts`
2. Add agent type to allowlist if intended
3. Or use a different agent (e.g., LangGraph)

### Rate Limit Exceeded

**Error**: `Rate limit exceeded for stripe`

**Fix**:
1. Wait for rate limit window to reset
2. Increase limits in `servers.config.ts` (if appropriate)
3. Optimize workflow to reduce calls

---

## Testing

### Unit Test: Activity

```typescript
import { createStripeProduct } from '../mcp/stripe.js';

test('createStripeProduct', async () => {
  const result = await createStripeProduct({
    name: 'Test Product',
    description: 'Test',
  });

  expect(result.id).toMatch(/^prod_/);
  expect(result.name).toBe('Test Product');
});
```

### Integration Test: MCP Manager

```typescript
import { getMCPManager } from '../mcp/manager.js';

test('MCP manager', async () => {
  const mcpManager = getMCPManager();

  // List tools
  const tools = await mcpManager.listTools('stripe');
  expect(tools.length).toBeGreaterThan(0);

  // Call tool
  const result = await mcpManager.callTool('stripe', 'products_list', {
    limit: 10,
  });
  expect(result).toBeDefined();
});
```

### Test Permissions

```typescript
test('permission denial', async () => {
  const mcpManager = getMCPManager();
  const agent = { type: 'claude', runId: 'test', projectId: 'test', phase: 'test' };

  await expect(
    mcpManager.callTool('stripe', 'products_create', {}, agent)
  ).rejects.toThrow('Permission denied');
});
```

---

## Monitoring

### Logs

All MCP operations are logged:

```json
{
  "timestamp": "2025-12-24T10:30:00Z",
  "level": "info",
  "message": "[MCP] Tool call",
  "server": "stripe",
  "tool": "products_create",
  "agent": "langgraph",
  "runId": "wf-abc123",
  "duration_ms": 234,
  "success": true
}
```

### Metrics

Key metrics (Prometheus format):

```
mcp_server_health{server="stripe"} = 1
mcp_tool_calls_total{server="stripe",tool="products_create"} = 42
mcp_tool_calls_success{server="stripe",tool="products_create"} = 40
mcp_tool_latency_ms{server="stripe",tool="products_create"} = 234
mcp_permission_denials_total{server="stripe"} = 3
```

### Alerts

Set up alerts for:
- Server crashes: `mcp_server_health == 0`
- High error rate: `rate(mcp_tool_calls_failed[5m]) > 0.05`
- Permission violations: `rate(mcp_permission_denials_total[5m]) > 5`

---

## Best Practices

### 1. Always Validate Outputs

```typescript
import { z } from 'zod';

const ProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
});

const result = await mcpManager.callTool('stripe', 'products_create', input);
return ProductSchema.parse(result); // Throws if invalid
```

### 2. Use Descriptive Activity Names

```typescript
// Good
export async function createStripeProduct(input) { ... }
export async function createStripePriceForProduct(input) { ... }

// Bad
export async function create(input) { ... }
export async function doStripe(input) { ... }
```

### 3. Keep Activities Thin

Activities should be thin wrappers over MCP calls:

```typescript
// Good
export async function createStripeProduct(input) {
  return mcpManager.callTool('stripe', 'products_create', input);
}

// Bad - too much logic
export async function createStripeProduct(input) {
  // 50 lines of business logic
  const result = mcpManager.callTool('stripe', 'products_create', input);
  // 50 more lines
  return result;
}
```

Put business logic in workflows, not activities.

### 4. Start with Permissive Policies, Tighten Gradually

```typescript
// Phase 1: Allow everything, observe usage
toolPermissions: {
  '*': { allowed: true },
}

// Phase 2: Add budget limits based on observed costs
toolPermissions: {
  'products_create': {
    allowed: true,
    budgetLimit: { amount: 10, currency: 'USD' },
  },
}

// Phase 3: Tighten based on production data
toolPermissions: {
  'products_create': {
    allowed: true,
    budgetLimit: { amount: 5, currency: 'USD' },
  },
}
```

### 5. Monitor and Alert

Set up monitoring before going to production:
- Server health checks
- Tool usage metrics
- Error rates
- Permission denials
- Budget consumption

---

## Common Patterns

### Pattern: List-Then-Get

```typescript
// List all products
const products = await mcpManager.callTool('stripe', 'products_list', {
  limit: 100,
});

// Get details for specific product
const product = await mcpManager.callTool('stripe', 'products_retrieve', {
  id: products[0].id,
});
```

### Pattern: Create-Then-Associate

```typescript
// Create product
const product = await mcpManager.callTool('stripe', 'products_create', {
  name: 'Pro Plan',
});

// Create price for product
const price = await mcpManager.callTool('stripe', 'prices_create', {
  product: product.id,
  unit_amount: 2999,
  currency: 'usd',
  recurring: { interval: 'month' },
});
```

### Pattern: Conditional Tool Call

```typescript
const existingProducts = await mcpManager.callTool('stripe', 'products_list', {
  limit: 100,
});

const exists = existingProducts.find(p => p.name === input.name);

if (!exists) {
  return mcpManager.callTool('stripe', 'products_create', input);
} else {
  return exists;
}
```

---

## Environment Variables

Required environment variables:

```bash
# GitHub
GITHUB_TOKEN=ghp_abc123xyz

# Stripe
STRIPE_API_KEY=sk_test_abc123xyz

# Vercel
VERCEL_TOKEN=abc123xyz
VERCEL_ORG_ID=team_abc123
```

Verify:

```bash
echo $GITHUB_TOKEN
echo $STRIPE_API_KEY
echo $VERCEL_TOKEN
```

---

## CLI Commands

```bash
# Start worker (starts MCP servers automatically)
pnpm dev:worker

# Run tests
pnpm test -- mcp

# Run integration tests
pnpm test:integration

# Build
pnpm build

# Lint
pnpm lint
```

---

## Resources

- [MCP Specification](https://modelcontextprotocol.io)
- [MCP SDK Docs](https://github.com/modelcontextprotocol/sdk)
- [Official MCP Servers](https://github.com/modelcontextprotocol/servers)
- [MCP Integration Design](/Users/waiyang/Desktop/repo/autonomous-enterprise/docs/mcp-integration-design.md)
- [MCP Migration Checklist](/Users/waiyang/Desktop/repo/autonomous-enterprise/docs/mcp-migration-checklist.md)
- [Before/After Comparison](/Users/waiyang/Desktop/repo/autonomous-enterprise/docs/mcp-before-after-comparison.md)

---

## Support

Questions? Check:
1. This quick reference
2. Full design doc: `docs/mcp-integration-design.md`
3. Migration checklist: `docs/mcp-migration-checklist.md`
4. Codebase: `workers/temporal-worker/src/mcp/`
5. Tests: `workers/temporal-worker/src/mcp/__tests__/`
