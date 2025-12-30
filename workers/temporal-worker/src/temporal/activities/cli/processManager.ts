/**
 * CLI Process Manager
 *
 * Manages multiple CLI agent sessions with lifecycle control,
 * output streaming, and resource cleanup.
 */

import { execa, type ResultPromise } from 'execa';
import { EventEmitter } from 'events';
import type { AgentRunResult } from './harness.js';

/**
 * Session status
 */
export type SessionStatus = 'starting' | 'running' | 'completed' | 'failed' | 'killed';

/**
 * Session metadata
 */
export interface SessionInfo {
  /** Unique session ID */
  id: string;

  /** Agent provider (claude, gemini, codex) */
  provider: 'claude' | 'gemini' | 'codex';

  /** Current status */
  status: SessionStatus;

  /** Workspace directory */
  workspace: string;

  /** Original prompt */
  prompt: string;

  /** Start timestamp */
  startedAt: Date;

  /** End timestamp */
  endedAt?: Date;

  /** Process ID */
  pid?: number;

  /** Exit code */
  exitCode?: number;

  /** Accumulated output */
  output: string;

  /** Collected errors */
  errors: string[];
}

/**
 * Session options
 */
export interface SessionOptions {
  /** Timeout in milliseconds */
  timeout?: number;

  /** Model to use */
  model?: string;

  /** Auto-approve mode */
  autoApprove?: boolean;

  /** Environment variables */
  env?: Record<string, string>;

  /** Additional CLI arguments */
  extraArgs?: string[];
}

/**
 * Process output event
 */
export interface ProcessOutputEvent {
  sessionId: string;
  type: 'stdout' | 'stderr';
  data: string;
  timestamp: Date;
}

/**
 * CLI Process Manager
 */
export class CliProcessManager extends EventEmitter {
  private sessions: Map<string, SessionInfo> = new Map();
  private processes: Map<string, ResultPromise> = new Map();
  private outputBuffers: Map<string, string[]> = new Map();

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Start a new CLI session
   */
  async startSession(
    provider: 'claude' | 'gemini' | 'codex',
    prompt: string,
    workspace: string,
    options: SessionOptions = {}
  ): Promise<string> {
    const sessionId = this.generateSessionId();
    const timeout = options.timeout || 600000; // 10 minutes default

    // Build command and arguments based on provider
    const { command, args } = this.buildCommand(provider, prompt, options);

    // Create session info
    const session: SessionInfo = {
      id: sessionId,
      provider,
      status: 'starting',
      workspace,
      prompt,
      startedAt: new Date(),
      output: '',
      errors: [],
    };

    this.sessions.set(sessionId, session);
    this.outputBuffers.set(sessionId, []);

    try {
      // Start the subprocess
      const subprocess = execa(command, args, {
        cwd: workspace,
        timeout,
        env: {
          ...globalThis.process.env,
          ...options.env,
        },
        reject: false,
      });

      this.processes.set(sessionId, subprocess);
      session.status = 'running';
      session.pid = subprocess.pid;

      // Handle stdout
      subprocess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        session.output += text;
        this.outputBuffers.get(sessionId)?.push(text);

        this.emit('output', {
          sessionId,
          type: 'stdout',
          data: text,
          timestamp: new Date(),
        } as ProcessOutputEvent);
      });

      // Handle stderr
      subprocess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        session.output += text;
        session.errors.push(text);

        this.emit('output', {
          sessionId,
          type: 'stderr',
          data: text,
          timestamp: new Date(),
        } as ProcessOutputEvent);
      });

      // Handle process completion
      subprocess.on('close', (exitCode: number | null) => {
        session.status = exitCode === 0 ? 'completed' : 'failed';
        session.endedAt = new Date();
        session.exitCode = exitCode || 0;
        this.processes.delete(sessionId);

        this.emit('session-complete', {
          sessionId,
          success: exitCode === 0,
          exitCode: exitCode || 0,
        });
      });

      return sessionId;
    } catch (error) {
      session.status = 'failed';
      session.endedAt = new Date();
      session.errors.push(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Build command and arguments for provider
   */
  private buildCommand(
    provider: 'claude' | 'gemini' | 'codex',
    prompt: string,
    options: SessionOptions
  ): { command: string; args: string[] } {
    const args: string[] = [];

    switch (provider) {
      case 'claude':
        // Claude Code CLI
        args.push('-p', prompt);
        args.push('--output-format', 'stream-json');
        if (options.model) {
          args.push('--model', options.model);
        }
        if (options.autoApprove) {
          args.push('--dangerously-skip-permissions');
        }
        if (options.extraArgs) {
          args.push(...options.extraArgs);
        }
        return { command: 'claude', args };

      case 'gemini':
        // Gemini CLI
        if (options.model) {
          args.push('-m', options.model);
        }
        args.push('-o', 'stream-json');
        if (options.autoApprove) {
          args.push('-y'); // yolo mode
        }
        args.push(prompt);
        if (options.extraArgs) {
          args.push(...options.extraArgs);
        }
        return { command: 'gemini', args };

      case 'codex':
        // Codex CLI
        args.push('exec', prompt);
        if (options.model) {
          args.push('-m', options.model);
        }
        if (options.autoApprove) {
          args.push('-c', 'approval-policy="never"');
        }
        if (options.extraArgs) {
          args.push(...options.extraArgs);
        }
        return { command: 'codex', args };

      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  /**
   * Get session information
   */
  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all sessions
   */
  getAllSessions(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get active sessions
   */
  getActiveSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.status === 'running' || s.status === 'starting'
    );
  }

  /**
   * Get session output
   */
  getSessionOutput(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.output;
  }

  /**
   * Get new output since last read
   */
  getNewOutput(sessionId: string): string[] {
    const buffer = this.outputBuffers.get(sessionId);
    if (!buffer) return [];

    const output = [...buffer];
    buffer.length = 0; // Clear buffer
    return output;
  }

  /**
   * Kill a session
   */
  async killSession(sessionId: string): Promise<boolean> {
    const process = this.processes.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!process || !session) {
      return false;
    }

    try {
      process.kill('SIGTERM');

      // Give it 5 seconds to terminate gracefully
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Force kill if still running
      if (this.processes.has(sessionId)) {
        process.kill('SIGKILL');
      }

      session.status = 'killed';
      session.endedAt = new Date();
      this.processes.delete(sessionId);

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Kill all sessions
   */
  async killAllSessions(): Promise<void> {
    const sessionIds = Array.from(this.processes.keys());
    await Promise.all(sessionIds.map((id) => this.killSession(id)));
  }

  /**
   * Wait for session to complete
   */
  async waitForSession(
    sessionId: string,
    timeoutMs?: number
  ): Promise<AgentRunResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // If already completed, return result immediately
    if (session.status === 'completed' || session.status === 'failed' || session.status === 'killed') {
      return this.buildResult(session);
    }

    // Wait for completion
    return new Promise((resolve, reject) => {
      const timeout = timeoutMs
        ? setTimeout(() => {
            this.killSession(sessionId);
            reject(new Error(`Session timed out: ${sessionId}`));
          }, timeoutMs)
        : null;

      const handler = (event: { sessionId: string; success: boolean; exitCode: number }) => {
        if (event.sessionId === sessionId) {
          if (timeout) clearTimeout(timeout);
          this.off('session-complete', handler);

          const updatedSession = this.sessions.get(sessionId)!;
          resolve(this.buildResult(updatedSession));
        }
      };

      this.on('session-complete', handler);
    });
  }

  /**
   * Build AgentRunResult from session
   */
  private buildResult(session: SessionInfo): AgentRunResult {
    const duration = session.endedAt
      ? session.endedAt.getTime() - session.startedAt.getTime()
      : Date.now() - session.startedAt.getTime();

    return {
      success: session.status === 'completed' && session.errors.length === 0,
      output: session.output,
      patches: [],
      errors: session.errors.map((e) => ({
        message: e,
        type: 'execution' as const,
      })),
      tokensUsed: { total: 0 },
      duration,
      exitCode: session.exitCode,
    };
  }

  /**
   * Cleanup completed sessions older than maxAge
   */
  cleanup(maxAgeMs: number = 3600000): number {
    const cutoff = Date.now() - maxAgeMs;
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (
        session.endedAt &&
        session.endedAt.getTime() < cutoff &&
        !this.processes.has(sessionId)
      ) {
        this.sessions.delete(sessionId);
        this.outputBuffers.delete(sessionId);
        cleaned++;
      }
    }

    return cleaned;
  }
}

// Singleton instance for shared use
let processManagerInstance: CliProcessManager | null = null;

/**
 * Get the shared process manager instance
 */
export function getProcessManager(): CliProcessManager {
  if (!processManagerInstance) {
    processManagerInstance = new CliProcessManager();
  }
  return processManagerInstance;
}

/**
 * Activity: Start a CLI session
 */
export async function startCliSession(input: {
  provider: 'claude' | 'gemini' | 'codex';
  prompt: string;
  workspace: string;
  options?: SessionOptions;
}): Promise<string> {
  const manager = getProcessManager();
  return manager.startSession(
    input.provider,
    input.prompt,
    input.workspace,
    input.options
  );
}

/**
 * Activity: Get session status
 */
export function getCliSessionStatus(sessionId: string): SessionInfo | undefined {
  const manager = getProcessManager();
  return manager.getSession(sessionId);
}

/**
 * Activity: Get session output
 */
export function getCliSessionOutput(sessionId: string): string | undefined {
  const manager = getProcessManager();
  return manager.getSessionOutput(sessionId);
}

/**
 * Activity: Wait for session to complete
 */
export async function waitForCliSession(input: {
  sessionId: string;
  timeoutMs?: number;
}): Promise<AgentRunResult> {
  const manager = getProcessManager();
  return manager.waitForSession(input.sessionId, input.timeoutMs);
}

/**
 * Activity: Kill a CLI session
 */
export async function killCliSession(sessionId: string): Promise<boolean> {
  const manager = getProcessManager();
  return manager.killSession(sessionId);
}
