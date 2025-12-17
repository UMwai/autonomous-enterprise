/**
 * Claude Code CLI Adapter
 *
 * Real adapter for running Claude Code CLI (`claude`) in headless mode.
 * Uses -p/--print for non-interactive execution with stream-json output.
 */

import { execa, ExecaChildProcess } from 'execa';
import stripAnsi from 'strip-ansi';
import type { AgentRunResult, FilePatch } from './harness.js';

/**
 * Options for Claude Code execution
 */
export interface ClaudeOptions {
  /** Timeout in milliseconds */
  timeout?: number;

  /** Mission log entries for context */
  missionLog?: string[];

  /** Error registry from previous attempts */
  errorRegistry?: string[];

  /** Current execution phase */
  currentPhase?: string;

  /** Additional directives */
  directives?: string[];

  /** Token budget */
  budget?: {
    maxTokens?: number;
    maxCost?: number;
  };

  /** Model to use (default: claude-opus-4-5-20251101) */
  model?: string;

  /** Output format (default: stream-json) */
  outputFormat?: 'stream-json' | 'text' | 'json';

  /** System prompt to prepend */
  systemPrompt?: string;

  /** Allowed tools (e.g., "Bash,Edit,Read") */
  allowedTools?: string[];

  /** Skip permission dialogs (for sandboxed execution) */
  dangerouslySkipPermissions?: boolean;

  /** Environment variables to pass */
  env?: Record<string, string>;

  /** Continue previous session */
  continueSession?: boolean;

  /** Resume specific session ID */
  resumeSession?: string;
}

/**
 * Streaming JSON event types from Claude Code
 */
interface ClaudeStreamEvent {
  type: 'system' | 'assistant' | 'user' | 'result';
  subtype?: string;
  message?: {
    content?: string | Array<{ type: string; text?: string; tool_use?: unknown }>;
  };
  tool_use?: {
    name: string;
    input: Record<string, unknown>;
  };
  result?: {
    output?: string;
    exit_code?: number;
  };
  session_id?: string;
  cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  is_error?: boolean;
}

/**
 * Claude Code CLI Adapter
 */
export class ClaudeCodeAdapter {
  private readonly claudeBinary: string;
  private readonly defaultModel: string = 'claude-opus-4-5-20251101';

  constructor(claudeBinary = 'claude') {
    this.claudeBinary = claudeBinary;
  }

  /**
   * Run Claude Code with the given prompt and options
   */
  async run(
    prompt: string,
    workspace: string,
    options: ClaudeOptions = {}
  ): Promise<AgentRunResult> {
    const startTime = Date.now();
    const timeout = options.timeout || 600000; // 10 minutes default

    try {
      // Build the enhanced prompt with context
      const enhancedPrompt = this.buildEnhancedPrompt(prompt, options);

      // Build command arguments
      const args = this.buildClaudeArgs(enhancedPrompt, options);

      console.log(`[ClaudeCodeAdapter] Running: ${this.claudeBinary} ${args.join(' ')}`);
      console.log(`[ClaudeCodeAdapter] Workspace: ${workspace}`);

      // Execute Claude Code CLI
      const result = await execa(this.claudeBinary, args, {
        cwd: workspace,
        timeout,
        env: {
          ...process.env,
          ...options.env,
          // Ensure Claude knows the workspace
          CLAUDE_CODE_WORKSPACE: workspace,
        },
        all: true, // Capture both stdout and stderr
        reject: false, // Don't throw on non-zero exit
      });

      // Parse the output
      const parsedResult = this.parseOutput(
        result.all || result.stdout,
        options.outputFormat || 'stream-json'
      );

      // Extract file patches
      const patches = this.extractPatches(parsedResult.structuredOutput);

      // Build final result
      const agentResult: AgentRunResult = {
        success: result.exitCode === 0 && parsedResult.errors.length === 0,
        output: result.all || result.stdout,
        structuredOutput: parsedResult.structuredOutput,
        patches,
        errors: parsedResult.errors,
        tokensUsed: parsedResult.tokensUsed,
        cost: parsedResult.cost,
        duration: Date.now() - startTime,
        exitCode: result.exitCode,
      };

      return agentResult;
    } catch (error) {
      const duration = Date.now() - startTime;

      return {
        success: false,
        output: error instanceof Error ? error.message : String(error),
        patches: [],
        errors: [
          {
            message: error instanceof Error ? error.message : String(error),
            type: error instanceof Error && error.message.includes('timed out')
              ? 'timeout'
              : 'execution',
            context: 'Claude Code execution failed',
          },
        ],
        tokensUsed: { total: 0 },
        duration,
        exitCode: -1,
      };
    }
  }

  /**
   * Run Claude Code interactively with streaming output
   */
  async runStreaming(
    prompt: string,
    workspace: string,
    options: ClaudeOptions = {},
    onEvent: (event: ClaudeStreamEvent) => void
  ): Promise<AgentRunResult> {
    const startTime = Date.now();
    const timeout = options.timeout || 600000;

    const enhancedPrompt = this.buildEnhancedPrompt(prompt, options);
    const args = this.buildClaudeArgs(enhancedPrompt, {
      ...options,
      outputFormat: 'stream-json',
    });

    return new Promise((resolve) => {
      const subprocess = execa(this.claudeBinary, args, {
        cwd: workspace,
        timeout,
        env: {
          ...process.env,
          ...options.env,
        },
        reject: false,
      });

      let fullOutput = '';
      const filesChanged: string[] = [];
      const commandsRun: string[] = [];
      const errors: AgentRunResult['errors'] = [];
      let cost: number | undefined;
      let sessionId: string | undefined;

      // Process streaming output
      subprocess.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          fullOutput += line + '\n';

          try {
            const event = JSON.parse(line) as ClaudeStreamEvent;
            onEvent(event);

            // Extract metadata from events
            if (event.session_id) sessionId = event.session_id;
            if (event.cost_usd) cost = event.cost_usd;

            // Track tool uses
            if (event.tool_use) {
              if (event.tool_use.name === 'Edit' || event.tool_use.name === 'Write') {
                const filePath = event.tool_use.input.file_path as string;
                if (filePath && !filesChanged.includes(filePath)) {
                  filesChanged.push(filePath);
                }
              }
              if (event.tool_use.name === 'Bash') {
                const command = event.tool_use.input.command as string;
                if (command) commandsRun.push(command);
              }
            }

            // Track errors
            if (event.is_error && event.result?.output) {
              errors.push({
                message: event.result.output,
                type: 'execution',
              });
            }
          } catch {
            // Not JSON, append as raw output
          }
        }
      });

      subprocess.on('close', (exitCode) => {
        const duration = Date.now() - startTime;

        resolve({
          success: exitCode === 0 && errors.length === 0,
          output: fullOutput,
          structuredOutput: {
            filesChanged,
            commandsRun,
            insights: [],
          },
          patches: filesChanged.map(path => ({ path, type: 'modify' as const })),
          errors,
          tokensUsed: { total: 0 },
          cost: cost ? { amount: cost, currency: 'USD' } : undefined,
          duration,
          exitCode: exitCode || 0,
        });
      });
    });
  }

  /**
   * Build enhanced prompt with context
   */
  private buildEnhancedPrompt(prompt: string, options: ClaudeOptions): string {
    const parts: string[] = [];

    // Add current phase context
    if (options.currentPhase) {
      parts.push(`## Current Phase: ${options.currentPhase}\n`);
    }

    // Add mission log context
    if (options.missionLog && options.missionLog.length > 0) {
      parts.push('## Mission Log (Recent History):');
      parts.push(options.missionLog.slice(-5).join('\n'));
      parts.push('');
    }

    // Add error registry
    if (options.errorRegistry && options.errorRegistry.length > 0) {
      parts.push('## Error Registry (Lessons Learned):');
      parts.push(options.errorRegistry.slice(-3).join('\n'));
      parts.push('');
    }

    // Add directives
    if (options.directives && options.directives.length > 0) {
      parts.push('## Directives:');
      parts.push(options.directives.join('\n'));
      parts.push('');
    }

    // Add budget warning
    if (options.budget?.maxCost) {
      parts.push(`## Budget: Maximum $${options.budget.maxCost} USD\n`);
    }

    // Add main prompt
    parts.push('## Task:');
    parts.push(prompt);

    return parts.join('\n');
  }

  /**
   * Build Claude CLI arguments
   */
  private buildClaudeArgs(prompt: string, options: ClaudeOptions): string[] {
    const args: string[] = [];

    // Non-interactive print mode
    args.push('-p', prompt);

    // Output format
    const format = options.outputFormat || 'stream-json';
    args.push('--output-format', format);

    // Model selection
    const model = options.model || this.defaultModel;
    args.push('--model', model);

    // Budget control
    if (options.budget?.maxCost) {
      args.push('--max-budget-usd', options.budget.maxCost.toString());
    }

    // Permission mode for automation
    if (options.dangerouslySkipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    // Allowed tools
    if (options.allowedTools && options.allowedTools.length > 0) {
      args.push('--tools', options.allowedTools.join(','));
    }

    // System prompt
    if (options.systemPrompt) {
      args.push('--system-prompt', options.systemPrompt);
    }

    // Session management
    if (options.continueSession) {
      args.push('--continue');
    } else if (options.resumeSession) {
      args.push('--resume', options.resumeSession);
    }

    return args;
  }

  /**
   * Parse Claude Code output
   */
  private parseOutput(
    output: string,
    format: string
  ): {
    structuredOutput: AgentRunResult['structuredOutput'];
    errors: AgentRunResult['errors'];
    tokensUsed: AgentRunResult['tokensUsed'];
    cost?: AgentRunResult['cost'];
  } {
    const result = {
      structuredOutput: {
        summary: '',
        filesChanged: [] as string[],
        commandsRun: [] as string[],
        insights: [] as string[],
      },
      errors: [] as AgentRunResult['errors'],
      tokensUsed: { total: 0, input: 0, output: 0 },
      cost: undefined as AgentRunResult['cost'],
    };

    const cleanOutput = stripAnsi(output);

    if (format === 'stream-json' || format === 'json') {
      const events = this.parseStreamJson(cleanOutput);

      for (const event of events) {
        // Extract cost
        if (event.cost_usd) {
          result.cost = { amount: event.cost_usd, currency: 'USD' };
        }

        // Extract file changes from tool uses
        if (event.tool_use) {
          if (event.tool_use.name === 'Edit' || event.tool_use.name === 'Write') {
            const filePath = event.tool_use.input?.file_path as string;
            if (filePath && !result.structuredOutput.filesChanged!.includes(filePath)) {
              result.structuredOutput.filesChanged!.push(filePath);
            }
          }
          if (event.tool_use.name === 'Bash') {
            const command = event.tool_use.input?.command as string;
            if (command) {
              result.structuredOutput.commandsRun!.push(command);
            }
          }
        }

        // Extract errors
        if (event.is_error && event.result?.output) {
          result.errors.push({
            message: event.result.output,
            type: 'execution',
          });
        }

        // Extract assistant messages as summary
        if (event.type === 'assistant' && event.message?.content) {
          if (typeof event.message.content === 'string') {
            result.structuredOutput.summary += event.message.content;
          }
        }
      }
    } else {
      // Parse text output
      this.parseTextOutput(cleanOutput, result.structuredOutput);
    }

    return result;
  }

  /**
   * Parse streaming JSON output
   */
  private parseStreamJson(output: string): ClaudeStreamEvent[] {
    const events: ClaudeStreamEvent[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      if (!line.trim() || !line.startsWith('{')) continue;

      try {
        const event = JSON.parse(line) as ClaudeStreamEvent;
        events.push(event);
      } catch {
        // Skip invalid JSON lines
      }
    }

    return events;
  }

  /**
   * Parse text output for file changes
   */
  private parseTextOutput(
    output: string,
    structured: NonNullable<AgentRunResult['structuredOutput']>
  ): void {
    // Extract file changes
    const fileChangeRegex = /(?:Created|Modified|Edited|Updated|Wrote)\s+(?:file\s+)?[`']?([^\s`'\n]+\.[a-zA-Z]+)[`']?/gi;
    let match;
    while ((match = fileChangeRegex.exec(output)) !== null) {
      const file = match[1];
      if (!structured.filesChanged!.includes(file)) {
        structured.filesChanged!.push(file);
      }
    }

    // Extract commands
    const commandRegex = /(?:Running|Executed|Command):\s*[`']([^`'\n]+)[`']/gi;
    while ((match = commandRegex.exec(output)) !== null) {
      structured.commandsRun!.push(match[1]);
    }
  }

  /**
   * Extract file patches from structured output
   */
  private extractPatches(
    structured: AgentRunResult['structuredOutput']
  ): FilePatch[] {
    const patches: FilePatch[] = [];

    if (!structured?.filesChanged) return patches;

    for (const filePath of structured.filesChanged) {
      patches.push({
        path: filePath,
        type: 'modify',
      });
    }

    return patches;
  }
}

/**
 * Activity function for Temporal
 */
export async function runClaudeCode(input: {
  prompt: string;
  workspace: string;
  options?: ClaudeOptions;
}): Promise<AgentRunResult> {
  const adapter = new ClaudeCodeAdapter();
  return adapter.run(input.prompt, input.workspace, input.options);
}
