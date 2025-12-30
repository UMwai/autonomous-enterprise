# MCP Integration Design for Autonomous Enterprise

## Executive Summary

This document outlines the integration of Model Context Protocol (MCP) into Autonomous Enterprise, replacing custom API wrappers with standardized, discoverable tool interfaces. MCP provides a uniform protocol for AI agents to discover and invoke tools across GitHub, Stripe, Vercel, and other services.

## Architecture Overview

### Current State

```
┌─────────────────────────────────────────────────┐
│  Temporal Activities                            │
│  - Custom Stripe SDK wrapper                    │
│  - Custom Vercel HTTP client                    │
│  - Custom GitHub CLI wrapper                    │
│  - Direct API calls with manual auth            │
└─────────────────────────────────────────────────┘
                     ▲
                     │ Direct function calls
┌────────────────────▼────────────────────────────┐
│  LangGraph / CLI Agents                         │
│  - Hard-coded activity references               │
│  - No dynamic tool discovery                    │
└─────────────────────────────────────────────────┘
```

### Target State with MCP

```
┌─────────────────────────────────────────────────┐
│  Temporal Activities (MCP Clients)              │
│  - Invoke tools via MCP protocol                │
│  - Dynamic tool discovery                       │
│  - Standardized error handling                  │
└────────────────────┬────────────────────────────┘
                     │ MCP Protocol (stdio/SSE)
┌────────────────────▼────────────────────────────┐
│  MCP Server Manager                             │
│  - Lifecycle management                         │
│  - Credential injection                         │
│  - Tool registry & discovery                    │
│  - Permission enforcement                       │
└────────────────────┬────────────────────────────┘
                     │ Spawns & manages
┌────────────────────▼────────────────────────────┐
│  MCP Servers (One per Integration)              │
│  ┌─────────────┬─────────────┬─────────────┐   │
│  │   GitHub    │   Stripe    │   Vercel    │   │
│  │   MCP       │   MCP       │   MCP       │   │
│  │   Server    │   Server    │   Server    │   │
│  └─────────────┴─────────────┴─────────────┘   │
└─────────────────────────────────────────────────┘
```

## MCP Server Selection

### 1. GitHub Integration

**Official MCP Server**: `@modelcontextprotocol/server-github`

**Capabilities**:
- Create/update/delete files
- Search code/issues/repositories
- Create/update/merge pull requests
- Manage issues and comments
- List branches, commits, pull requests
- Get file contents

**Tool Examples**:
```typescript
// Current approach
await execa('gh', ['pr', 'create', '--title', title]);

// MCP approach
await mcpClient.callTool('github', 'create_pull_request', {
  owner: 'UMWai',
  repo: 'my-project',
  title: 'feat: Add new feature',
  head: 'feature-branch',
  base: 'main',
  body: 'PR description'
});
```

**Replacement Scope**:
- `workers/temporal-worker/src/temporal/activities/git/index.ts` (partial)
- GitHub API calls in workflows

### 2. Stripe Integration

**Official MCP Server**: `@stripe/mcp-server`

**Capabilities**:
- Create products and prices
- Create payment links
- Create checkout sessions
- Manage customers
- Retrieve subscriptions
- Generate revenue metrics

**Tool Examples**:
```typescript
// Current approach
const stripe = new Stripe(apiKey);
await stripe.products.create({ name, description });

// MCP approach
await mcpClient.callTool('stripe', 'products_create', {
  name: 'Pro Plan',
  description: 'Professional tier subscription'
});
```

**Replacement Scope**:
- `workers/temporal-worker/src/temporal/activities/stripe/index.ts` (complete)

### 3. Vercel Integration

**Community MCP Server**: Create custom server based on Vercel API

**Required Tools**:
- `create_deployment`: Deploy project from directory
- `get_deployment_status`: Poll deployment state
- `set_env_vars`: Configure environment variables
- `create_project`: Initialize Vercel project
- `link_domain`: Connect custom domain

**Replacement Scope**:
- `workers/temporal-worker/src/temporal/activities/deploy/index.ts` (Vercel portions)

### 4. File System Integration

**Built-in**: Already available in Claude Code CLI via native tools

**Note**: No additional server needed; agents already have Read/Write/Edit tools.

## Detailed Design

### 1. MCP Server Manager

Central service for managing MCP server lifecycle and routing tool calls.

**File**: `workers/temporal-worker/src/mcp/manager.ts`

**Responsibilities**:
- Start/stop MCP servers
- Maintain server registry
- Route tool calls to appropriate servers
- Handle credential injection
- Implement permission policies
- Provide tool discovery API

**Interface**:
```typescript
interface MCPServerManager {
  // Lifecycle
  startServer(serverId: string, config: MCPServerConfig): Promise<void>;
  stopServer(serverId: string): Promise<void>;
  restartServer(serverId: string): Promise<void>;

  // Tool discovery
  listTools(serverId?: string): Promise<Tool[]>;
  describeTool(serverId: string, toolName: string): Promise<ToolSchema>;

  // Tool execution
  callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown>;

  // Permission enforcement
  checkPermission(agent: AgentIdentity, tool: ToolCall): Promise<boolean>;
}
```

### 2. MCP Server Configurations

**File**: `workers/temporal-worker/src/mcp/servers.config.ts`

Each MCP server has:
- Server binary/package reference
- Environment variables (credentials)
- Allowed tools (whitelist)
- Permission policies
- Health check configuration

**Configuration Schema**:
```typescript
interface MCPServerConfig {
  id: string;
  name: string;
  description: string;
  type: 'npm' | 'python' | 'binary';
  package?: string;           // npm package name
  binary?: string;            // Path to binary
  args?: string[];            // CLI arguments
  env: Record<string, string>; // Environment variables
  transport: 'stdio' | 'sse';
  permissions: PermissionPolicy;
  healthCheck?: {
    enabled: boolean;
    interval: number;
    timeout: number;
  };
  autoStart?: boolean;
}

interface PermissionPolicy {
  // Which agents can use this server
  allowedAgents: ('claude' | 'gemini' | 'codex' | 'langgraph')[];

  // Tool-level restrictions
  toolPermissions: {
    [toolName: string]: {
      allowed: boolean;
      requiresApproval?: boolean;
      budgetLimit?: { amount: number; currency: string };
    };
  };

  // Rate limiting
  rateLimit?: {
    maxCallsPerMinute: number;
    maxCallsPerHour: number;
  };
}
```

### 3. MCP Client Wrapper

**File**: `workers/temporal-worker/src/mcp/client.ts`

Wraps the MCP protocol client with Temporal-friendly error handling and retries.

**Key Features**:
- Automatic reconnection
- Request/response logging for Temporal
- Type-safe tool calls via Zod schemas
- Integration with safety module (budget tracking)

### 4. Temporal Activity Adapters

Bridge between Temporal activities and MCP tools.

**Pattern**:
```typescript
// Old activity (direct implementation)
export async function createStripeProduct(input: {
  name: string;
  description: string;
}): Promise<{ id: string }> {
  const stripe = getStripeClient();
  return stripe.products.create(input);
}

// New activity (MCP-powered)
export async function createStripeProduct(input: {
  name: string;
  description: string;
}): Promise<{ id: string }> {
  const mcpManager = getMCPManager();
  return mcpManager.callTool('stripe', 'products_create', input);
}
```

**Benefits**:
- Same function signature (backward compatible)
- Activities become thin wrappers
- MCP handles auth, retries, serialization
- Easy to swap implementations

## Implementation Files

### Core MCP Infrastructure

#### 1. MCP Server Manager

**File**: `workers/temporal-worker/src/mcp/manager.ts`

- Server lifecycle management
- Process spawning (stdio transport)
- Tool registry and discovery
- Permission enforcement
- Health monitoring

#### 2. Server Configurations

**File**: `workers/temporal-worker/src/mcp/servers.config.ts`

- GitHub server config
- Stripe server config
- Vercel server config
- Permission policies per integration

#### 3. MCP Client

**File**: `workers/temporal-worker/src/mcp/client.ts`

- MCP protocol client wrapper
- Request/response handling
- Type safety with Zod
- Error mapping for Temporal

#### 4. Tool Schemas

**File**: `workers/temporal-worker/src/mcp/schemas.ts`

- Zod schemas for each tool
- Input validation
- Output parsing
- Type inference

#### 5. Permission Enforcer

**File**: `workers/temporal-worker/src/mcp/permissions.ts`

- Policy evaluation
- Agent identity extraction
- Budget checking
- Approval workflow integration

### MCP-Powered Activities

#### 6. GitHub Activities

**File**: `workers/temporal-worker/src/temporal/activities/mcp/github.ts`

- Create PR
- Merge PR
- Create issue
- Comment on PR/issue
- Get file contents
- Search code

#### 7. Stripe Activities

**File**: `workers/temporal-worker/src/temporal/activities/mcp/stripe.ts`

- Create product
- Create price
- Create payment link
- Create customer
- Create checkout session
- Get subscription status

#### 8. Vercel Activities

**File**: `workers/temporal-worker/src/temporal/activities/mcp/vercel.ts`

- Create deployment
- Get deployment status
- Set environment variables
- Link domain

### Custom MCP Servers

#### 9. Vercel MCP Server

**Directory**: `workers/mcp-servers/vercel/`

**Files**:
- `src/index.ts`: Server entry point
- `src/tools.ts`: Tool definitions
- `src/vercel-client.ts`: Vercel API wrapper
- `package.json`: Dependencies and build config

**Tools**:
- `create_deployment`
- `get_deployment_status`
- `set_env_vars`
- `create_project`
- `link_domain`
- `get_project_info`

## Security Architecture

### Credential Management

**Environment-based injection**:
```typescript
// MCP server receives credentials via environment
const serverConfig: MCPServerConfig = {
  id: 'github',
  package: '@modelcontextprotocol/server-github',
  env: {
    GITHUB_TOKEN: process.env.GITHUB_TOKEN!,
  },
  // Server process is isolated, credentials never exposed to agents
};
```

**Secrets redaction**:
```typescript
// Safety module integration
import { redactSecrets } from '../safety/redaction.js';

async function callTool(server: string, tool: string, args: unknown) {
  const safeArgs = redactSecrets(args);
  logger.info('Tool call', { server, tool, args: safeArgs });

  // Actual call uses original args
  const result = await mcpClient.call(server, tool, args);
  return result;
}
```

### Permission Policies

**Tool-level restrictions**:
```typescript
const stripePermissions: PermissionPolicy = {
  allowedAgents: ['langgraph', 'codex'],
  toolPermissions: {
    // Read operations: unrestricted
    'products_list': { allowed: true },
    'subscriptions_retrieve': { allowed: true },

    // Write operations: budget-limited
    'products_create': {
      allowed: true,
      budgetLimit: { amount: 5, currency: 'USD' },
    },

    // Destructive operations: require approval
    'products_delete': {
      allowed: true,
      requiresApproval: true,
    },

    // Billing operations: restricted
    'charges_create': { allowed: false },
  },
};
```

**Agent identity extraction**:
```typescript
interface AgentIdentity {
  type: 'claude' | 'gemini' | 'codex' | 'langgraph';
  runId: string;
  projectId: string;
  phase: string;
}

function extractAgentIdentity(): AgentIdentity {
  const context = Context.current(); // Temporal activity context
  return {
    type: context.info.activityType.includes('claude') ? 'claude' : 'langgraph',
    runId: context.info.workflowExecution.workflowId,
    projectId: context.heartbeat.details?.projectId,
    phase: context.heartbeat.details?.phase,
  };
}
```

### Rate Limiting

**Per-agent rate limits**:
```typescript
const githubPermissions: PermissionPolicy = {
  allowedAgents: ['claude', 'gemini', 'codex'],
  rateLimit: {
    maxCallsPerMinute: 30,
    maxCallsPerHour: 500,
  },
};
```

## Migration Strategy

### Phase 1: Infrastructure Setup (Week 1)

**Tasks**:
1. Install MCP dependencies
2. Implement MCP server manager
3. Create server configurations
4. Build MCP client wrapper
5. Add permission enforcer

**Deliverables**:
- `workers/temporal-worker/src/mcp/` module
- MCP servers can be started/stopped
- Tool discovery works
- Permission policies enforceable

**Success Criteria**:
- `npm run mcp:start` launches all servers
- `npm run mcp:list-tools` shows available tools
- Unit tests pass for manager, client, permissions

### Phase 2: Stripe Migration (Week 2)

**Scope**: Replace `workers/temporal-worker/src/temporal/activities/stripe/index.ts`

**Tasks**:
1. Install `@stripe/mcp-server`
2. Configure Stripe MCP server
3. Create MCP-based Stripe activities
4. Update workflows to use new activities
5. Add integration tests
6. Deprecate old activities

**Migration Checklist**:
- [ ] MCP server config for Stripe
- [ ] `createStripeProduct` via MCP
- [ ] `createStripePrices` via MCP
- [ ] `generatePaymentLink` via MCP
- [ ] `createCheckoutSession` via MCP
- [ ] `createCustomer` via MCP
- [ ] `getSubscriptionStatus` via MCP
- [ ] `getRevenueMetrics` via MCP
- [ ] Integration tests pass
- [ ] Old Stripe activities removed

**Validation**:
```bash
# Test MCP Stripe integration
pnpm test:integration -- stripe-mcp

# Run monetize workflow end-to-end
pnpm test:workflow -- monetize
```

### Phase 3: GitHub Migration (Week 3)

**Scope**: Replace portions of `workers/temporal-worker/src/temporal/activities/git/index.ts`

**Tasks**:
1. Install `@modelcontextprotocol/server-github`
2. Configure GitHub MCP server
3. Migrate GitHub operations to MCP tools
4. Keep local git operations (clone, commit, push) as-is
5. Update workflows
6. Integration tests

**Note**: Local git operations (via `execa('git', ...)`) stay as-is. Only GitHub API calls migrate to MCP.

**Migration Checklist**:
- [ ] MCP server config for GitHub
- [ ] Create PR via `create_pull_request` tool
- [ ] Merge PR via `merge_pull_request` tool
- [ ] Create issue via `create_issue` tool
- [ ] Get file contents via `get_file_contents` tool
- [ ] Search code via `search_code` tool
- [ ] Integration tests pass
- [ ] Old GitHub API calls removed

### Phase 4: Vercel Migration (Week 4)

**Scope**: Replace `workers/temporal-worker/src/temporal/activities/deploy/index.ts` (Vercel portions)

**Tasks**:
1. Implement custom Vercel MCP server
2. Package and publish to npm (or use local)
3. Configure Vercel MCP server
4. Migrate deployment activities
5. Update build_ship workflow
6. Integration tests
7. End-to-end deployment test

**Custom Server Development**:
```bash
# Create Vercel MCP server
mkdir -p workers/mcp-servers/vercel
cd workers/mcp-servers/vercel
npm init -y
npm install @modelcontextprotocol/sdk vercel zod
```

**Migration Checklist**:
- [ ] Vercel MCP server implemented
- [ ] `create_deployment` tool
- [ ] `get_deployment_status` tool
- [ ] `set_env_vars` tool
- [ ] `create_project` tool
- [ ] MCP server config for Vercel
- [ ] `deployToVercel` via MCP
- [ ] `getDeploymentStatus` via MCP
- [ ] `setVercelEnvVars` via MCP
- [ ] Integration tests pass
- [ ] Old Vercel HTTP client removed

### Phase 5: Agent Integration (Week 5)

**Scope**: Expose MCP tools to CLI agents (Claude Code, Gemini CLI, Codex)

**Tasks**:
1. Add MCP tool discovery to agent harness
2. Inject MCP tools into agent context
3. Update prompts to reference available tools
4. Test agents using MCP tools in LangGraph loops
5. Document agent + MCP integration

**Agent Enhancement**:
```typescript
// workers/temporal-worker/src/temporal/activities/cli/harness.ts

async function runAgent(prompt: string, workspace: string) {
  const mcpManager = getMCPManager();

  // Discover available tools
  const tools = await mcpManager.listTools();

  // Enhance prompt with tool discovery
  const enhancedPrompt = `
${prompt}

## Available MCP Tools

You have access to the following external tools:

${tools.map(t => `- ${t.name}: ${t.description}`).join('\n')}

To use a tool, request it and I will invoke it via MCP.
`;

  return claudeAdapter.run(enhancedPrompt, workspace);
}
```

### Phase 6: Documentation & Cleanup (Week 6)

**Tasks**:
1. Document MCP architecture in `docs/mcp-integration.md`
2. Update CLAUDE.md with MCP references
3. Create runbook for adding new MCP servers
4. Clean up deprecated code
5. Final integration testing
6. Performance benchmarking

**Documentation**:
- Architecture diagrams
- MCP server configurations
- Permission policies
- Troubleshooting guide
- Performance characteristics

## Code Examples

### Example 1: Current vs MCP - Stripe Product Creation

**Current Implementation** (`workers/temporal-worker/src/temporal/activities/stripe/index.ts`):
```typescript
import Stripe from 'stripe';

export async function createStripeProduct(input: {
  name: string;
  description: string;
  projectId?: string;
}): Promise<{ id: string; name: string; active: boolean }> {
  const apiKey = process.env.STRIPE_API_KEY;
  if (!apiKey) {
    throw new Error('STRIPE_API_KEY not set');
  }

  const stripe = new Stripe(apiKey, { apiVersion: '2025-02-24.acacia' });

  const product = await stripe.products.create({
    name: input.name,
    description: input.description,
    metadata: {
      project_id: input.projectId || '',
      created_by: 'autonomous-enterprise',
    },
  });

  return {
    id: product.id,
    name: product.name,
    active: product.active,
  };
}
```

**MCP Implementation** (`workers/temporal-worker/src/temporal/activities/mcp/stripe.ts`):
```typescript
import { getMCPManager } from '../../mcp/manager.js';
import { z } from 'zod';

// Zod schema for type safety
const ProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
});

export async function createStripeProduct(input: {
  name: string;
  description: string;
  projectId?: string;
}): Promise<{ id: string; name: string; active: boolean }> {
  const mcpManager = getMCPManager();

  // Call via MCP (server handles auth internally)
  const result = await mcpManager.callTool('stripe', 'products_create', {
    name: input.name,
    description: input.description,
    metadata: {
      project_id: input.projectId || '',
      created_by: 'autonomous-enterprise',
    },
  });

  // Validate and parse response
  return ProductSchema.parse(result);
}
```

**Benefits**:
- No API key handling in activity
- Automatic retry via MCP
- Type safety with Zod
- Centralized credential management
- Permission policies enforced

### Example 2: MCP Server Configuration

**File**: `workers/temporal-worker/src/mcp/servers.config.ts`

```typescript
import type { MCPServerConfig } from './types.js';

export const MCP_SERVERS: MCPServerConfig[] = [
  // GitHub
  {
    id: 'github',
    name: 'GitHub',
    description: 'GitHub API integration for PRs, issues, repos',
    type: 'npm',
    package: '@modelcontextprotocol/server-github',
    transport: 'stdio',
    env: {
      GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
    },
    permissions: {
      allowedAgents: ['claude', 'gemini', 'codex', 'langgraph'],
      toolPermissions: {
        // Read operations: unrestricted
        'search_repositories': { allowed: true },
        'get_file_contents': { allowed: true },
        'list_commits': { allowed: true },

        // Write operations: restricted
        'create_pull_request': {
          allowed: true,
          budgetLimit: { amount: 2, currency: 'USD' },
        },
        'merge_pull_request': {
          allowed: true,
          requiresApproval: true,
        },

        // Destructive operations: blocked
        'delete_repository': { allowed: false },
      },
      rateLimit: {
        maxCallsPerMinute: 30,
        maxCallsPerHour: 500,
      },
    },
    healthCheck: {
      enabled: true,
      interval: 60000, // 1 minute
      timeout: 5000,
    },
    autoStart: true,
  },

  // Stripe
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Stripe payment and subscription management',
    type: 'npm',
    package: '@stripe/mcp-server',
    transport: 'stdio',
    env: {
      STRIPE_API_KEY: process.env.STRIPE_API_KEY || '',
    },
    permissions: {
      allowedAgents: ['langgraph', 'codex'],
      toolPermissions: {
        // Product management
        'products_create': {
          allowed: true,
          budgetLimit: { amount: 5, currency: 'USD' },
        },
        'products_list': { allowed: true },

        // Pricing
        'prices_create': { allowed: true },

        // Customer management
        'customers_create': { allowed: true },
        'customers_retrieve': { allowed: true },

        // Payment links
        'payment_links_create': { allowed: true },

        // Checkout
        'checkout_sessions_create': { allowed: true },

        // Subscriptions
        'subscriptions_retrieve': { allowed: true },

        // Dangerous operations
        'charges_create': { allowed: false },
        'refunds_create': { allowed: false },
      },
      rateLimit: {
        maxCallsPerMinute: 20,
        maxCallsPerHour: 200,
      },
    },
    healthCheck: {
      enabled: true,
      interval: 120000, // 2 minutes
      timeout: 10000,
    },
    autoStart: true,
  },

  // Vercel (custom server)
  {
    id: 'vercel',
    name: 'Vercel',
    description: 'Vercel deployment and hosting',
    type: 'npm',
    package: '@ae/mcp-server-vercel', // Custom package
    transport: 'stdio',
    env: {
      VERCEL_TOKEN: process.env.VERCEL_TOKEN || '',
    },
    permissions: {
      allowedAgents: ['langgraph', 'codex'],
      toolPermissions: {
        'create_deployment': {
          allowed: true,
          budgetLimit: { amount: 10, currency: 'USD' },
        },
        'get_deployment_status': { allowed: true },
        'set_env_vars': { allowed: true },
        'create_project': { allowed: true },
        'link_domain': {
          allowed: true,
          requiresApproval: true,
        },
      },
      rateLimit: {
        maxCallsPerMinute: 10,
        maxCallsPerHour: 100,
      },
    },
    healthCheck: {
      enabled: true,
      interval: 120000,
      timeout: 10000,
    },
    autoStart: true,
  },
];
```

### Example 3: MCP Server Manager Implementation

**File**: `workers/temporal-worker/src/mcp/manager.ts`

```typescript
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { MCPClient } from '@modelcontextprotocol/sdk';
import type { MCPServerConfig, Tool, ToolCall, AgentIdentity } from './types.js';
import { MCP_SERVERS } from './servers.config.js';
import { checkPermission } from './permissions.js';
import { redactSecrets } from '../safety/redaction.js';

export class MCPServerManager extends EventEmitter {
  private servers: Map<string, ServerInstance> = new Map();
  private clients: Map<string, MCPClient> = new Map();
  private toolRegistry: Map<string, Tool[]> = new Map();

  async start(): Promise<void> {
    console.log('[MCP] Starting MCP server manager');

    for (const config of MCP_SERVERS) {
      if (config.autoStart) {
        await this.startServer(config.id, config);
      }
    }

    console.log(`[MCP] Started ${this.servers.size} servers`);
  }

  async stop(): Promise<void> {
    console.log('[MCP] Stopping all MCP servers');

    const stopPromises = Array.from(this.servers.keys()).map(id =>
      this.stopServer(id)
    );

    await Promise.all(stopPromises);
    console.log('[MCP] All servers stopped');
  }

  async startServer(serverId: string, config: MCPServerConfig): Promise<void> {
    if (this.servers.has(serverId)) {
      console.warn(`[MCP] Server ${serverId} already running`);
      return;
    }

    console.log(`[MCP] Starting server: ${serverId}`);

    // Spawn server process
    const process = await this.spawnServer(config);

    // Create MCP client
    const client = new MCPClient({
      transport: config.transport === 'stdio'
        ? { type: 'stdio', process }
        : { type: 'sse', url: config.url! },
    });

    await client.connect();

    // Discover tools
    const tools = await client.listTools();
    this.toolRegistry.set(serverId, tools);

    // Store references
    this.servers.set(serverId, { config, process, healthy: true });
    this.clients.set(serverId, client);

    console.log(`[MCP] Server ${serverId} started with ${tools.length} tools`);

    // Start health checks
    if (config.healthCheck?.enabled) {
      this.startHealthCheck(serverId, config);
    }
  }

  async stopServer(serverId: string): Promise<void> {
    const instance = this.servers.get(serverId);
    if (!instance) return;

    console.log(`[MCP] Stopping server: ${serverId}`);

    // Disconnect client
    const client = this.clients.get(serverId);
    if (client) {
      await client.disconnect();
      this.clients.delete(serverId);
    }

    // Kill process
    if (instance.process) {
      instance.process.kill('SIGTERM');

      // Force kill after 5 seconds
      setTimeout(() => {
        if (instance.process && !instance.process.killed) {
          instance.process.kill('SIGKILL');
        }
      }, 5000);
    }

    this.servers.delete(serverId);
    this.toolRegistry.delete(serverId);

    console.log(`[MCP] Server ${serverId} stopped`);
  }

  async restartServer(serverId: string): Promise<void> {
    const instance = this.servers.get(serverId);
    if (!instance) {
      throw new Error(`Server ${serverId} not found`);
    }

    await this.stopServer(serverId);
    await this.startServer(serverId, instance.config);
  }

  async listTools(serverId?: string): Promise<Tool[]> {
    if (serverId) {
      return this.toolRegistry.get(serverId) || [];
    }

    // Return all tools from all servers
    const allTools: Tool[] = [];
    for (const [id, tools] of this.toolRegistry.entries()) {
      allTools.push(...tools.map(t => ({ ...t, serverId: id })));
    }
    return allTools;
  }

  async describeTool(serverId: string, toolName: string): Promise<Tool | null> {
    const tools = this.toolRegistry.get(serverId);
    return tools?.find(t => t.name === toolName) || null;
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    agentIdentity?: AgentIdentity
  ): Promise<unknown> {
    // Get client
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`MCP server ${serverId} not running`);
    }

    // Check permissions
    const toolCall: ToolCall = { serverId, toolName, args };
    const agent = agentIdentity || this.extractAgentIdentity();

    const permitted = await checkPermission(agent, toolCall);
    if (!permitted) {
      throw new Error(
        `Permission denied: ${agent.type} cannot call ${serverId}.${toolName}`
      );
    }

    // Log (with redacted secrets)
    const safeArgs = redactSecrets(args);
    console.log(`[MCP] Tool call: ${serverId}.${toolName}`, safeArgs);

    // Execute
    try {
      const result = await client.callTool(toolName, args);
      console.log(`[MCP] Tool call successful: ${serverId}.${toolName}`);
      return result;
    } catch (error) {
      console.error(`[MCP] Tool call failed: ${serverId}.${toolName}`, error);
      throw error;
    }
  }

  private async spawnServer(config: MCPServerConfig): Promise<ChildProcess> {
    let command: string;
    let args: string[];

    if (config.type === 'npm') {
      // Use npx to run npm package
      command = 'npx';
      args = ['-y', config.package!, ...(config.args || [])];
    } else if (config.type === 'binary') {
      command = config.binary!;
      args = config.args || [];
    } else {
      throw new Error(`Unsupported server type: ${config.type}`);
    }

    const process = spawn(command, args, {
      env: {
        ...process.env,
        ...config.env,
      },
      stdio: config.transport === 'stdio' ? ['pipe', 'pipe', 'pipe'] : 'ignore',
    });

    // Log output
    process.stdout?.on('data', (data) => {
      console.log(`[MCP:${config.id}] ${data.toString().trim()}`);
    });

    process.stderr?.on('data', (data) => {
      console.error(`[MCP:${config.id}] ${data.toString().trim()}`);
    });

    process.on('exit', (code) => {
      console.warn(`[MCP:${config.id}] Process exited with code ${code}`);
      this.servers.get(config.id)!.healthy = false;

      // Auto-restart if configured
      if (config.autoRestart) {
        setTimeout(() => this.restartServer(config.id), 5000);
      }
    });

    return process;
  }

  private startHealthCheck(serverId: string, config: MCPServerConfig): void {
    const interval = config.healthCheck!.interval;

    setInterval(async () => {
      try {
        const client = this.clients.get(serverId);
        if (!client) return;

        // Simple ping/list tools as health check
        await Promise.race([
          client.listTools(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), config.healthCheck!.timeout)
          ),
        ]);

        // Mark as healthy
        const instance = this.servers.get(serverId);
        if (instance) {
          instance.healthy = true;
        }
      } catch (error) {
        console.error(`[MCP] Health check failed for ${serverId}:`, error);

        // Mark as unhealthy
        const instance = this.servers.get(serverId);
        if (instance) {
          instance.healthy = false;
        }

        // Restart if unhealthy
        this.emit('server:unhealthy', serverId);
        await this.restartServer(serverId);
      }
    }, interval);
  }

  private extractAgentIdentity(): AgentIdentity {
    // Extract from Temporal activity context
    // This is a placeholder - actual implementation would use @temporalio/activity
    return {
      type: 'langgraph',
      runId: 'unknown',
      projectId: 'unknown',
      phase: 'unknown',
    };
  }
}

interface ServerInstance {
  config: MCPServerConfig;
  process?: ChildProcess;
  healthy: boolean;
}

// Singleton instance
let managerInstance: MCPServerManager | null = null;

export function getMCPManager(): MCPServerManager {
  if (!managerInstance) {
    managerInstance = new MCPServerManager();
  }
  return managerInstance;
}

export async function startMCPManager(): Promise<MCPServerManager> {
  const manager = getMCPManager();
  await manager.start();
  return manager;
}

export async function stopMCPManager(): Promise<void> {
  if (managerInstance) {
    await managerInstance.stop();
    managerInstance = null;
  }
}
```

### Example 4: Permission Enforcer

**File**: `workers/temporal-worker/src/mcp/permissions.ts`

```typescript
import type { AgentIdentity, ToolCall, PermissionPolicy } from './types.js';
import { MCP_SERVERS } from './servers.config.js';
import { trackBudget } from '../safety/budgets.js';

export async function checkPermission(
  agent: AgentIdentity,
  toolCall: ToolCall
): Promise<boolean> {
  // Get server config
  const serverConfig = MCP_SERVERS.find(s => s.id === toolCall.serverId);
  if (!serverConfig) {
    console.warn(`[Permissions] Unknown server: ${toolCall.serverId}`);
    return false;
  }

  const policy = serverConfig.permissions;

  // Check if agent is allowed to use this server
  if (!policy.allowedAgents.includes(agent.type)) {
    console.warn(
      `[Permissions] Agent ${agent.type} not allowed to use ${toolCall.serverId}`
    );
    return false;
  }

  // Check tool-specific permissions
  const toolPermission = policy.toolPermissions[toolCall.toolName];

  if (!toolPermission) {
    // Default: allow if not explicitly configured
    return true;
  }

  if (!toolPermission.allowed) {
    console.warn(
      `[Permissions] Tool ${toolCall.toolName} is blocked on ${toolCall.serverId}`
    );
    return false;
  }

  // Check budget limits
  if (toolPermission.budgetLimit) {
    const budgetOk = await checkBudgetLimit(
      agent,
      toolCall,
      toolPermission.budgetLimit
    );
    if (!budgetOk) {
      console.warn(
        `[Permissions] Budget limit exceeded for ${toolCall.toolName}`
      );
      return false;
    }
  }

  // Check approval requirements
  if (toolPermission.requiresApproval) {
    const approved = await requestApproval(agent, toolCall);
    if (!approved) {
      console.warn(
        `[Permissions] Approval denied for ${toolCall.toolName}`
      );
      return false;
    }
  }

  // Check rate limits
  if (policy.rateLimit) {
    const rateLimitOk = await checkRateLimit(agent, toolCall, policy.rateLimit);
    if (!rateLimitOk) {
      console.warn(
        `[Permissions] Rate limit exceeded for ${toolCall.serverId}`
      );
      return false;
    }
  }

  return true;
}

async function checkBudgetLimit(
  agent: AgentIdentity,
  toolCall: ToolCall,
  limit: { amount: number; currency: string }
): Promise<boolean> {
  // Integration with safety/budgets module
  const currentSpend = await trackBudget.getSpend(agent.runId);
  return currentSpend < limit.amount;
}

async function requestApproval(
  agent: AgentIdentity,
  toolCall: ToolCall
): Promise<boolean> {
  // For now, auto-approve in development
  if (process.env.NODE_ENV === 'development') {
    return true;
  }

  // In production, this would:
  // 1. Send approval request to admin dashboard
  // 2. Wait for human approval (with timeout)
  // 3. Return approval status

  console.log(
    `[Permissions] Approval required for ${toolCall.serverId}.${toolCall.toolName}`
  );
  return false; // Default deny
}

async function checkRateLimit(
  agent: AgentIdentity,
  toolCall: ToolCall,
  limit: { maxCallsPerMinute: number; maxCallsPerHour: number }
): Promise<boolean> {
  // Simple in-memory rate limiting (could use Redis in production)
  const key = `${agent.runId}:${toolCall.serverId}`;

  // Check calls in last minute
  const callsLastMinute = await getCallCount(key, 60);
  if (callsLastMinute >= limit.maxCallsPerMinute) {
    return false;
  }

  // Check calls in last hour
  const callsLastHour = await getCallCount(key, 3600);
  if (callsLastHour >= limit.maxCallsPerHour) {
    return false;
  }

  // Record this call
  await recordCall(key);

  return true;
}

// Simple in-memory rate limiting (replace with Redis in production)
const callLog: Map<string, number[]> = new Map();

async function getCallCount(key: string, windowSeconds: number): Promise<number> {
  const now = Date.now();
  const cutoff = now - (windowSeconds * 1000);

  const calls = callLog.get(key) || [];
  return calls.filter(timestamp => timestamp > cutoff).length;
}

async function recordCall(key: string): Promise<void> {
  const now = Date.now();
  const calls = callLog.get(key) || [];
  calls.push(now);

  // Keep only last hour of data
  const oneHourAgo = now - 3600000;
  const recentCalls = calls.filter(t => t > oneHourAgo);

  callLog.set(key, recentCalls);
}
```

## Integration with Existing Systems

### 1. Safety Module Integration

MCP tools integrate with existing safety constraints:

```typescript
// workers/temporal-worker/src/mcp/client.ts

import { trackBudget } from '../safety/budgets.js';
import { redactSecrets } from '../safety/redaction.js';
import { checkPolicy } from '../safety/policyClient.js';

export class MCPClient {
  async callTool(server: string, tool: string, args: unknown): Promise<unknown> {
    // 1. Check safety policy
    const policyResult = await checkPolicy({
      action: `mcp.${server}.${tool}`,
      args,
    });

    if (!policyResult.allowed) {
      throw new Error(`Policy violation: ${policyResult.reason}`);
    }

    // 2. Redact secrets from logs
    const safeArgs = redactSecrets(args);
    console.log(`[MCP] Calling ${server}.${tool}`, safeArgs);

    // 3. Execute tool
    const result = await this.mcpManager.callTool(server, tool, args);

    // 4. Track budget
    if (policyResult.estimatedCost) {
      await trackBudget.record({
        amount: policyResult.estimatedCost,
        currency: 'USD',
        category: `mcp.${server}`,
      });
    }

    return result;
  }
}
```

### 2. Temporal Worker Integration

MCP manager starts/stops with Temporal worker:

```typescript
// workers/temporal-worker/src/index.ts

import { Worker } from '@temporalio/worker';
import { startMCPManager, stopMCPManager } from './mcp/manager.js';

async function main() {
  // Start MCP servers
  const mcpManager = await startMCPManager();
  console.log('[Worker] MCP servers ready');

  // Create Temporal worker
  const worker = await Worker.create({
    workflowsPath: './temporal/workflows',
    activities: await import('./temporal/activities'),
    taskQueue: 'autonomous-enterprise',
  });

  // Shutdown handler
  process.on('SIGINT', async () => {
    console.log('[Worker] Shutting down...');
    await worker.shutdown();
    await stopMCPManager();
    process.exit(0);
  });

  // Start worker
  await worker.run();
}

main().catch(console.error);
```

### 3. LangGraph Integration

MCP tools available in LangGraph agent loops:

```typescript
// workers/temporal-worker/src/langgraph/nodes/tool_executor.ts

import { getMCPManager } from '../../mcp/manager.js';

export async function executeToolNode(state: GraphState): Promise<GraphState> {
  const { toolCalls } = state;
  const results = [];

  const mcpManager = getMCPManager();

  for (const call of toolCalls) {
    // Check if it's an MCP tool
    if (call.toolName.startsWith('mcp.')) {
      const [, serverId, toolName] = call.toolName.split('.');

      const result = await mcpManager.callTool(
        serverId,
        toolName,
        call.args
      );

      results.push({ toolCallId: call.id, result });
    } else {
      // Handle native tools (Bash, Edit, etc.)
      // ...
    }
  }

  return { ...state, toolResults: results };
}
```

## Performance Considerations

### Latency

**MCP overhead**:
- Process spawn: ~100-200ms (one-time)
- IPC (stdio): ~1-5ms per call
- Tool execution: Depends on external API

**Mitigation**:
- Keep servers running (don't spawn per-request)
- Use connection pooling for HTTP-based MCP servers
- Cache tool discovery results

### Resource Usage

**Each MCP server**:
- Memory: ~50-100 MB (Node.js process)
- CPU: Minimal when idle
- File descriptors: 2-3 per server (stdio)

**For 3 servers (GitHub, Stripe, Vercel)**:
- Total memory: ~200-300 MB
- Negligible CPU impact
- Well within limits for production

### Scalability

**Horizontal scaling**:
- Each Temporal worker has its own MCP server manager
- MCP servers are lightweight and can run on same host
- No shared state between workers

**Vertical scaling**:
- Add more MCP servers as needed
- Each server is isolated
- Resource usage scales linearly

## Testing Strategy

### Unit Tests

```typescript
// workers/temporal-worker/src/mcp/__tests__/manager.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MCPServerManager } from '../manager.js';

describe('MCPServerManager', () => {
  let manager: MCPServerManager;

  beforeAll(async () => {
    manager = new MCPServerManager();
    await manager.start();
  });

  afterAll(async () => {
    await manager.stop();
  });

  it('should start all configured servers', async () => {
    const tools = await manager.listTools();
    expect(tools.length).toBeGreaterThan(0);
  });

  it('should call Stripe tool', async () => {
    const result = await manager.callTool('stripe', 'products_list', {
      limit: 10,
    });
    expect(result).toBeDefined();
  });

  it('should enforce permissions', async () => {
    const agent = {
      type: 'claude' as const,
      runId: 'test-run',
      projectId: 'test-project',
      phase: 'test',
    };

    // Blocked tool
    await expect(
      manager.callTool('stripe', 'charges_create', {}, agent)
    ).rejects.toThrow('Permission denied');
  });
});
```

### Integration Tests

```typescript
// workers/temporal-worker/src/mcp/__tests__/integration.test.ts

import { describe, it, expect } from 'vitest';
import { createStripeProduct } from '../temporal/activities/mcp/stripe.js';

describe('MCP Stripe Integration', () => {
  it('should create product via MCP', async () => {
    const product = await createStripeProduct({
      name: 'Test Product',
      description: 'Integration test',
    });

    expect(product.id).toMatch(/^prod_/);
    expect(product.name).toBe('Test Product');
    expect(product.active).toBe(true);
  });
});
```

## Monitoring & Observability

### Logging

All MCP operations logged with structured format:

```typescript
console.log('[MCP] Tool call', {
  server: 'stripe',
  tool: 'products_create',
  args: { name: 'Pro Plan' },
  agentId: 'claude',
  runId: 'wf-123',
  timestamp: new Date().toISOString(),
});
```

### Metrics

Key metrics to track:
- Tool call latency (by server, by tool)
- Tool call success rate
- Server health status
- Rate limit hits
- Permission denials
- Budget consumption per server

### Alerts

Set up alerts for:
- Server crashes/restarts
- High error rates (>5%)
- Permission violations
- Budget threshold exceeded
- Rate limit exceeded

## Future Enhancements

### 1. Dynamic Server Loading

Allow registering new MCP servers at runtime without restart:

```typescript
await mcpManager.registerServer({
  id: 'airtable',
  package: '@modelcontextprotocol/server-airtable',
  env: { AIRTABLE_API_KEY: process.env.AIRTABLE_API_KEY },
  permissions: { ... },
});
```

### 2. Tool Chaining

Allow agents to chain multiple MCP tools in a single request:

```typescript
// Agent requests
const result = await mcpChain([
  { server: 'github', tool: 'get_file_contents', args: { path: 'README.md' } },
  { server: 'openai', tool: 'analyze_text', args: { text: '{{prev.content}}' } },
  { server: 'github', tool: 'create_issue', args: { title: '{{prev.issues[0]}}' } },
]);
```

### 3. MCP Tool Marketplace

Curated catalog of available MCP servers:

```typescript
// Discover and install from marketplace
await mcpMarketplace.search('database');
// Returns: PostgreSQL, MongoDB, Redis MCP servers

await mcpMarketplace.install('postgres', {
  connectionString: process.env.DATABASE_URL,
});
```

### 4. Agent-Specific Tool Subsets

Different agents see different tool subsets:

```typescript
// Claude only sees read operations
const claudeTools = await mcpManager.listTools('claude');

// Codex sees write operations
const codexTools = await mcpManager.listTools('codex');
```

## Conclusion

MCP integration transforms Autonomous Enterprise's tool usage from hard-coded API wrappers to a dynamic, discoverable, and governed system. Agents gain access to a growing ecosystem of MCP servers while maintaining security through centralized permission policies and budget tracking.

**Key Benefits**:
1. Standardized tool interface across all integrations
2. Dynamic tool discovery for agents
3. Centralized credential management
4. Fine-grained permission control
5. Built-in safety and budget enforcement
6. Easy to add new integrations (just add MCP server config)

**Migration Timeline**: 6 weeks
**Estimated Effort**: ~3-4 developer weeks
**Risk Level**: Low (backward compatible, incremental rollout)
