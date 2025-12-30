/**
 * MCP Tool Bridge
 *
 * Provides a unified interface for invoking MCP tools with:
 * - Permission checking
 * - Budget tracking
 * - Secret redaction in logs
 * - Error handling and retries
 * - Statistics tracking
 */

import pino from 'pino';
import { getMCPManager } from './serverManager.js';
import { checkPermission } from './permissions.js';
import { BudgetClient } from '../safety/budgets.js';
import type {
  AgentIdentity,
  ToolCall,
  ToolResult,
  Tool,
} from './types.js';

const logger = pino({ name: 'mcp-tool-bridge' });

/**
 * Configuration for the tool bridge
 */
export interface ToolBridgeConfig {
  budgetTrackingEnabled?: boolean;
  budgetApiUrl?: string;
  secretRedactionEnabled?: boolean;
  maxRetries?: number;
}

/**
 * Bridge between application code and MCP tools
 */
export class MCPToolBridge {
  private budgetClient: BudgetClient | null = null;
  private config: Required<ToolBridgeConfig>;

  constructor(config: ToolBridgeConfig = {}) {
    this.config = {
      budgetTrackingEnabled: config.budgetTrackingEnabled ?? true,
      budgetApiUrl: config.budgetApiUrl ?? 'http://localhost:8000',
      secretRedactionEnabled: config.secretRedactionEnabled ?? true,
      maxRetries: config.maxRetries ?? 3,
    };

    if (this.config.budgetTrackingEnabled) {
      this.budgetClient = new BudgetClient(this.config.budgetApiUrl);
    }
  }

  /**
   * List all available tools
   */
  listTools(serverId?: string): Tool[] {
    const manager = getMCPManager();
    return manager.listTools(serverId);
  }

  /**
   * Get a specific tool definition
   */
  getTool(serverId: string, toolName: string): Tool | undefined {
    const manager = getMCPManager();
    return manager.getTool(serverId, toolName);
  }

  /**
   * Call an MCP tool with full safety checks
   */
  async callTool<T = unknown>(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    agentIdentity: AgentIdentity
  ): Promise<ToolResult<T>> {
    const startTime = Date.now();
    const toolCall: ToolCall = { serverId, toolName, args };

    logger.info(
      {
        serverId,
        toolName,
        agentType: agentIdentity.type,
        runId: agentIdentity.runId,
        args: this.redactSecrets(args),
      },
      'MCP tool call initiated'
    );

    try {
      // 1. Check permissions
      const permitted = await checkPermission(agentIdentity, toolCall);
      if (!permitted) {
        const error = `Permission denied: ${agentIdentity.type} cannot call ${serverId}.${toolName}`;
        logger.warn(
          { serverId, toolName, agentType: agentIdentity.type },
          error
        );

        return {
          success: false,
          error,
          executionTime: Date.now() - startTime,
        };
      }

      // 2. Check budget if tracking enabled
      if (this.config.budgetTrackingEnabled && this.budgetClient) {
        const toolDef = this.getTool(serverId, toolName);
        const estimatedCost = this.estimateToolCost(toolDef);

        if (estimatedCost > 0) {
          const canSpend = await this.budgetClient.canSpend(
            agentIdentity.runId,
            estimatedCost
          );

          if (!canSpend) {
            const status = await this.budgetClient.getStatus(
              agentIdentity.runId
            );
            const error = `Budget exceeded: $${status.spent}/$${status.limit} spent`;
            logger.warn({ runId: agentIdentity.runId, status }, error);

            return {
              success: false,
              error,
              executionTime: Date.now() - startTime,
            };
          }
        }
      }

      // 3. Execute the tool
      const result = await this.executeWithRetry<T>(
        serverId,
        toolName,
        args,
        this.config.maxRetries
      );

      // 4. Track budget spending
      if (
        result.success &&
        this.config.budgetTrackingEnabled &&
        this.budgetClient
      ) {
        const toolDef = this.getTool(serverId, toolName);
        const actualCost = result.cost?.amount || this.estimateToolCost(toolDef);

        if (actualCost > 0) {
          await this.budgetClient.spend(agentIdentity.runId, actualCost);
        }
      }

      // 5. Record statistics
      const manager = getMCPManager();
      manager.recordToolCall(result.success, result.executionTime);

      logger.info(
        {
          serverId,
          toolName,
          success: result.success,
          executionTime: result.executionTime,
        },
        'MCP tool call completed'
      );

      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      logger.error(
        { serverId, toolName, error: errorMessage, executionTime },
        'MCP tool call failed'
      );

      return {
        success: false,
        error: errorMessage,
        executionTime,
      };
    }
  }

  /**
   * Call a tool with automatic retries
   */
  private async executeWithRetry<T>(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    maxRetries: number
  ): Promise<ToolResult<T>> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const manager = getMCPManager();
        const client = manager.getClient(serverId);

        if (!client) {
          throw new Error(`Server ${serverId} not running`);
        }

        if (!client.isConnected()) {
          throw new Error(`Server ${serverId} not connected`);
        }

        const result = await client.callTool<T>(toolName, args);

        // Success
        if (result.success) {
          if (attempt > 0) {
            logger.info(
              { serverId, toolName, attempt },
              'Tool call succeeded after retry'
            );
          }
          return result;
        }

        // Tool returned error
        if (this.isRetryableError(result.error)) {
          lastError = new Error(result.error || 'Unknown error');
          logger.warn(
            { serverId, toolName, attempt, error: result.error },
            'Tool call failed, will retry'
          );
          await this.sleep(this.getRetryDelay(attempt));
          continue;
        }

        // Non-retryable error
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < maxRetries && this.isRetryableError(lastError.message)) {
          logger.warn(
            { serverId, toolName, attempt, error: lastError.message },
            'Tool call threw error, will retry'
          );
          await this.sleep(this.getRetryDelay(attempt));
          continue;
        }

        // Non-retryable or max retries reached
        break;
      }
    }

    // All retries exhausted
    return {
      success: false,
      error: lastError?.message || 'Unknown error after retries',
      executionTime: 0,
    };
  }

  /**
   * Check if an error should trigger a retry
   */
  private isRetryableError(errorMessage?: string): boolean {
    if (!errorMessage) {
      return false;
    }

    const retryablePatterns = [
      /timeout/i,
      /network/i,
      /connection/i,
      /unavailable/i,
      /temporary/i,
      /rate limit/i,
    ];

    return retryablePatterns.some((pattern) => pattern.test(errorMessage));
  }

  /**
   * Get exponential backoff delay for retry
   */
  private getRetryDelay(attempt: number): number {
    // Exponential backoff: 1s, 2s, 4s, 8s, etc.
    return Math.min(1000 * Math.pow(2, attempt), 30000);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Estimate the cost of a tool call
   */
  private estimateToolCost(toolDef?: Tool): number {
    // This is a simple heuristic. In production, you might:
    // - Look up costs from a configuration table
    // - Use ML to predict costs based on historical data
    // - Query the MCP server for cost estimates

    if (!toolDef) {
      return 0;
    }

    // For now, return 0 (cost tracking happens at permission level)
    return 0;
  }

  /**
   * Redact secrets from args for logging
   */
  private redactSecrets(args: Record<string, unknown>): Record<string, unknown> {
    if (!this.config.secretRedactionEnabled) {
      return args;
    }

    const secretKeys = [
      'password',
      'token',
      'secret',
      'apiKey',
      'api_key',
      'accessToken',
      'access_token',
      'privateKey',
      'private_key',
      'credential',
    ];

    const redacted: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args)) {
      const isSecret = secretKeys.some((secretKey) =>
        key.toLowerCase().includes(secretKey.toLowerCase())
      );

      if (isSecret && typeof value === 'string') {
        redacted[key] = '***REDACTED***';
      } else if (typeof value === 'object' && value !== null) {
        // Recursively redact nested objects
        redacted[key] = this.redactSecrets(value as Record<string, unknown>);
      } else {
        redacted[key] = value;
      }
    }

    return redacted;
  }
}

/**
 * Singleton instance
 */
let bridgeInstance: MCPToolBridge | null = null;

/**
 * Get the singleton tool bridge
 */
export function getMCPToolBridge(config?: ToolBridgeConfig): MCPToolBridge {
  if (!bridgeInstance) {
    bridgeInstance = new MCPToolBridge(config);
  }
  return bridgeInstance;
}

/**
 * Convenience function to call a tool
 */
export async function callMCPTool<T = unknown>(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
  agentIdentity: AgentIdentity
): Promise<ToolResult<T>> {
  const bridge = getMCPToolBridge();
  return bridge.callTool<T>(serverId, toolName, args, agentIdentity);
}
