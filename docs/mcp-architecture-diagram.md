# MCP Integration Architecture Diagrams

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    AUTONOMOUS ENTERPRISE                                 │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                  FastAPI Control Plane                           │  │
│  │                  (apps/api/ae_api/)                              │  │
│  │  - REST API endpoints                                            │  │
│  │  - Model routing (3-tier LLM)                                    │  │
│  │  - Safety policies                                               │  │
│  │  - Economy tracking                                              │  │
│  └────────────────────────┬─────────────────────────────────────────┘  │
│                           │                                             │
│                           │ Temporal RPC                                │
│                           ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │              Temporal Worker (TypeScript)                        │  │
│  │              (workers/temporal-worker/src/)                      │  │
│  │                                                                  │  │
│  │  ┌────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │  │
│  │  │   Workflows    │  │   LangGraph     │  │   Activities    │  │  │
│  │  │                │  │   Agents        │  │                 │  │  │
│  │  │  - genesis     │  │                 │  │  - git         │  │  │
│  │  │  - build_ship  │  │  - write_test   │  │  - deploy      │  │  │
│  │  │  - monetize    │  │  - fix_loop     │  │  - stripe      │  │  │
│  │  └────────────────┘  └─────────────────┘  └────────┬────────┘  │  │
│  │                                                     │           │  │
│  │                           ┌─────────────────────────▼────────┐  │  │
│  │                           │   MCP Server Manager             │  │  │
│  │                           │   (NEW LAYER)                    │  │  │
│  │                           │                                  │  │  │
│  │                           │  - Server lifecycle              │  │  │
│  │                           │  - Tool discovery                │  │  │
│  │                           │  - Permission enforcement        │  │  │
│  │                           │  - Credential injection          │  │  │
│  │                           └──────────────┬───────────────────┘  │  │
│  └──────────────────────────────────────────┼──────────────────────┘  │
│                                             │                         │
│                                             │ MCP Protocol (stdio)    │
│                                             ▼                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    MCP Servers (Isolated Processes)              │  │
│  │                                                                  │  │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐     │  │
│  │  │   GitHub     │    │   Stripe     │    │   Vercel     │     │  │
│  │  │   MCP        │    │   MCP        │    │   MCP        │     │  │
│  │  │   Server     │    │   Server     │    │   Server     │     │  │
│  │  │              │    │              │    │              │     │  │
│  │  │  Tools:      │    │  Tools:      │    │  Tools:      │     │  │
│  │  │  - create_pr │    │  - products  │    │  - deploy    │     │  │
│  │  │  - merge_pr  │    │  - prices    │    │  - env_vars  │     │  │
│  │  │  - issues    │    │  - checkout  │    │  - domains   │     │  │
│  │  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘     │  │
│  └─────────┼────────────────────┼────────────────────┼─────────────┘  │
│            │                    │                    │                │
│            │ GitHub API         │ Stripe API         │ Vercel API     │
│            ▼                    ▼                    ▼                │
└─────────────────────────────────────────────────────────────────────────┘
             │                    │                    │
             ▼                    ▼                    ▼
        External APIs       External APIs       External APIs
```

## 2. MCP Manager Internal Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        MCP Server Manager                                │
│                        (workers/temporal-worker/src/mcp/)               │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    Public API                                    │  │
│  │                                                                  │  │
│  │  • start() / stop()                                             │  │
│  │  • listTools(serverId?)                                         │  │
│  │  • describeTool(serverId, toolName)                             │  │
│  │  • callTool(serverId, toolName, args, agent?)                   │  │
│  └────────────────────┬─────────────────────────────────────────────┘  │
│                       │                                                 │
│  ┌────────────────────▼─────────────────────────────────────────────┐  │
│  │              Request Handler & Router                            │  │
│  │                                                                  │  │
│  │  1. Extract agent identity from Temporal context                │  │
│  │  2. Check permissions (allow/deny/approval)                     │  │
│  │  3. Check rate limits                                           │  │
│  │  4. Route to appropriate server client                          │  │
│  │  5. Execute tool call                                           │  │
│  │  6. Track budget/cost                                           │  │
│  │  7. Log (with secret redaction)                                 │  │
│  └────────────────────┬─────────────────────────────────────────────┘  │
│                       │                                                 │
│  ┌────────────────────┴─────────────────────┬───────────────────────┐  │
│  │                                          │                       │  │
│  │  ┌───────────────────┐  ┌───────────────▼─────┐  ┌──────────┐  │  │
│  │  │ Server Lifecycle  │  │ Permission Enforcer  │  │  Tool    │  │  │
│  │  │                   │  │                      │  │ Registry │  │  │
│  │  │ - spawn process   │  │ - policy evaluation  │  │          │  │  │
│  │  │ - health check    │  │ - budget tracking    │  │ Cache of │  │  │
│  │  │ - auto-restart    │  │ - rate limiting      │  │ available│  │  │
│  │  │ - credential      │  │ - approval workflow  │  │ tools    │  │  │
│  │  │   injection       │  │                      │  │          │  │  │
│  │  └───────────────────┘  └──────────────────────┘  └──────────┘  │  │
│  │                                                                  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    Server Instances                              │  │
│  │                                                                  │  │
│  │  Map<serverId, ServerInstance>                                  │  │
│  │  ├─ "github"  → { config, process, client, healthy, uptime }   │  │
│  │  ├─ "stripe"  → { config, process, client, healthy, uptime }   │  │
│  │  └─ "vercel"  → { config, process, client, healthy, uptime }   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    MCP Protocol Clients                          │  │
│  │                                                                  │  │
│  │  Map<serverId, MCPClient>                                       │  │
│  │  ├─ "github"  → MCPClient (stdio transport)                    │  │
│  │  ├─ "stripe"  → MCPClient (stdio transport)                    │  │
│  │  └─ "vercel"  → MCPClient (stdio transport)                    │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## 3. Tool Call Flow with MCP

### Before MCP (Current)

```
┌─────────────┐
│  Workflow   │
│             │
│ "Create     │
│  Stripe     │
│  Product"   │
└──────┬──────┘
       │
       │ Direct function call
       ▼
┌─────────────────────────────────┐
│  Stripe Activity                │
│  (stripe/index.ts)              │
│                                 │
│  1. Read STRIPE_API_KEY from   │
│     process.env                 │
│  2. Create Stripe SDK client   │
│  3. Call stripe.products.create│
│  4. Handle errors              │
│  5. Return result              │
└──────┬──────────────────────────┘
       │
       │ Stripe SDK → HTTP
       ▼
┌─────────────┐
│  Stripe API │
└─────────────┘
```

### After MCP (Target)

```
┌─────────────┐
│  Workflow   │
│             │
│ "Create     │
│  Stripe     │
│  Product"   │
└──────┬──────┘
       │
       │ Direct function call (same signature)
       ▼
┌─────────────────────────────────┐
│  Stripe Activity (MCP-powered)  │
│  (mcp/stripe.ts)                │
│                                 │
│  mcpManager.callTool(           │
│    'stripe',                    │
│    'products_create',           │
│    { name, description }        │
│  )                              │
└──────┬──────────────────────────┘
       │
       │ MCP protocol call
       ▼
┌─────────────────────────────────┐
│  MCP Server Manager             │
│                                 │
│  1. Extract agent identity      │
│  2. Check permissions           │
│     - Agent allowed?            │
│     - Tool allowed?             │
│     - Budget OK?                │
│  3. Check rate limits           │
│  4. Get MCP client for 'stripe'│
│  5. Call tool via MCP protocol  │
│  6. Track cost                  │
│  7. Return result               │
└──────┬──────────────────────────┘
       │
       │ stdio (JSON-RPC)
       ▼
┌─────────────────────────────────┐
│  Stripe MCP Server              │
│  (separate Node.js process)     │
│                                 │
│  1. Receive tool call request   │
│  2. Read STRIPE_API_KEY from    │
│     environment (injected)      │
│  3. Create Stripe SDK client    │
│  4. Execute products.create()   │
│  5. Return result via stdio     │
└──────┬──────────────────────────┘
       │
       │ Stripe SDK → HTTP
       ▼
┌─────────────┐
│  Stripe API │
└─────────────┘
```

## 4. Permission Enforcement Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                      Tool Call Request                                │
│  mcpManager.callTool('stripe', 'products_create', {...}, agent)      │
└────────────────────────┬─────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Step 1: Extract Agent Identity                                      │
│                                                                       │
│  if (!agent) {                                                       │
│    agent = extractFromTemporalContext()                             │
│  }                                                                   │
│                                                                       │
│  → { type: 'langgraph', runId: 'wf-123', projectId: 'proj-456' }   │
└────────────────────────┬─────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Step 2: Check Agent Allowlist                                       │
│                                                                       │
│  allowedAgents = config.permissions.allowedAgents                   │
│  if (!allowedAgents.includes(agent.type)) {                         │
│    return DENY: "Agent type not allowed for this server"           │
│  }                                                                   │
└────────────────────────┬─────────────────────────────────────────────┘
                         │ PASS
                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Step 3: Check Tool Permission                                       │
│                                                                       │
│  toolPerm = config.permissions.toolPermissions['products_create']   │
│  if (!toolPerm.allowed) {                                           │
│    return DENY: "Tool is blocked"                                   │
│  }                                                                   │
└────────────────────────┬─────────────────────────────────────────────┘
                         │ PASS
                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Step 4: Check Budget Limit                                          │
│                                                                       │
│  if (toolPerm.budgetLimit) {                                        │
│    currentSpend = await getBudget(agent.runId)                      │
│    if (currentSpend >= toolPerm.budgetLimit.amount) {              │
│      return DENY: "Budget limit exceeded"                           │
│    }                                                                 │
│  }                                                                   │
└────────────────────────┬─────────────────────────────────────────────┘
                         │ PASS
                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Step 5: Check Rate Limit                                            │
│                                                                       │
│  if (config.permissions.rateLimit) {                                │
│    callsLastMinute = await getRateLimitCount(agent, 'minute')       │
│    if (callsLastMinute >= rateLimit.maxCallsPerMinute) {           │
│      return DENY: "Rate limit exceeded"                             │
│    }                                                                 │
│  }                                                                   │
└────────────────────────┬─────────────────────────────────────────────┘
                         │ PASS
                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Step 6: Check Approval Requirement                                  │
│                                                                       │
│  if (toolPerm.requiresApproval) {                                   │
│    approved = await requestHumanApproval(agent, toolCall)           │
│    if (!approved) {                                                  │
│      return DENY: "Approval denied"                                 │
│    }                                                                 │
│  }                                                                   │
└────────────────────────┬─────────────────────────────────────────────┘
                         │ PASS
                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Step 7: Execute Tool                                                 │
│                                                                       │
│  result = await mcpClient.callTool(toolName, args)                  │
│                                                                       │
│  - Track cost                                                        │
│  - Log execution (with redacted secrets)                            │
│  - Record rate limit counter                                        │
│                                                                       │
│  return result                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

## 5. Server Lifecycle Management

```
┌─────────────────────────────────────────────────────────────────────┐
│                  Worker Startup                                      │
│                                                                      │
│  1. Load MCP server configurations                                  │
│  2. Validate each config                                            │
│  3. Create MCPServerManager instance                                │
│  4. Call manager.start()                                            │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  For each server with autoStart=true:                               │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  startServer(serverId, config)                                 │ │
│  │                                                                 │ │
│  │  1. Spawn process                                              │ │
│  │     - npm: npx -y @stripe/mcp-server                          │ │
│  │     - binary: /path/to/binary                                 │ │
│  │     - Inject env vars (credentials)                           │ │
│  │     - Set stdio pipes                                         │ │
│  │                                                                │ │
│  │  2. Create MCP client                                         │ │
│  │     - Connect via stdio transport                             │ │
│  │     - Handshake protocol                                      │ │
│  │                                                                │ │
│  │  3. Discover tools                                            │ │
│  │     - Call listTools()                                        │ │
│  │     - Cache in tool registry                                  │ │
│  │                                                                │ │
│  │  4. Start health checks (if enabled)                          │ │
│  │     - Periodic ping                                           │ │
│  │     - Auto-restart on failure                                 │ │
│  │                                                                │ │
│  │  5. Mark as running                                           │ │
│  │     - servers.set(serverId, instance)                         │ │
│  │     - clients.set(serverId, mcpClient)                        │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Runtime Operations                                                  │
│                                                                      │
│  • Tool calls routed through manager                                │
│  • Health checks running in background                              │
│  • Metrics collected                                                │
└─────────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Worker Shutdown (SIGINT/SIGTERM)                                   │
│                                                                      │
│  1. Call manager.stop()                                             │
│  2. For each running server:                                        │
│     - Disconnect MCP client                                         │
│     - Send SIGTERM to process                                       │
│     - Wait 5 seconds                                                │
│     - Force SIGKILL if still running                                │
│  3. Clean up resources                                              │
│  4. Exit gracefully                                                 │
└─────────────────────────────────────────────────────────────────────┘
```

## 6. Data Flow: Complete Example

**Scenario**: LangGraph agent creates a Stripe product during monetization workflow

```
┌─────────────────────────────────────────────────────────────────────┐
│  Step 1: Workflow Execution                                         │
│  File: workers/temporal-worker/src/temporal/workflows/monetize.ts  │
│                                                                      │
│  const product = await createStripeProduct({                       │
│    name: 'Pro Plan',                                               │
│    description: 'Professional subscription tier',                  │
│    projectId: input.project_id                                     │
│  });                                                                │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         │ Temporal activity call
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Step 2: MCP-Powered Activity                                       │
│  File: workers/temporal-worker/src/temporal/activities/mcp/stripe.ts│
│                                                                      │
│  export async function createStripeProduct(input) {                │
│    const mcpManager = getMCPManager();                             │
│                                                                      │
│    const result = await mcpManager.callTool(                       │
│      'stripe',                                                      │
│      'products_create',                                            │
│      {                                                              │
│        name: input.name,                                           │
│        description: input.description,                             │
│        metadata: {                                                  │
│          project_id: input.projectId,                              │
│          created_by: 'autonomous-enterprise'                       │
│        }                                                            │
│      }                                                              │
│    );                                                               │
│                                                                      │
│    return ProductSchema.parse(result);                            │
│  }                                                                  │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         │ MCP manager call
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Step 3: Permission Check                                           │
│  File: workers/temporal-worker/src/mcp/manager.ts                  │
│                                                                      │
│  async callTool(serverId, toolName, args, agent?) {               │
│    // Extract agent identity from Temporal context                │
│    const agent = {                                                  │
│      type: 'langgraph',                                            │
│      runId: 'monetize-wf-abc123',                                  │
│      projectId: 'proj-456',                                        │
│      phase: 'setup_billing'                                        │
│    };                                                               │
│                                                                      │
│    // Check permissions                                            │
│    const permitted = await checkPermission(agent, {               │
│      serverId: 'stripe',                                           │
│      toolName: 'products_create',                                  │
│      args                                                           │
│    });                                                              │
│                                                                      │
│    if (!permitted) throw new Error('Permission denied');          │
│                                                                      │
│    // Get MCP client                                               │
│    const client = this.clients.get('stripe');                     │
│                                                                      │
│    // Execute                                                       │
│    return await client.callTool('products_create', args);         │
│  }                                                                  │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         │ JSON-RPC over stdio
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Step 4: MCP Server Execution                                       │
│  Process: Stripe MCP Server (separate Node.js process)            │
│                                                                      │
│  // Server receives JSON-RPC request:                              │
│  {                                                                  │
│    "jsonrpc": "2.0",                                               │
│    "method": "tools/call",                                         │
│    "params": {                                                      │
│      "name": "products_create",                                    │
│      "arguments": {                                                 │
│        "name": "Pro Plan",                                         │
│        "description": "Professional subscription tier",            │
│        "metadata": {                                                │
│          "project_id": "proj-456",                                 │
│          "created_by": "autonomous-enterprise"                     │
│        }                                                            │
│      }                                                              │
│    },                                                               │
│    "id": 1                                                          │
│  }                                                                  │
│                                                                      │
│  // Server executes:                                               │
│  const stripe = new Stripe(process.env.STRIPE_API_KEY);           │
│  const product = await stripe.products.create(params.arguments);  │
│                                                                      │
│  // Server returns:                                                │
│  {                                                                  │
│    "jsonrpc": "2.0",                                               │
│    "result": {                                                      │
│      "id": "prod_abc123",                                          │
│      "name": "Pro Plan",                                           │
│      "active": true                                                │
│    },                                                               │
│    "id": 1                                                          │
│  }                                                                  │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         │ Result flows back
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Step 5: Post-Processing                                            │
│                                                                      │
│  • MCP manager receives result                                     │
│  • Tracks cost/budget                                              │
│  • Logs execution (secrets redacted)                               │
│  • Returns to activity                                             │
│  • Activity validates with Zod schema                              │
│  • Activity returns to workflow                                    │
│  • Workflow continues with product.id                              │
└─────────────────────────────────────────────────────────────────────┘
```

## 7. Monitoring & Observability

```
┌─────────────────────────────────────────────────────────────────────┐
│  Logs (Structured JSON)                                             │
│                                                                      │
│  [MCP] Starting server: stripe                                     │
│  [MCP] Server stripe started with 15 tools                         │
│  [MCP] Tool call: stripe.products_create                           │
│    { server: 'stripe', tool: 'products_create',                    │
│      args: { name: '***', description: '***' },                    │
│      agent: 'langgraph', runId: 'wf-123' }                         │
│  [MCP] Tool call successful: stripe.products_create (234ms)        │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Metrics (Prometheus/OpenTelemetry)                                 │
│                                                                      │
│  mcp_server_health{server="stripe"} = 1                            │
│  mcp_server_uptime_seconds{server="stripe"} = 3600                 │
│  mcp_tool_calls_total{server="stripe",tool="products_create"} = 42 │
│  mcp_tool_calls_success{server="stripe",tool="products_create"} = 40│
│  mcp_tool_calls_failed{server="stripe",tool="products_create"} = 2 │
│  mcp_tool_latency_ms{server="stripe",tool="products_create"} = 234 │
│  mcp_permission_denials_total{server="stripe"} = 3                 │
│  mcp_rate_limit_hits_total{server="stripe"} = 1                    │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Alerts                                                              │
│                                                                      │
│  • Server health check failed → Restart server                     │
│  • Tool error rate > 5% → Notify team                              │
│  • Permission denial spike → Security review                       │
│  • Rate limit exceeded → Scale or throttle                         │
└─────────────────────────────────────────────────────────────────────┘
```
