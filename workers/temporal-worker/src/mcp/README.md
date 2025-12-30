# MCP (Model Context Protocol) Module

Standardized infrastructure for integrating external tools (GitHub, Stripe, Vercel) into Autonomous Enterprise agents.

## Quick Start

```typescript
import { startMCPManager, callMCPTool } from './mcp';

// 1. Start MCP servers (usually done in worker startup)
await startMCPManager();

// 2. Call a tool
const result = await callMCPTool(
  'github',
  'create_pull_request',
  { owner: 'org', repo: 'repo', title: 'feat: New feature', head: 'feature', base: 'main' },
  { type: 'claude', runId: 'wf-123', projectId: 'proj-456', phase: 'build' }
);

console.log(result.success ? result.data : result.error);
```

## Architecture

```
MCPToolBridge          → Unified API with permissions, budget, retry
    ↓
MCPServerManager       → Manages server lifecycle, health, registry
    ↓
MCPClient (per server) → JSON-RPC protocol, stdio/SSE transport
    ↓
MCP Servers            → External processes (GitHub, Stripe, Vercel)
```

## Core Components

### 1. MCPClient (`client.ts`)

Low-level client for a single MCP server.

```typescript
const client = new MCPClient(serverConfig);
await client.connect();

const tools = await client.listTools();
const result = await client.callTool('tool_name', { arg: 'value' });

await client.disconnect();
```

**Features**:
- stdio and SSE transport
- JSON-RPC 2.0 protocol
- Automatic timeout handling
- Process lifecycle management

### 2. MCPServerManager (`serverManager.ts`)

Manages multiple MCP server instances.

```typescript
import { getMCPManager } from './mcp';

const manager = getMCPManager();
await manager.start(); // Start all auto-start servers

// Server operations
await manager.startServer('github');
await manager.stopServer('github');
await manager.restartServer('github');

// Tool discovery
const allTools = manager.listTools();
const githubTools = manager.listTools('github');
const tool = manager.getTool('github', 'create_pull_request');

// Health monitoring
const health = manager.getServerHealth('github');
const stats = manager.getStats();
```

**Features**:
- Auto-start/stop lifecycle
- Health checks with auto-restart
- Tool registry and discovery
- Statistics tracking

### 3. MCPToolBridge (`toolBridge.ts`)

High-level API for calling tools with safety checks.

```typescript
import { getMCPToolBridge } from './mcp';

const bridge = getMCPToolBridge();

const result = await bridge.callTool(
  'stripe',
  'products_create',
  { name: 'Pro Plan', description: 'Professional tier' },
  agentIdentity
);
```

**Features**:
- Permission checking (agent allowlist, tool allowlist)
- Budget tracking and enforcement
- Automatic retry with exponential backoff
- Secret redaction in logs
- Statistics recording

### 4. Permissions (`permissions.ts`)

Multi-layer permission enforcement.

```typescript
import { checkPermissionDetailed, enforcePermission } from './mcp';

// Check permission (returns detailed result)
const result = await checkPermissionDetailed(agentIdentity, toolCall);
console.log(`Allowed: ${result.allowed}, Requires approval: ${result.requiresApproval}`);

// Enforce permission (throws if denied)
await enforcePermission(agentIdentity, toolCall);
```

**Permission Layers**:
1. Agent allowlist (claude/gemini/codex/langgraph)
2. Tool allowlist (per-tool allow/block)
3. Budget limits (spending caps)
4. Rate limits (calls per minute/hour)
5. Approval requirements (human-in-the-loop)
6. Custom policies (domain-specific rules)

## Configuration

### Server Config (`servers.config.ts`)

```typescript
{
  id: 'github',
  name: 'GitHub',
  type: 'npm',
  package: '@modelcontextprotocol/server-github',
  transport: 'stdio',
  env: {
    GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
  },
  permissions: {
    allowedAgents: ['claude', 'gemini', 'codex', 'langgraph'],
    toolPermissions: {
      'create_pull_request': {
        allowed: true,
        budgetLimit: { amount: 2, currency: 'USD' },
      },
      'merge_pull_request': {
        allowed: true,
        requiresApproval: true,
      },
      'delete_repository': {
        allowed: false,
      },
    },
    rateLimit: {
      maxCallsPerMinute: 30,
      maxCallsPerHour: 500,
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

## Integration with Safety Module

### Budget Tracking

```typescript
// Budget tracking happens automatically in MCPToolBridge
const result = await callMCPTool('stripe', 'products_create', args, agentIdentity);
// Budget automatically tracked via BudgetClient
```

### Approval Workflow

```typescript
// Tools marked with requiresApproval: true automatically request approval
const result = await callMCPTool('github', 'merge_pull_request', args, agentIdentity);
// If requiresApproval is set, human approval requested via ApprovalClient
```

## Error Handling

### Tool Call Results

```typescript
const result = await callMCPTool('github', 'create_pr', args, agent);

if (result.success) {
  console.log('Success:', result.data);
  console.log('Execution time:', result.executionTime, 'ms');
  if (result.cost) {
    console.log('Cost:', result.cost.amount, result.cost.currency);
  }
} else {
  console.error('Failed:', result.error);
  console.log('Execution time:', result.executionTime, 'ms');
}
```

### Automatic Retry

The tool bridge automatically retries on transient errors:
- Timeout errors
- Network errors
- Connection errors
- Rate limit errors (with backoff)

```typescript
// Retry logic with exponential backoff
// Attempt 0: immediate
// Attempt 1: 1s delay
// Attempt 2: 2s delay
// Attempt 3: 4s delay (max 3 retries)
```

## Health Monitoring

### Server Health

```typescript
const health = manager.getServerHealth('github');

console.log({
  serverId: health.serverId,
  healthy: health.healthy,
  uptime: health.uptime,
  restartCount: health.restartCount,
  toolCount: health.toolCount,
  lastError: health.lastError,
});
```

### Statistics

```typescript
const stats = manager.getStats();

console.log({
  serversRunning: stats.serversRunning,
  totalTools: stats.totalTools,
  toolCallsTotal: stats.toolCallsTotal,
  toolCallsSuccess: stats.toolCallsSuccess,
  toolCallsFailed: stats.toolCallsFailed,
  averageLatency: stats.averageLatency,
});
```

## Adding a New MCP Server

1. **Install the MCP server package**:
   ```bash
   pnpm add @modelcontextprotocol/server-your-service
   ```

2. **Add configuration** in `servers.config.ts`:
   ```typescript
   {
     id: 'your-service',
     name: 'Your Service',
     type: 'npm',
     package: '@modelcontextprotocol/server-your-service',
     transport: 'stdio',
     env: {
       YOUR_SERVICE_API_KEY: process.env.YOUR_SERVICE_API_KEY || '',
     },
     permissions: {
       allowedAgents: ['langgraph'],
       toolPermissions: {
         'your_tool': { allowed: true },
       },
     },
     autoStart: true,
     autoRestart: true,
   }
   ```

3. **Restart the worker**:
   ```bash
   pnpm dev:worker
   ```

4. **Use the tools**:
   ```typescript
   const result = await callMCPTool('your-service', 'your_tool', args, agent);
   ```

## Security Best Practices

### Credentials
- Always inject via environment variables
- Never hardcode in configs
- Use different credentials per environment

### Permissions
- Start with restrictive permissions
- Use `allowedAgents` to limit agent types
- Block destructive operations by default
- Require approval for sensitive operations
- Set budget limits on expensive operations

### Rate Limiting
- Set conservative rate limits initially
- Monitor actual usage patterns
- Adjust based on API provider limits

### Logging
- Secret redaction is automatic
- Review logs for sensitive data
- Use structured logging (Pino)

## Troubleshooting

### Server won't start

```typescript
// Check server config
const config = getServerConfig('github');
const errors = validateServerConfig(config);
console.log('Config errors:', errors);

// Check credentials
console.log('GITHUB_TOKEN set:', !!process.env.GITHUB_TOKEN);

// Try manual start
const manager = getMCPManager();
try {
  await manager.startServer('github');
} catch (error) {
  console.error('Start failed:', error);
}
```

### Tool call fails

```typescript
// Check if server is running
console.log('Server running:', manager.isServerRunning('github'));
console.log('Server healthy:', manager.isServerHealthy('github'));

// Check permissions
const result = await checkPermissionDetailed(agent, toolCall);
console.log('Permission:', result);

// Check budget
const budgetClient = new BudgetClient();
const status = await budgetClient.getStatus(agent.runId);
console.log('Budget:', status);
```

### Server keeps restarting

```typescript
// Check health
const health = manager.getServerHealth('github');
console.log('Restart count:', health.restartCount);
console.log('Last error:', health.lastError);

// Disable auto-restart temporarily
const config = getServerConfig('github');
config.autoRestart = false;
await manager.restartServer('github');
```

## Testing

### Unit Tests

```typescript
import { describe, it, expect } from 'vitest';
import { MCPServerManager } from './serverManager';

describe('MCPServerManager', () => {
  it('should start servers', async () => {
    const manager = new MCPServerManager();
    await manager.start();
    expect(manager.getServerIds().length).toBeGreaterThan(0);
    await manager.stop();
  });
});
```

### Integration Tests

```typescript
import { startMCPManager, callMCPTool } from './mcp';

describe('MCP Integration', () => {
  beforeAll(async () => {
    await startMCPManager();
  });

  afterAll(async () => {
    await stopMCPManager();
  });

  it('should call GitHub tool', async () => {
    const result = await callMCPTool(
      'github',
      'search_repositories',
      { query: 'autonomous-enterprise' },
      agent
    );
    expect(result.success).toBe(true);
  });
});
```

## Performance

### Typical Latency
- Server spawn: ~100-200ms (one-time, at startup)
- IPC overhead: ~1-5ms per call
- Tool execution: Varies by API (GitHub: ~100-500ms, Stripe: ~200-1000ms)

### Resource Usage
- Memory per server: ~50-100 MB
- CPU: <1% when idle
- File descriptors: 2-3 per server

### Optimization Tips
- Keep servers running (don't spawn per-request)
- Use auto-restart for resilience
- Set appropriate timeouts
- Monitor and tune rate limits

## Events

The manager emits events for monitoring:

```typescript
manager.on('started', (data) => {
  console.log('Manager started:', data.serversRunning);
});

manager.on('server:started', (data) => {
  console.log('Server started:', data.serverId, data.toolCount);
});

manager.on('server:unhealthy', (data) => {
  console.log('Server unhealthy:', data.serverId, data.error);
});

manager.on('server:error', (data) => {
  console.error('Server error:', data.serverId, data.error);
});
```

## Migration Guide

See `/docs/mcp-migration-checklist.md` for the full migration plan from custom API wrappers to MCP.

## References

- [MCP Specification](https://modelcontextprotocol.io/)
- [MCP SDK Documentation](https://github.com/modelcontextprotocol/sdk)
- [Design Document](/docs/mcp-integration-design.md)
- [Migration Checklist](/docs/mcp-migration-checklist.md)
- [Implementation Summary](/MCP_PHASE1_IMPLEMENTATION.md)
