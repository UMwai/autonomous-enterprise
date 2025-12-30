/**
 * MCP Server Manager
 *
 * Manages lifecycle of MCP servers: starting, stopping, health checks, and auto-restart.
 * Maintains a registry of running servers and their available tools.
 */

import { EventEmitter } from 'events';
import pino from 'pino';
import { MCPClient } from './client.js';
import { MCP_SERVERS, getServerConfig } from './servers.config.js';
import type {
  MCPServerConfig,
  ServerInstance,
  Tool,
  ServerHealth,
  MCPManagerStats,
} from './types.js';

const logger = pino({ name: 'mcp-server-manager' });

/**
 * Manages all MCP server instances
 */
export class MCPServerManager extends EventEmitter {
  private servers: Map<string, ServerInstance> = new Map();
  private clients: Map<string, MCPClient> = new Map();
  private toolRegistry: Map<string, Tool[]> = new Map();
  private healthCheckIntervals: Map<string, NodeJS.Timeout> = new Map();
  private started: boolean = false;

  // Statistics
  private stats = {
    toolCallsTotal: 0,
    toolCallsSuccess: 0,
    toolCallsFailed: 0,
    totalLatency: 0,
  };

  /**
   * Start all auto-start servers
   */
  async start(): Promise<void> {
    if (this.started) {
      logger.warn('MCP server manager already started');
      return;
    }

    logger.info('Starting MCP server manager');

    const autoStartServers = MCP_SERVERS.filter((s) => s.autoStart);
    logger.info(
      { count: autoStartServers.length },
      'Starting auto-start MCP servers'
    );

    for (const config of autoStartServers) {
      try {
        await this.startServer(config.id);
      } catch (error) {
        logger.error(
          { serverId: config.id, error },
          'Failed to start server during initialization'
        );
        // Continue with other servers
      }
    }

    this.started = true;
    this.emit('started', { serversRunning: this.servers.size });
    logger.info(
      { serversRunning: this.servers.size },
      'MCP server manager started'
    );
  }

  /**
   * Stop all servers
   */
  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    logger.info('Stopping MCP server manager');

    // Stop all health checks
    for (const interval of this.healthCheckIntervals.values()) {
      clearInterval(interval);
    }
    this.healthCheckIntervals.clear();

    // Stop all servers
    const stopPromises = Array.from(this.servers.keys()).map((id) =>
      this.stopServer(id)
    );
    await Promise.all(stopPromises);

    this.started = false;
    this.emit('stopped');
    logger.info('MCP server manager stopped');
  }

  /**
   * Start a specific server
   */
  async startServer(serverId: string): Promise<void> {
    if (this.servers.has(serverId)) {
      logger.warn({ serverId }, 'Server already running');
      return;
    }

    const config = getServerConfig(serverId);
    if (!config) {
      throw new Error(`Unknown server: ${serverId}`);
    }

    logger.info({ serverId, type: config.type }, 'Starting MCP server');

    try {
      // Create client
      const client = new MCPClient(config);

      // Set up error handling
      client.on('error', (error) => {
        logger.error({ serverId, error }, 'MCP client error');
        this.handleServerError(serverId, error);
      });

      client.on('disconnected', (info) => {
        logger.warn({ serverId, info }, 'MCP client disconnected');
        this.handleServerDisconnected(serverId, info);
      });

      // Connect to server
      await client.connect();

      // Discover tools
      const tools = await client.listTools();
      this.toolRegistry.set(serverId, tools);

      // Create instance record
      const instance: ServerInstance = {
        config,
        healthy: true,
        startedAt: Date.now(),
        restartCount: 0,
      };

      this.servers.set(serverId, instance);
      this.clients.set(serverId, client);

      logger.info(
        { serverId, toolCount: tools.length },
        'MCP server started successfully'
      );
      this.emit('server:started', { serverId, toolCount: tools.length });

      // Start health checks
      if (config.healthCheck?.enabled) {
        this.startHealthCheck(serverId);
      }
    } catch (error) {
      logger.error({ serverId, error }, 'Failed to start MCP server');
      throw new Error(
        `Failed to start server ${serverId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Stop a specific server
   */
  async stopServer(serverId: string): Promise<void> {
    const instance = this.servers.get(serverId);
    if (!instance) {
      logger.debug({ serverId }, 'Server not running');
      return;
    }

    logger.info({ serverId }, 'Stopping MCP server');

    // Stop health check
    const healthCheckInterval = this.healthCheckIntervals.get(serverId);
    if (healthCheckInterval) {
      clearInterval(healthCheckInterval);
      this.healthCheckIntervals.delete(serverId);
    }

    // Disconnect client
    const client = this.clients.get(serverId);
    if (client) {
      await client.disconnect();
      this.clients.delete(serverId);
    }

    // Clean up
    this.servers.delete(serverId);
    this.toolRegistry.delete(serverId);

    logger.info({ serverId }, 'MCP server stopped');
    this.emit('server:stopped', { serverId });
  }

  /**
   * Restart a specific server
   */
  async restartServer(serverId: string): Promise<void> {
    logger.info({ serverId }, 'Restarting MCP server');

    const instance = this.servers.get(serverId);
    if (instance) {
      instance.restartCount++;
    }

    await this.stopServer(serverId);
    await this.startServer(serverId);

    logger.info({ serverId }, 'MCP server restarted');
    this.emit('server:restarted', { serverId });
  }

  /**
   * Get all available tools (optionally filtered by server)
   */
  listTools(serverId?: string): Tool[] {
    if (serverId) {
      const tools = this.toolRegistry.get(serverId) || [];
      return tools.map((t) => ({ ...t, serverId }));
    }

    // Return all tools from all servers
    const allTools: Tool[] = [];
    for (const [id, tools] of this.toolRegistry.entries()) {
      allTools.push(...tools.map((t) => ({ ...t, serverId: id })));
    }
    return allTools;
  }

  /**
   * Get a specific tool definition
   */
  getTool(serverId: string, toolName: string): Tool | undefined {
    const tools = this.toolRegistry.get(serverId);
    if (!tools) {
      return undefined;
    }
    const tool = tools.find((t) => t.name === toolName);
    return tool ? { ...tool, serverId } : undefined;
  }

  /**
   * Get a client for a specific server
   */
  getClient(serverId: string): MCPClient | undefined {
    return this.clients.get(serverId);
  }

  /**
   * Get server instance
   */
  getServer(serverId: string): ServerInstance | undefined {
    return this.servers.get(serverId);
  }

  /**
   * Get all server IDs
   */
  getServerIds(): string[] {
    return Array.from(this.servers.keys());
  }

  /**
   * Check if a server is running
   */
  isServerRunning(serverId: string): boolean {
    return this.servers.has(serverId);
  }

  /**
   * Check if a server is healthy
   */
  isServerHealthy(serverId: string): boolean {
    const instance = this.servers.get(serverId);
    return instance?.healthy || false;
  }

  /**
   * Get health status for a server
   */
  getServerHealth(serverId: string): ServerHealth | undefined {
    const instance = this.servers.get(serverId);
    if (!instance) {
      return undefined;
    }

    const tools = this.toolRegistry.get(serverId) || [];
    const uptime = Date.now() - instance.startedAt;

    return {
      serverId,
      healthy: instance.healthy,
      uptime,
      restartCount: instance.restartCount,
      lastError: instance.lastHealthCheck
        ? undefined
        : 'No health check performed',
      toolCount: tools.length,
    };
  }

  /**
   * Get statistics for all servers
   */
  getStats(): MCPManagerStats {
    const serverHealth: ServerHealth[] = [];
    for (const serverId of this.servers.keys()) {
      const health = this.getServerHealth(serverId);
      if (health) {
        serverHealth.push(health);
      }
    }

    const averageLatency =
      this.stats.toolCallsTotal > 0
        ? this.stats.totalLatency / this.stats.toolCallsTotal
        : 0;

    return {
      serversRunning: this.servers.size,
      totalTools: this.listTools().length,
      toolCallsTotal: this.stats.toolCallsTotal,
      toolCallsSuccess: this.stats.toolCallsSuccess,
      toolCallsFailed: this.stats.toolCallsFailed,
      averageLatency,
      serverHealth,
    };
  }

  /**
   * Record a tool call for statistics
   */
  recordToolCall(success: boolean, latency: number): void {
    this.stats.toolCallsTotal++;
    if (success) {
      this.stats.toolCallsSuccess++;
    } else {
      this.stats.toolCallsFailed++;
    }
    this.stats.totalLatency += latency;
  }

  /**
   * Start health check loop for a server
   */
  private startHealthCheck(serverId: string): void {
    const instance = this.servers.get(serverId);
    if (!instance || !instance.config.healthCheck) {
      return;
    }

    const { interval, timeout } = instance.config.healthCheck;

    logger.debug(
      { serverId, interval, timeout },
      'Starting health check for server'
    );

    const healthCheckInterval = setInterval(async () => {
      await this.performHealthCheck(serverId, timeout);
    }, interval);

    this.healthCheckIntervals.set(serverId, healthCheckInterval);
  }

  /**
   * Perform a single health check
   */
  private async performHealthCheck(
    serverId: string,
    timeout: number
  ): Promise<void> {
    const client = this.clients.get(serverId);
    const instance = this.servers.get(serverId);

    if (!client || !instance) {
      return;
    }

    try {
      // Simple health check: try to list tools with timeout
      await Promise.race([
        client.listTools(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), timeout)
        ),
      ]);

      // Success
      instance.healthy = true;
      instance.lastHealthCheck = Date.now();
      logger.debug({ serverId }, 'Health check passed');
    } catch (error) {
      logger.warn({ serverId, error }, 'Health check failed');

      instance.healthy = false;
      instance.lastHealthCheck = Date.now();

      this.emit('server:unhealthy', { serverId, error });

      // Auto-restart if configured
      if (instance.config.autoRestart) {
        logger.info({ serverId }, 'Auto-restarting unhealthy server');
        await this.restartServer(serverId);
      }
    }
  }

  /**
   * Handle server error
   */
  private handleServerError(serverId: string, error: Error): void {
    const instance = this.servers.get(serverId);
    if (instance) {
      instance.healthy = false;
    }

    logger.error({ serverId, error }, 'Server error occurred');
    this.emit('server:error', { serverId, error });
  }

  /**
   * Handle server disconnection
   */
  private handleServerDisconnected(
    serverId: string,
    info: { code?: number; signal?: string }
  ): void {
    const instance = this.servers.get(serverId);
    if (!instance) {
      return;
    }

    instance.healthy = false;

    logger.warn({ serverId, info }, 'Server disconnected');

    // Auto-restart if configured
    if (instance.config.autoRestart && this.started) {
      logger.info({ serverId }, 'Auto-restarting disconnected server');
      setTimeout(async () => {
        try {
          await this.restartServer(serverId);
        } catch (error) {
          logger.error(
            { serverId, error },
            'Failed to auto-restart server'
          );
        }
      }, 5000); // Wait 5 seconds before restart
    }
  }
}

/**
 * Singleton instance
 */
let managerInstance: MCPServerManager | null = null;

/**
 * Get the singleton MCP server manager
 */
export function getMCPManager(): MCPServerManager {
  if (!managerInstance) {
    managerInstance = new MCPServerManager();
  }
  return managerInstance;
}

/**
 * Start the MCP server manager
 */
export async function startMCPManager(): Promise<MCPServerManager> {
  const manager = getMCPManager();
  await manager.start();
  return manager;
}

/**
 * Stop the MCP server manager
 */
export async function stopMCPManager(): Promise<void> {
  if (managerInstance) {
    await managerInstance.stop();
    managerInstance = null;
  }
}
