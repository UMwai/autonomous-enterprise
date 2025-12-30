/**
 * MCP Server Configurations
 *
 * Central registry of all MCP servers used by Autonomous Enterprise.
 */

import type { MCPServerConfig } from './types.js';

/**
 * All MCP server configurations
 */
export const MCP_SERVERS: MCPServerConfig[] = [
  // =====================================================================
  // GitHub Integration
  // =====================================================================
  {
    id: 'github',
    name: 'GitHub',
    description: 'GitHub API integration for repositories, PRs, issues, and code search',
    type: 'npm',
    package: '@modelcontextprotocol/server-github',
    transport: 'stdio',
    env: {
      GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
    },
    permissions: {
      allowedAgents: ['claude', 'gemini', 'codex', 'langgraph'],
      toolPermissions: {
        // Read operations - unrestricted
        'search_repositories': { allowed: true },
        'search_code': { allowed: true },
        'search_issues': { allowed: true },
        'get_file_contents': { allowed: true },
        'list_commits': { allowed: true },
        'list_issues': { allowed: true },
        'list_pull_requests': { allowed: true },

        // Write operations - budget limited
        'create_or_update_file': {
          allowed: true,
          budgetLimit: { amount: 2, currency: 'USD' },
        },
        'create_pull_request': {
          allowed: true,
          budgetLimit: { amount: 2, currency: 'USD' },
        },
        'create_issue': {
          allowed: true,
          budgetLimit: { amount: 1, currency: 'USD' },
        },

        // Sensitive operations - require approval
        'merge_pull_request': {
          allowed: true,
          requiresApproval: true,
        },
        'push_files': {
          allowed: true,
          requiresApproval: true,
        },

        // Destructive operations - blocked
        'delete_repository': { allowed: false },
        'delete_file': { allowed: false },
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
    autoRestart: true,
  },

  // =====================================================================
  // Stripe Integration
  // =====================================================================
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Stripe payment processing and subscription management',
    type: 'npm',
    package: '@stripe/mcp-server',
    transport: 'stdio',
    env: {
      STRIPE_API_KEY: process.env.STRIPE_API_KEY || '',
    },
    permissions: {
      // Only LangGraph and Codex can use Stripe (not direct agent access)
      allowedAgents: ['langgraph', 'codex'],
      toolPermissions: {
        // Product management
        'products_create': {
          allowed: true,
          budgetLimit: { amount: 5, currency: 'USD' },
        },
        'products_list': { allowed: true },
        'products_retrieve': { allowed: true },
        'products_update': {
          allowed: true,
          budgetLimit: { amount: 2, currency: 'USD' },
        },

        // Price management
        'prices_create': {
          allowed: true,
          budgetLimit: { amount: 2, currency: 'USD' },
        },
        'prices_list': { allowed: true },
        'prices_retrieve': { allowed: true },

        // Customer management
        'customers_create': { allowed: true },
        'customers_list': { allowed: true },
        'customers_retrieve': { allowed: true },
        'customers_update': { allowed: true },

        // Payment links
        'payment_links_create': {
          allowed: true,
          budgetLimit: { amount: 3, currency: 'USD' },
        },
        'payment_links_list': { allowed: true },
        'payment_links_retrieve': { allowed: true },

        // Checkout sessions
        'checkout_sessions_create': {
          allowed: true,
          budgetLimit: { amount: 5, currency: 'USD' },
        },
        'checkout_sessions_retrieve': { allowed: true },

        // Subscriptions
        'subscriptions_create': {
          allowed: true,
          budgetLimit: { amount: 10, currency: 'USD' },
        },
        'subscriptions_retrieve': { allowed: true },
        'subscriptions_list': { allowed: true },
        'subscriptions_update': {
          allowed: true,
          requiresApproval: true,
        },
        'subscriptions_cancel': {
          allowed: true,
          requiresApproval: true,
        },

        // Billing portal
        'billing_portal_sessions_create': { allowed: true },
        'billing_portal_configurations_create': { allowed: true },

        // Webhooks
        'webhook_endpoints_create': {
          allowed: true,
          budgetLimit: { amount: 3, currency: 'USD' },
        },
        'webhook_endpoints_list': { allowed: true },

        // Dangerous operations - blocked
        'charges_create': { allowed: false },
        'refunds_create': { allowed: false },
        'products_delete': { allowed: false },
        'customers_delete': { allowed: false },
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
    autoRestart: true,
  },

  // =====================================================================
  // Vercel Integration (Custom MCP Server)
  // =====================================================================
  {
    id: 'vercel',
    name: 'Vercel',
    description: 'Vercel deployment and hosting platform integration',
    type: 'npm',
    package: '@ae/mcp-server-vercel', // Custom package (to be implemented)
    transport: 'stdio',
    env: {
      VERCEL_TOKEN: process.env.VERCEL_TOKEN || '',
      VERCEL_ORG_ID: process.env.VERCEL_ORG_ID || '',
    },
    permissions: {
      allowedAgents: ['langgraph', 'codex'],
      toolPermissions: {
        // Deployment operations
        'create_deployment': {
          allowed: true,
          budgetLimit: { amount: 10, currency: 'USD' },
        },
        'get_deployment': { allowed: true },
        'list_deployments': { allowed: true },
        'cancel_deployment': {
          allowed: true,
          requiresApproval: true,
        },

        // Project management
        'create_project': {
          allowed: true,
          budgetLimit: { amount: 5, currency: 'USD' },
        },
        'get_project': { allowed: true },
        'list_projects': { allowed: true },
        'update_project': { allowed: true },

        // Environment variables
        'create_env_var': { allowed: true },
        'list_env_vars': { allowed: true },
        'delete_env_var': { allowed: true },

        // Domain management
        'add_domain': {
          allowed: true,
          requiresApproval: true,
        },
        'list_domains': { allowed: true },
        'remove_domain': {
          allowed: true,
          requiresApproval: true,
        },

        // Dangerous operations - blocked
        'delete_project': { allowed: false },
      },
      rateLimit: {
        maxCallsPerMinute: 10,
        maxCallsPerHour: 100,
      },
    },
    healthCheck: {
      enabled: true,
      interval: 120000, // 2 minutes
      timeout: 10000,
    },
    autoStart: true,
    autoRestart: true,
  },
];

/**
 * Get server config by ID
 */
export function getServerConfig(serverId: string): MCPServerConfig | undefined {
  return MCP_SERVERS.find(s => s.id === serverId);
}

/**
 * Get all server IDs
 */
export function getServerIds(): string[] {
  return MCP_SERVERS.map(s => s.id);
}

/**
 * Validate server configuration
 */
export function validateServerConfig(config: MCPServerConfig): string[] {
  const errors: string[] = [];

  // Check required fields
  if (!config.id) errors.push('Server ID is required');
  if (!config.name) errors.push('Server name is required');
  if (!config.type) errors.push('Server type is required');

  // Check type-specific requirements
  if (config.type === 'npm' && !config.package) {
    errors.push('NPM package name is required for type: npm');
  }

  if (config.type === 'binary' && !config.binary) {
    errors.push('Binary path is required for type: binary');
  }

  if (config.type === 'python' && !config.pythonPackage) {
    errors.push('Python package is required for type: python');
  }

  // Check transport
  if (config.transport === 'sse' && !config.url) {
    errors.push('URL is required for transport: sse');
  }

  // Validate permissions
  if (!config.permissions) {
    errors.push('Permissions policy is required');
  } else {
    if (!config.permissions.allowedAgents || config.permissions.allowedAgents.length === 0) {
      errors.push('At least one allowed agent is required');
    }

    if (!config.permissions.toolPermissions) {
      errors.push('Tool permissions must be defined');
    }
  }

  return errors;
}

/**
 * Get all tools that require approval
 */
export function getApprovalRequiredTools(): Array<{ serverId: string; toolName: string }> {
  const tools: Array<{ serverId: string; toolName: string }> = [];

  for (const server of MCP_SERVERS) {
    for (const [toolName, permission] of Object.entries(server.permissions.toolPermissions)) {
      if (permission.requiresApproval) {
        tools.push({ serverId: server.id, toolName });
      }
    }
  }

  return tools;
}

/**
 * Get all blocked tools
 */
export function getBlockedTools(): Array<{ serverId: string; toolName: string }> {
  const tools: Array<{ serverId: string; toolName: string }> = [];

  for (const server of MCP_SERVERS) {
    for (const [toolName, permission] of Object.entries(server.permissions.toolPermissions)) {
      if (!permission.allowed) {
        tools.push({ serverId: server.id, toolName });
      }
    }
  }

  return tools;
}
