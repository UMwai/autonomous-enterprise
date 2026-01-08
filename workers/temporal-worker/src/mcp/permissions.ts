/**
 * MCP Permission Enforcement
 *
 * Implements multi-layered permission checking for MCP tool invocations:
 * - Agent allowlist (which agents can use which servers)
 * - Tool-level permissions (allowed, blocked, requires approval)
 * - Budget limits (spending caps per tool)
 * - Rate limiting (calls per minute/hour)
 * - Custom policy functions
 */

import pino from 'pino';
import { getServerConfig } from './servers.config.js';
import { ApprovalClient } from '../safety/approvalClient.js';
import { BudgetClient } from '../safety/budgets.js';
import type {
  AgentIdentity,
  ToolCall,
} from './types.js';

const logger = pino({ name: 'mcp-permissions' });

/**
 * Permission check result
 */
export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  requiresApproval?: boolean;
}

/**
 * Rate limit tracking (in-memory for now, use Redis in production)
 */
class RateLimiter {
  private callLog: Map<string, number[]> = new Map();

  /**
   * Check if a call would exceed rate limits
   */
  async checkLimit(
    key: string,
    maxPerMinute: number,
    maxPerHour: number
  ): Promise<{ allowed: boolean; reason?: string }> {
    const now = Date.now();

    // Get recent calls
    const calls = this.callLog.get(key) || [];

    // Check minute limit
    const oneMinuteAgo = now - 60 * 1000;
    const callsLastMinute = calls.filter((t) => t > oneMinuteAgo).length;
    if (callsLastMinute >= maxPerMinute) {
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${callsLastMinute}/${maxPerMinute} calls per minute`,
      };
    }

    // Check hour limit
    const oneHourAgo = now - 60 * 60 * 1000;
    const callsLastHour = calls.filter((t) => t > oneHourAgo).length;
    if (callsLastHour >= maxPerHour) {
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${callsLastHour}/${maxPerHour} calls per hour`,
      };
    }

    return { allowed: true };
  }

  /**
   * Record a call
   */
  async recordCall(key: string): Promise<void> {
    const now = Date.now();
    const calls = this.callLog.get(key) || [];
    calls.push(now);

    // Keep only last hour of data
    const oneHourAgo = now - 60 * 60 * 1000;
    const recentCalls = calls.filter((t) => t > oneHourAgo);

    this.callLog.set(key, recentCalls);
  }

  /**
   * Clear old entries (cleanup)
   */
  cleanup(): void {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    for (const [key, calls] of this.callLog.entries()) {
      const recentCalls = calls.filter((t) => t > oneHourAgo);
      if (recentCalls.length === 0) {
        this.callLog.delete(key);
      } else {
        this.callLog.set(key, recentCalls);
      }
    }
  }
}

// Singleton rate limiter
const rateLimiter = new RateLimiter();

// Cleanup old rate limit data every hour
setInterval(() => rateLimiter.cleanup(), 60 * 60 * 1000);

/**
 * Check if an agent has permission to call a tool
 */
export async function checkPermission(
  agent: AgentIdentity,
  toolCall: ToolCall
): Promise<boolean> {
  const result = await checkPermissionDetailed(agent, toolCall);
  return result.allowed;
}

/**
 * Check permission with detailed result
 */
export async function checkPermissionDetailed(
  agent: AgentIdentity,
  toolCall: ToolCall
): Promise<PermissionCheckResult> {
  const { serverId, toolName, args } = toolCall;

  logger.debug(
    { serverId, toolName, agentType: agent.type, runId: agent.runId },
    'Checking permission for MCP tool call'
  );

  // 1. Get server configuration
  const serverConfig = getServerConfig(serverId);
  if (!serverConfig) {
    logger.warn({ serverId }, 'Unknown MCP server');
    return {
      allowed: false,
      reason: `Unknown server: ${serverId}`,
    };
  }

  const policy = serverConfig.permissions;

  // 2. Check if agent type is allowed to use this server
  if (!policy.allowedAgents.includes(agent.type)) {
    logger.warn(
      { serverId, agentType: agent.type },
      'Agent type not allowed to use server'
    );
    return {
      allowed: false,
      reason: `Agent type ${agent.type} not allowed to use ${serverId}`,
    };
  }

  // 3. Check tool-specific permissions
  const toolPermission = policy.toolPermissions[toolName];

  if (!toolPermission) {
    // Tool not explicitly configured - default to allow
    logger.debug(
      { serverId, toolName },
      'Tool not in permission policy, allowing by default'
    );
    return { allowed: true };
  }

  if (!toolPermission.allowed) {
    logger.warn({ serverId, toolName }, 'Tool is blocked by policy');
    return {
      allowed: false,
      reason: `Tool ${toolName} is blocked on ${serverId}`,
    };
  }

  // 4. Check budget limits
  if (toolPermission.budgetLimit) {
    const budgetOk = await checkBudgetLimit(
      agent,
      toolCall,
      toolPermission.budgetLimit
    );
    if (!budgetOk.allowed) {
      return budgetOk;
    }
  }

  // 5. Check custom policy function
  if (toolPermission.customPolicy) {
    try {
      const customAllowed = await toolPermission.customPolicy(agent, args);
      if (!customAllowed) {
        logger.warn(
          { serverId, toolName },
          'Blocked by custom policy function'
        );
        return {
          allowed: false,
          reason: `Custom policy denied ${serverId}.${toolName}`,
        };
      }
    } catch (error) {
      logger.error(
        { serverId, toolName, error },
        'Custom policy function threw error'
      );
      return {
        allowed: false,
        reason: `Custom policy error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // 6. Check rate limits
  if (policy.rateLimit) {
    const rateLimitOk = await checkRateLimit(agent, serverId, policy.rateLimit);
    if (!rateLimitOk.allowed) {
      return rateLimitOk;
    }
  }

  // 7. Check if approval is required
  if (toolPermission.requiresApproval) {
    logger.info(
      { serverId, toolName, agentType: agent.type },
      'Tool requires human approval'
    );
    return {
      allowed: true,
      requiresApproval: true,
    };
  }

  // All checks passed
  logger.debug({ serverId, toolName }, 'Permission granted');
  return { allowed: true };
}

/**
 * Check budget limit for a tool call
 */
async function checkBudgetLimit(
  agent: AgentIdentity,
  _toolCall: ToolCall,
  limit: { amount: number; currency: string }
): Promise<PermissionCheckResult> {
  try {
    const budgetClient = new BudgetClient();
    const status = await budgetClient.getStatus(agent.runId);

    // Check if we have enough remaining budget
    if (status.remaining < limit.amount) {
      logger.warn(
        {
          runId: agent.runId,
          remaining: status.remaining,
          required: limit.amount,
        },
        'Insufficient budget for tool call'
      );
      return {
        allowed: false,
        reason: `Insufficient budget: $${status.remaining} remaining, $${limit.amount} required`,
      };
    }

    return { allowed: true };
  } catch (error) {
    // If budget service is unavailable, log warning but allow the call
    logger.warn(
      { runId: agent.runId, error },
      'Budget check failed, allowing call'
    );
    return { allowed: true };
  }
}

/**
 * Check rate limit for a server
 */
async function checkRateLimit(
  agent: AgentIdentity,
  serverId: string,
  limit: { maxCallsPerMinute: number; maxCallsPerHour: number }
): Promise<PermissionCheckResult> {
  const key = `${agent.runId}:${serverId}`;

  const result = await rateLimiter.checkLimit(
    key,
    limit.maxCallsPerMinute,
    limit.maxCallsPerHour
  );

  if (!result.allowed) {
    logger.warn(
      { runId: agent.runId, serverId, reason: result.reason },
      'Rate limit exceeded'
    );
    return {
      allowed: false,
      reason: result.reason,
    };
  }

  // Record this call
  await rateLimiter.recordCall(key);

  return { allowed: true };
}

/**
 * Request and wait for human approval
 */
export async function requestApproval(
  agent: AgentIdentity,
  toolCall: ToolCall
): Promise<boolean> {
  const approvalClient = new ApprovalClient();

  try {
    const actionId = `mcp-${toolCall.serverId}-${toolCall.toolName}-${Date.now()}`;

    logger.info(
      {
        actionId,
        serverId: toolCall.serverId,
        toolName: toolCall.toolName,
        runId: agent.runId,
      },
      'Requesting human approval for MCP tool call'
    );

    // Request approval (we await to ensure it's created before polling)
    await approvalClient.requestApproval({
      action_id: actionId,
      action_type: 'mcp_tool_call',
      description: `Call ${toolCall.serverId}.${toolCall.toolName}`,
      context: {
        serverId: toolCall.serverId,
        toolName: toolCall.toolName,
        args: toolCall.args,
        agent: agent.type,
        phase: agent.phase,
      },
      run_id: agent.runId,
      requested_by: `mcp-${agent.type}`,
      timeout_seconds: 3600, // 1 hour
    });

    // Wait for decision (poll every 5 seconds)
    const decision = await approvalClient.waitForApproval(actionId, 5);

    logger.info(
      { actionId, status: decision.status },
      'Approval decision received'
    );

    return decision.status === 'approved';
  } catch (error) {
    logger.error({ error, toolCall }, 'Approval request failed');

    // In development, auto-approve
    if (process.env.NODE_ENV === 'development') {
      logger.warn('Auto-approving in development mode');
      return true;
    }

    // In production, deny on error
    return false;
  }
}

/**
 * Enforce permission and request approval if needed
 */
export async function enforcePermission(
  agent: AgentIdentity,
  toolCall: ToolCall
): Promise<void> {
  const result = await checkPermissionDetailed(agent, toolCall);

  if (!result.allowed) {
    throw new Error(
      `Permission denied: ${result.reason || 'Unknown reason'}`
    );
  }

  if (result.requiresApproval) {
    const approved = await requestApproval(agent, toolCall);
    if (!approved) {
      throw new Error(
        `Approval denied for ${toolCall.serverId}.${toolCall.toolName}`
      );
    }
  }
}

/**
 * Get permission summary for a server
 */
export function getPermissionSummary(serverId: string): {
  allowedAgents: string[];
  allowedTools: string[];
  blockedTools: string[];
  approvalRequiredTools: string[];
  rateLimit?: { maxCallsPerMinute: number; maxCallsPerHour: number };
} {
  const config = getServerConfig(serverId);
  if (!config) {
    return {
      allowedAgents: [],
      allowedTools: [],
      blockedTools: [],
      approvalRequiredTools: [],
    };
  }

  const policy = config.permissions;
  const allowedTools: string[] = [];
  const blockedTools: string[] = [];
  const approvalRequiredTools: string[] = [];

  for (const [toolName, permission] of Object.entries(
    policy.toolPermissions
  )) {
    if (!permission.allowed) {
      blockedTools.push(toolName);
    } else if (permission.requiresApproval) {
      approvalRequiredTools.push(toolName);
    } else {
      allowedTools.push(toolName);
    }
  }

  return {
    allowedAgents: policy.allowedAgents,
    allowedTools,
    blockedTools,
    approvalRequiredTools,
    rateLimit: policy.rateLimit,
  };
}
