# MCP Integration Migration Checklist

## Overview

This checklist guides the migration from custom API wrappers to MCP-based tool invocation across all integrations in Autonomous Enterprise.

**Timeline**: 6 weeks
**Effort**: 3-4 developer weeks
**Risk Level**: Low (backward compatible, incremental rollout)

---

## Phase 1: Infrastructure Setup (Week 1)

### 1.1 Install Dependencies

- [ ] Add MCP SDK to package.json
  ```bash
  cd workers/temporal-worker
  pnpm add @modelcontextprotocol/sdk
  ```

- [ ] Add MCP server packages
  ```bash
  pnpm add @modelcontextprotocol/server-github
  pnpm add @stripe/mcp-server
  # Vercel is custom, will be built in Phase 4
  ```

- [ ] Add Zod for schema validation (already present, verify)
  ```bash
  pnpm add zod
  ```

### 1.2 Create MCP Module Structure

- [ ] Create directory: `workers/temporal-worker/src/mcp/`
- [ ] Create file: `workers/temporal-worker/src/mcp/types.ts`
- [ ] Create file: `workers/temporal-worker/src/mcp/servers.config.ts`
- [ ] Create file: `workers/temporal-worker/src/mcp/manager.ts`
- [ ] Create file: `workers/temporal-worker/src/mcp/client.ts`
- [ ] Create file: `workers/temporal-worker/src/mcp/permissions.ts`
- [ ] Create file: `workers/temporal-worker/src/mcp/schemas.ts`
- [ ] Create file: `workers/temporal-worker/src/mcp/index.ts` (exports)

### 1.3 Implement Core Infrastructure

- [ ] Implement `MCPServerManager` class
  - [ ] `start()` / `stop()` lifecycle methods
  - [ ] `startServer()` / `stopServer()` for individual servers
  - [ ] `spawnServer()` process management
  - [ ] `listTools()` tool discovery
  - [ ] `callTool()` execution
  - [ ] Health check loop
  - [ ] Auto-restart logic

- [ ] Implement `PermissionEnforcer`
  - [ ] `checkPermission()` main function
  - [ ] Agent allowlist checking
  - [ ] Tool permission checking
  - [ ] Budget limit checking
  - [ ] Rate limiting (in-memory)
  - [ ] Approval workflow stub

- [ ] Implement `MCPClient` wrapper
  - [ ] stdio transport connection
  - [ ] JSON-RPC protocol handling
  - [ ] Error mapping for Temporal
  - [ ] Logging with secret redaction

### 1.4 Testing

- [ ] Unit test: `manager.test.ts`
  - [ ] Server lifecycle (start/stop)
  - [ ] Tool discovery
  - [ ] Health checks
  - [ ] Auto-restart

- [ ] Unit test: `permissions.test.ts`
  - [ ] Agent allowlist enforcement
  - [ ] Tool blocking
  - [ ] Budget limits
  - [ ] Rate limits

- [ ] Integration test: End-to-end with mock server
  - [ ] Spawn mock MCP server
  - [ ] Call tool
  - [ ] Verify result
  - [ ] Verify permissions enforced

### 1.5 Worker Integration

- [ ] Update `workers/temporal-worker/src/index.ts`
  - [ ] Import `startMCPManager`, `stopMCPManager`
  - [ ] Start MCP manager before worker
  - [ ] Stop MCP manager on shutdown

- [ ] Test worker startup/shutdown
  - [ ] All servers start successfully
  - [ ] Tools are discovered
  - [ ] Shutdown is graceful

### 1.6 Success Criteria

- [ ] `pnpm dev:worker` starts without errors
- [ ] All MCP servers show as healthy
- [ ] `mcpManager.listTools()` returns expected tools
- [ ] Unit tests pass: `pnpm test -- mcp`
- [ ] No regressions in existing workflows

---

## Phase 2: Stripe Migration (Week 2)

### 2.1 Configure Stripe MCP Server

- [ ] Add Stripe server config to `servers.config.ts`
  - [ ] Package: `@stripe/mcp-server`
  - [ ] Environment: `STRIPE_API_KEY`
  - [ ] Permission policy defined
  - [ ] Tool permissions mapped

- [ ] Verify Stripe API key in `.env`
  ```bash
  echo $STRIPE_API_KEY  # Should be set
  ```

- [ ] Test Stripe server startup
  ```bash
  pnpm dev:worker
  # Check logs for: [MCP] Server stripe started with X tools
  ```

### 2.2 Create MCP-Based Stripe Activities

- [ ] Create directory: `workers/temporal-worker/src/temporal/activities/mcp/`
- [ ] Create file: `mcp/stripe.ts`

- [ ] Migrate `createStripeProduct`
  - [ ] Implement using `mcpManager.callTool('stripe', 'products_create', ...)`
  - [ ] Add Zod schema for validation
  - [ ] Match original function signature
  - [ ] Add unit test

- [ ] Migrate `createStripePrices`
  - [ ] Implement using `mcpManager.callTool('stripe', 'prices_create', ...)`
  - [ ] Add Zod schema
  - [ ] Match signature
  - [ ] Unit test

- [ ] Migrate `generatePaymentLink`
  - [ ] Implement using `mcpManager.callTool('stripe', 'payment_links_create', ...)`
  - [ ] Schema + test

- [ ] Migrate `createCheckoutSession`
  - [ ] Implement using `mcpManager.callTool('stripe', 'checkout_sessions_create', ...)`
  - [ ] Schema + test

- [ ] Migrate `createCustomer`
  - [ ] Implement using `mcpManager.callTool('stripe', 'customers_create', ...)`
  - [ ] Schema + test

- [ ] Migrate `getSubscriptionStatus`
  - [ ] Implement using `mcpManager.callTool('stripe', 'subscriptions_retrieve', ...)`
  - [ ] Schema + test

- [ ] Migrate `setupStripeWebhook`
  - [ ] Implement using `mcpManager.callTool('stripe', 'webhook_endpoints_create', ...)`
  - [ ] Schema + test

- [ ] Migrate `configureBillingPortal`
  - [ ] Implement using `mcpManager.callTool('stripe', 'billing_portal_sessions_create', ...)`
  - [ ] Schema + test

- [ ] Migrate `getRevenueMetrics`
  - [ ] Implement using multiple MCP calls (subscriptions, charges)
  - [ ] Aggregate data
  - [ ] Schema + test

### 2.3 Update Workflows

- [ ] Update `workers/temporal-worker/src/temporal/workflows/monetize.ts`
  - [ ] Import activities from `mcp/stripe.ts` instead of `stripe/index.ts`
  - [ ] No other changes needed (same signatures)

### 2.4 Export New Activities

- [ ] Update `workers/temporal-worker/src/temporal/activities/index.ts`
  - [ ] Add: `export * from './mcp/stripe.js';`
  - [ ] Comment out: `export * from './stripe/index.js';`

### 2.5 Integration Testing

- [ ] Test: Create product end-to-end
  ```typescript
  const product = await createStripeProduct({
    name: 'Test Product',
    description: 'Integration test',
  });
  expect(product.id).toMatch(/^prod_/);
  ```

- [ ] Test: Create price
- [ ] Test: Create payment link
- [ ] Test: Create checkout session
- [ ] Test: Full monetization workflow
  ```bash
  pnpm test:integration -- monetize
  ```

### 2.6 Cleanup

- [ ] Mark old Stripe activities as deprecated
  - [ ] Add `@deprecated` JSDoc comments
  - [ ] Keep files for reference (1-2 sprints)

- [ ] Update documentation
  - [ ] CLAUDE.md: Update Stripe examples
  - [ ] API docs: Point to MCP activities

### 2.7 Success Criteria

- [ ] All Stripe activities work via MCP
- [ ] Monetization workflow passes E2E test
- [ ] Permission policies enforced (test denials)
- [ ] Budget tracking works
- [ ] No regressions

---

## Phase 3: GitHub Migration (Week 3)

### 3.1 Configure GitHub MCP Server

- [ ] Add GitHub server config to `servers.config.ts`
  - [ ] Package: `@modelcontextprotocol/server-github`
  - [ ] Environment: `GITHUB_TOKEN`
  - [ ] Permission policy defined
  - [ ] Tool permissions mapped

- [ ] Verify GitHub token in `.env`
  ```bash
  echo $GITHUB_TOKEN  # Should be set
  gh auth status      # Should be authenticated
  ```

- [ ] Test GitHub server startup
  ```bash
  pnpm dev:worker
  # Check logs for: [MCP] Server github started with X tools
  ```

### 3.2 Create MCP-Based GitHub Activities

- [ ] Create file: `mcp/github.ts`

**Note**: Only migrate GitHub API calls. Keep local git operations (clone, commit, push) using `execa('git', ...)`.

- [ ] Migrate `createGitHubRepo` (GitHub API portion)
  - [ ] Use `mcpManager.callTool('github', 'create_repository', ...)`
  - [ ] Keep local git init/commit logic
  - [ ] Schema + test

- [ ] Add `createPullRequest`
  - [ ] New activity using `mcpManager.callTool('github', 'create_pull_request', ...)`
  - [ ] Schema + test

- [ ] Add `mergePullRequest`
  - [ ] New activity using `mcpManager.callTool('github', 'merge_pull_request', ...)`
  - [ ] Schema + test
  - [ ] Verify approval requirement works

- [ ] Add `createIssue`
  - [ ] New activity using `mcpManager.callTool('github', 'create_issue', ...)`
  - [ ] Schema + test

- [ ] Add `commentOnPullRequest`
  - [ ] New activity using `mcpManager.callTool('github', 'create_or_update_pull_request_comment', ...)`
  - [ ] Schema + test

- [ ] Add `getFileContents`
  - [ ] New activity using `mcpManager.callTool('github', 'get_file_contents', ...)`
  - [ ] Schema + test

- [ ] Add `searchCode`
  - [ ] New activity using `mcpManager.callTool('github', 'search_code', ...)`
  - [ ] Schema + test

### 3.3 Update Workflows

- [ ] Update `workers/temporal-worker/src/temporal/workflows/build_ship.ts`
  - [ ] Use new GitHub MCP activities where applicable
  - [ ] Keep local git activities from `git/index.ts`

### 3.4 Export New Activities

- [ ] Update `workers/temporal-worker/src/temporal/activities/index.ts`
  - [ ] Add: `export * from './mcp/github.js';`

### 3.5 Integration Testing

- [ ] Test: Create repository
- [ ] Test: Create pull request
- [ ] Test: Merge PR (with approval)
- [ ] Test: Create issue
- [ ] Test: Comment on PR
- [ ] Test: Get file contents
- [ ] Test: Search code
- [ ] Test: Full build_ship workflow

### 3.6 Cleanup

- [ ] Update `git/index.ts`
  - [ ] Keep local git operations
  - [ ] Remove GitHub API calls (now in MCP)

- [ ] Update documentation

### 3.7 Success Criteria

- [ ] All GitHub API operations work via MCP
- [ ] Local git operations still work
- [ ] Build & Ship workflow passes
- [ ] Approval workflow for merge tested
- [ ] No regressions

---

## Phase 4: Vercel Migration (Week 4)

### 4.1 Build Custom Vercel MCP Server

- [ ] Create directory: `workers/mcp-servers/vercel/`
- [ ] Initialize package
  ```bash
  cd workers/mcp-servers/vercel
  npm init -y
  npm install @modelcontextprotocol/sdk vercel zod
  npm install -D typescript @types/node
  ```

- [ ] Create `src/index.ts` (server entry point)
  - [ ] MCP server boilerplate
  - [ ] Tool registration
  - [ ] stdio transport

- [ ] Create `src/tools.ts` (tool definitions)
  - [ ] `create_deployment`
  - [ ] `get_deployment`
  - [ ] `list_deployments`
  - [ ] `cancel_deployment`
  - [ ] `create_project`
  - [ ] `get_project`
  - [ ] `list_projects`
  - [ ] `create_env_var`
  - [ ] `list_env_vars`
  - [ ] `delete_env_var`
  - [ ] `add_domain`
  - [ ] `list_domains`
  - [ ] `remove_domain`

- [ ] Create `src/vercel-client.ts` (Vercel API wrapper)
  - [ ] Vercel REST API client
  - [ ] Deployment operations
  - [ ] Project operations
  - [ ] Environment variables
  - [ ] Domains

- [ ] Create `package.json` scripts
  ```json
  {
    "name": "@ae/mcp-server-vercel",
    "version": "0.1.0",
    "main": "dist/index.js",
    "scripts": {
      "build": "tsc",
      "dev": "tsx src/index.ts",
      "start": "node dist/index.js"
    }
  }
  ```

- [ ] Build and test server standalone
  ```bash
  pnpm build
  pnpm start  # Should start MCP server on stdio
  ```

### 4.2 Configure Vercel MCP Server

- [ ] Add Vercel server config to `servers.config.ts`
  - [ ] Package: `@ae/mcp-server-vercel`
  - [ ] Environment: `VERCEL_TOKEN`, `VERCEL_ORG_ID`
  - [ ] Permission policy defined
  - [ ] Tool permissions mapped

- [ ] Link local package (during development)
  ```bash
  cd workers/mcp-servers/vercel
  pnpm link
  cd ../../temporal-worker
  pnpm link @ae/mcp-server-vercel
  ```

- [ ] Test Vercel server startup
  ```bash
  pnpm dev:worker
  # Check logs for: [MCP] Server vercel started with X tools
  ```

### 4.3 Create MCP-Based Vercel Activities

- [ ] Create file: `mcp/vercel.ts`

- [ ] Migrate `deployToVercel`
  - [ ] Implement using `mcpManager.callTool('vercel', 'create_deployment', ...)`
  - [ ] Add Zod schema
  - [ ] Match signature
  - [ ] Unit test

- [ ] Migrate `getDeploymentStatus`
  - [ ] Implement using `mcpManager.callTool('vercel', 'get_deployment', ...)`
  - [ ] Schema + test

- [ ] Migrate `waitForDeployment`
  - [ ] Use MCP `get_deployment` in polling loop
  - [ ] Schema + test

- [ ] Migrate `setVercelEnvVars`
  - [ ] Implement using `mcpManager.callTool('vercel', 'create_env_var', ...)`
  - [ ] Batch create multiple vars
  - [ ] Schema + test

### 4.4 Update Workflows

- [ ] Update `workers/temporal-worker/src/temporal/workflows/build_ship.ts`
  - [ ] Import Vercel activities from `mcp/vercel.ts`
  - [ ] No other changes needed

### 4.5 Export New Activities

- [ ] Update `workers/temporal-worker/src/temporal/activities/index.ts`
  - [ ] Add: `export * from './mcp/vercel.js';`
  - [ ] Comment out: `export * from './deploy/index.js';` (Vercel portions)

### 4.6 Integration Testing

- [ ] Test: Create deployment
- [ ] Test: Get deployment status
- [ ] Test: Wait for deployment
- [ ] Test: Set environment variables
- [ ] Test: Full build_ship workflow with deployment

### 4.7 Publish Custom Server (Optional)

- [ ] Publish to npm as scoped package
  ```bash
  cd workers/mcp-servers/vercel
  npm publish --access public
  ```

- [ ] Update `servers.config.ts` to use published package

### 4.8 Cleanup

- [ ] Mark old Vercel activities as deprecated
- [ ] Update documentation

### 4.9 Success Criteria

- [ ] All Vercel operations work via MCP
- [ ] Build & Ship workflow deploys successfully
- [ ] Permission policies enforced
- [ ] No regressions

---

## Phase 5: Agent Integration (Week 5)

### 5.1 Update CLI Agent Harness

- [ ] Update `workers/temporal-worker/src/temporal/activities/cli/harness.ts`
  - [ ] Add MCP tool discovery function
  - [ ] Inject available MCP tools into agent context

- [ ] Update `claudeCode.ts`
  - [ ] Enhance prompt with MCP tool listings
  - [ ] Add examples of requesting MCP tools

- [ ] Update `geminiCli.ts`
  - [ ] Same as Claude

- [ ] Update `codexCli.ts`
  - [ ] Same as Claude

### 5.2 Create MCP Tool Request Handler

- [ ] Create `workers/temporal-worker/src/mcp/agent-tools.ts`
  - [ ] Parse agent's MCP tool requests
  - [ ] Route to MCP manager
  - [ ] Format results for agent

### 5.3 LangGraph Integration

- [ ] Update `workers/temporal-worker/src/langgraph/nodes/tool_executor.ts`
  - [ ] Add MCP tool detection (tool name starts with `mcp.`)
  - [ ] Route to MCP manager
  - [ ] Return result in LangGraph format

- [ ] Update `workers/temporal-worker/src/langgraph/graphs/writeTestFix.ts`
  - [ ] Add MCP tools to available tools list

### 5.4 Prompt Engineering

- [ ] Create MCP tool discovery prompt template
  ```
  You have access to the following MCP tools:

  GitHub:
  - create_pull_request: Create a pull request
  - merge_pull_request: Merge a pull request
  - create_issue: Create an issue
  ...

  Stripe:
  - products_create: Create a product
  - prices_create: Create a price
  ...

  To use a tool, request: "Use MCP tool github.create_pull_request with args {...}"
  ```

- [ ] Add to Living Spec template (`specs/protocol/CLAUDE.template.md`)

### 5.5 Testing

- [ ] Test: Claude Code agent uses MCP GitHub tool
- [ ] Test: Gemini CLI agent uses MCP Stripe tool
- [ ] Test: Codex agent uses MCP Vercel tool
- [ ] Test: LangGraph loop with MCP tools
- [ ] Test: Agent respects permission denials

### 5.6 Success Criteria

- [ ] Agents can discover MCP tools
- [ ] Agents successfully invoke MCP tools
- [ ] Tool calls logged properly
- [ ] Permissions enforced
- [ ] LangGraph loops work with MCP

---

## Phase 6: Documentation & Cleanup (Week 6)

### 6.1 Documentation

- [ ] Write `docs/mcp-integration.md`
  - [ ] Architecture overview
  - [ ] How to add new MCP servers
  - [ ] Permission policy guide
  - [ ] Troubleshooting

- [ ] Update `CLAUDE.md`
  - [ ] Add MCP integration section
  - [ ] Reference available MCP tools
  - [ ] Example workflows using MCP

- [ ] Create runbook: `docs/runbooks/adding-mcp-server.md`
  - [ ] Step-by-step guide
  - [ ] Configuration template
  - [ ] Testing checklist

- [ ] Update API documentation
  - [ ] Mark old activities as deprecated
  - [ ] Document MCP activities

### 6.2 Code Cleanup

- [ ] Remove deprecated activities
  - [ ] Delete `workers/temporal-worker/src/temporal/activities/stripe/index.ts`
  - [ ] Delete Vercel portions of `deploy/index.ts`
  - [ ] Keep Netlify portions of `deploy/index.ts` (not migrated)

- [ ] Clean up imports
  - [ ] Remove unused imports
  - [ ] Verify no references to old activities

- [ ] Lint and format
  ```bash
  pnpm lint --fix
  pnpm format
  ```

### 6.3 Testing

- [ ] Run full test suite
  ```bash
  pnpm test
  ```

- [ ] Run integration tests
  ```bash
  pnpm test:integration
  ```

- [ ] Run E2E workflow tests
  ```bash
  pnpm test:workflow -- genesis
  pnpm test:workflow -- build_ship
  pnpm test:workflow -- monetize
  ```

### 6.4 Performance Benchmarking

- [ ] Measure latency before/after MCP
  - [ ] Stripe product creation
  - [ ] GitHub PR creation
  - [ ] Vercel deployment

- [ ] Measure resource usage
  - [ ] Memory (MCP servers)
  - [ ] CPU overhead
  - [ ] File descriptors

- [ ] Document findings
  - [ ] Acceptable overhead?
  - [ ] Any optimizations needed?

### 6.5 Monitoring Setup

- [ ] Add MCP metrics to Prometheus
  - [ ] Server health gauge
  - [ ] Tool call counters
  - [ ] Latency histograms
  - [ ] Permission denial counters

- [ ] Add Grafana dashboard
  - [ ] MCP server health
  - [ ] Tool usage by server
  - [ ] Error rates
  - [ ] Latency trends

- [ ] Configure alerts
  - [ ] Server crash → Slack
  - [ ] High error rate → Slack
  - [ ] Permission violations → Security team

### 6.6 Final Validation

- [ ] Production readiness checklist
  - [ ] All tests pass
  - [ ] Documentation complete
  - [ ] Monitoring configured
  - [ ] Rollback plan documented
  - [ ] Team trained

- [ ] Deploy to staging
  - [ ] Run smoke tests
  - [ ] Verify MCP servers start
  - [ ] Run full workflow suite

- [ ] Deploy to production
  - [ ] Gradual rollout (feature flag?)
  - [ ] Monitor for errors
  - [ ] Ready to rollback if needed

### 6.7 Success Criteria

- [ ] All documentation complete
- [ ] All deprecated code removed
- [ ] All tests pass
- [ ] Performance benchmarks acceptable
- [ ] Monitoring and alerts configured
- [ ] Production deployment successful

---

## Rollback Plan

If MCP integration causes issues:

### Quick Rollback (30 minutes)

1. Revert activity imports in `workers/temporal-worker/src/temporal/activities/index.ts`
   - Comment out MCP activity exports
   - Uncomment old activity exports

2. Restart worker
   ```bash
   pnpm dev:worker
   ```

3. Verify workflows work with old activities

### Full Rollback (2 hours)

1. Revert workflow changes (if any)
2. Remove MCP manager startup from worker
3. Remove MCP dependencies
4. Restore all original activity files
5. Full testing

### Data Integrity

No data integrity concerns:
- MCP only changes how tools are invoked
- No database schema changes
- No state changes in Temporal

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| MCP server crashes | Auto-restart, health checks, fallback to old activities |
| Permission bugs | Extensive testing, start with permissive policies, tighten gradually |
| Performance degradation | Benchmark early, optimize if needed, keep servers running |
| Dependency on external packages | Pin versions, vendor critical servers, monitor for vulnerabilities |
| Credential leaks | Secret redaction, audit logs, principle of least privilege |

---

## Post-Migration

After successful migration:

### Maintenance

- [ ] Weekly health check of MCP servers
- [ ] Monthly review of permission policies
- [ ] Quarterly audit of tool usage

### Future Enhancements

- [ ] Add more MCP servers (Airtable, Notion, Slack, etc.)
- [ ] Implement tool chaining
- [ ] Build MCP marketplace integration
- [ ] Agent-specific tool subsets
- [ ] Advanced approval workflows

---

## Sign-off

| Phase | Completed | Date | Sign-off |
|-------|-----------|------|----------|
| Phase 1: Infrastructure | [ ] | | |
| Phase 2: Stripe | [ ] | | |
| Phase 3: GitHub | [ ] | | |
| Phase 4: Vercel | [ ] | | |
| Phase 5: Agent Integration | [ ] | | |
| Phase 6: Documentation & Cleanup | [ ] | | |

**Migration Complete**: ___________
**Signed off by**: ___________
