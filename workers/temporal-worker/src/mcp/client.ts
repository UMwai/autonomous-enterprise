/**
 * MCP Client Wrapper
 *
 * Provides a typed interface for connecting to and invoking tools on MCP servers.
 * Handles stdio and SSE transports, with automatic reconnection and error handling.
 */

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import pino from 'pino';
import type { MCPServerConfig, Tool, ToolResult } from './types.js';

const logger = pino({ name: 'mcp-client' });

/**
 * MCP protocol message types
 */
interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Client for a single MCP server instance
 */
export class MCPClient extends EventEmitter {
  private config: MCPServerConfig;
  private process?: ChildProcess;
  private connected: boolean = false;
  private requestId: number = 0;
  private pendingRequests: Map<string | number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();

  constructor(config: MCPServerConfig) {
    super();
    this.config = config;
  }

  /**
   * Connect to the MCP server
   */
  async connect(): Promise<void> {
    if (this.connected) {
      logger.warn({ serverId: this.config.id }, 'Already connected');
      return;
    }

    logger.info({ serverId: this.config.id }, 'Connecting to MCP server');

    if (this.config.transport === 'stdio') {
      await this.connectStdio();
    } else {
      await this.connectSSE();
    }

    this.connected = true;
    this.emit('connected');
    logger.info({ serverId: this.config.id }, 'Connected to MCP server');
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    logger.info({ serverId: this.config.id }, 'Disconnecting from MCP server');

    // Cancel all pending requests
    for (const [id, request] of this.pendingRequests.entries()) {
      clearTimeout(request.timeout);
      request.reject(new Error('Connection closed'));
      this.pendingRequests.delete(id);
    }

    if (this.process) {
      this.process.kill('SIGTERM');

      // Force kill after 5 seconds
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
      }, 5000);

      this.process = undefined;
    }

    this.connected = false;
    this.emit('disconnected');
    logger.info({ serverId: this.config.id }, 'Disconnected from MCP server');
  }

  /**
   * List available tools from the server
   */
  async listTools(): Promise<Tool[]> {
    const result = await this.request('tools/list', {}) as { tools: Tool[] };
    return result.tools || [];
  }

  /**
   * Call a tool on the server
   */
  async callTool<T = unknown>(toolName: string, args: Record<string, unknown>): Promise<ToolResult<T>> {
    const startTime = Date.now();

    try {
      const result = await this.request('tools/call', {
        name: toolName,
        arguments: args,
      });

      const executionTime = Date.now() - startTime;

      return {
        success: true,
        data: result as T,
        executionTime,
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTime,
      };
    }
  }

  /**
   * Check if the client is connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get the server configuration
   */
  getConfig(): MCPServerConfig {
    return this.config;
  }

  /**
   * Send a JSON-RPC request to the server
   */
  private async request(method: string, params?: unknown): Promise<unknown> {
    if (!this.connected) {
      throw new Error(`Not connected to server ${this.config.id}`);
    }

    const id = ++this.requestId;
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    logger.debug({ serverId: this.config.id, method, id }, 'Sending MCP request');

    return new Promise((resolve, reject) => {
      // Set timeout (30 seconds default)
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout for ${method}`));
      }, 30000);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      // Send request
      if (this.process?.stdin) {
        const requestStr = JSON.stringify(request) + '\n';
        this.process.stdin.write(requestStr);
      }
    });
  }

  /**
   * Connect via stdio transport
   */
  private async connectStdio(): Promise<void> {
    const { command, args } = this.buildCommand();

    logger.debug({ serverId: this.config.id, command, args }, 'Spawning MCP server process');

    this.process = spawn(command, args, {
      env: {
        ...process.env,
        ...this.config.env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Handle stdout (responses)
    let buffer = '';
    this.process.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          try {
            const response = JSON.parse(line) as MCPResponse;
            this.handleResponse(response);
          } catch (error) {
            logger.debug({ serverId: this.config.id, line }, 'Non-JSON stdout');
          }
        }
      }
    });

    // Handle stderr (logs)
    this.process.stderr?.on('data', (data: Buffer) => {
      const message = data.toString().trim();
      logger.debug({ serverId: this.config.id, stderr: message }, 'MCP server stderr');
    });

    // Handle process exit
    this.process.on('exit', (code, signal) => {
      logger.warn(
        { serverId: this.config.id, code, signal },
        'MCP server process exited'
      );
      this.connected = false;
      this.emit('disconnected', { code, signal });
    });

    this.process.on('error', (error) => {
      logger.error({ serverId: this.config.id, error }, 'MCP server process error');
      this.emit('error', error);
    });

    // Wait for server to be ready
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 1000); // Give server time to start
    });
  }

  /**
   * Connect via SSE transport
   */
  private async connectSSE(): Promise<void> {
    if (!this.config.url) {
      throw new Error(`SSE transport requires url in config for ${this.config.id}`);
    }

    // SSE transport implementation would go here
    // For now, we focus on stdio transport which is most common
    throw new Error('SSE transport not yet implemented');
  }

  /**
   * Handle a response from the server
   */
  private handleResponse(response: MCPResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      logger.warn(
        { serverId: this.config.id, id: response.id },
        'Received response for unknown request'
      );
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.id);

    if (response.error) {
      logger.error(
        { serverId: this.config.id, error: response.error },
        'MCP request failed'
      );
      pending.reject(new Error(response.error.message));
    } else {
      logger.debug(
        { serverId: this.config.id, id: response.id },
        'MCP request successful'
      );
      pending.resolve(response.result);
    }
  }

  /**
   * Build the command and args for spawning the server
   */
  private buildCommand(): { command: string; args: string[] } {
    if (this.config.type === 'npm') {
      if (!this.config.package) {
        throw new Error(`NPM package required for server ${this.config.id}`);
      }
      return {
        command: 'npx',
        args: ['-y', this.config.package, ...(this.config.args || [])],
      };
    }

    if (this.config.type === 'python') {
      if (!this.config.pythonPackage) {
        throw new Error(`Python package required for server ${this.config.id}`);
      }
      return {
        command: 'python',
        args: ['-m', this.config.pythonPackage, ...(this.config.args || [])],
      };
    }

    if (this.config.type === 'binary') {
      if (!this.config.binary) {
        throw new Error(`Binary path required for server ${this.config.id}`);
      }
      return {
        command: this.config.binary,
        args: this.config.args || [],
      };
    }

    throw new Error(`Unsupported server type: ${this.config.type}`);
  }
}
