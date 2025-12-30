/**
 * MCP (Model Context Protocol) Type Definitions
 *
 * Core types for MCP server management, tool invocation, and permission enforcement.
 */

import type { ChildProcess } from 'child_process';

/**
 * MCP Server Configuration
 */
export interface MCPServerConfig {
  /** Unique identifier for this server */
  id: string;

  /** Display name */
  name: string;

  /** Description of server's capabilities */
  description: string;

  /** Server type */
  type: 'npm' | 'python' | 'binary';

  /** NPM package name (for type: npm) */
  package?: string;

  /** Path to binary (for type: binary) */
  binary?: string;

  /** Python package (for type: python) */
  pythonPackage?: string;

  /** Command-line arguments */
  args?: string[];

  /** Environment variables (includes credentials) */
  env: Record<string, string>;

  /** Transport mechanism */
  transport: 'stdio' | 'sse';

  /** SSE endpoint URL (for transport: sse) */
  url?: string;

  /** Permission policy */
  permissions: PermissionPolicy;

  /** Health check configuration */
  healthCheck?: HealthCheckConfig;

  /** Auto-start with worker */
  autoStart?: boolean;

  /** Auto-restart on failure */
  autoRestart?: boolean;
}

/**
 * Permission policy for MCP server
 */
export interface PermissionPolicy {
  /** Which agent types can use this server */
  allowedAgents: AgentType[];

  /** Tool-level permissions */
  toolPermissions: {
    [toolName: string]: ToolPermission;
  };

  /** Rate limiting */
  rateLimit?: RateLimit;
}

/**
 * Permission for a specific tool
 */
export interface ToolPermission {
  /** Whether the tool is allowed at all */
  allowed: boolean;

  /** Requires human approval before execution */
  requiresApproval?: boolean;

  /** Budget limit for this tool */
  budgetLimit?: {
    amount: number;
    currency: string;
  };

  /** Custom policy function */
  customPolicy?: (agent: AgentIdentity, args: unknown) => Promise<boolean>;
}

/**
 * Rate limiting configuration
 */
export interface RateLimit {
  maxCallsPerMinute: number;
  maxCallsPerHour: number;
}

/**
 * Health check configuration
 */
export interface HealthCheckConfig {
  enabled: boolean;
  interval: number; // milliseconds
  timeout: number; // milliseconds
}

/**
 * Agent identity for permission checks
 */
export interface AgentIdentity {
  /** Agent type */
  type: AgentType;

  /** Temporal workflow run ID */
  runId: string;

  /** Project ID */
  projectId: string;

  /** Current execution phase */
  phase: string;
}

/**
 * Agent type
 */
export type AgentType = 'claude' | 'gemini' | 'codex' | 'langgraph';

/**
 * Tool call for permission checking
 */
export interface ToolCall {
  serverId: string;
  toolName: string;
  args: Record<string, unknown>;
}

/**
 * MCP Tool definition
 */
export interface Tool {
  /** Tool name */
  name: string;

  /** Tool description */
  description: string;

  /** Input schema (JSON Schema) */
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };

  /** Server ID (added by manager) */
  serverId?: string;
}

/**
 * Server instance (internal)
 */
export interface ServerInstance {
  /** Configuration */
  config: MCPServerConfig;

  /** Child process (for stdio transport) */
  process?: ChildProcess;

  /** Health status */
  healthy: boolean;

  /** Last health check timestamp */
  lastHealthCheck?: number;

  /** Start timestamp */
  startedAt: number;

  /** Restart count */
  restartCount: number;
}

/**
 * Tool execution result
 */
export interface ToolResult<T = unknown> {
  /** Success flag */
  success: boolean;

  /** Result data (if successful) */
  data?: T;

  /** Error message (if failed) */
  error?: string;

  /** Execution time in milliseconds */
  executionTime: number;

  /** Cost (if tracked) */
  cost?: {
    amount: number;
    currency: string;
  };
}

/**
 * Server health status
 */
export interface ServerHealth {
  serverId: string;
  healthy: boolean;
  uptime: number;
  restartCount: number;
  lastError?: string;
  toolCount: number;
}

/**
 * MCP Manager statistics
 */
export interface MCPManagerStats {
  serversRunning: number;
  totalTools: number;
  toolCallsTotal: number;
  toolCallsSuccess: number;
  toolCallsFailed: number;
  averageLatency: number;
  serverHealth: ServerHealth[];
}
