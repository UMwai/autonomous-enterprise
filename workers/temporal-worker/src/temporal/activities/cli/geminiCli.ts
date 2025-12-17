/**
 * Gemini CLI Adapter
 *
 * Real adapter for running Gemini CLI (`gemini`) in headless mode.
 * Uses proper CLI flags for non-interactive execution with JSON output.
 */

import { execa } from 'execa';
import stripAnsi from 'strip-ansi';
import type { AgentRunResult, FilePatch } from './harness.js';

/**
 * Options for Gemini CLI execution
 */
export interface GeminiOptions {
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

  /** Model to use (default: gemini-3-pro-preview) */
  model?: string;

  /** Output format (default: stream-json) */
  outputFormat?: 'stream-json' | 'text' | 'json';

  /** Enable yolo mode (auto-approve all actions) */
  yoloMode?: boolean;

  /** Approval mode: never, auto, always */
  approvalMode?: 'never' | 'auto' | 'always';

  /** Enable sandbox mode */
  sandbox?: boolean;

  /** Project files to include as context using @ syntax */
  contextFiles?: string[];

  /** Environment variables to pass */
  env?: Record<string, string>;
}

/**
 * Streaming JSON event types from Gemini CLI
 */
interface GeminiStreamEvent {
  type: 'system' | 'model' | 'tool_use' | 'tool_result' | 'error';
  content?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: string;
  error?: string;
  tokens?: number;
}

/**
 * Gemini CLI Adapter
 */
export class GeminiCliAdapter {
  private readonly geminiBinary: string;
  private readonly defaultModel: string = 'gemini-3-pro-preview';

  constructor(geminiBinary = 'gemini') {
    this.geminiBinary = geminiBinary;
  }

  /**
   * Run Gemini CLI with the given prompt and options
   */
  async run(
    prompt: string,
    workspace: string,
    options: GeminiOptions = {}
  ): Promise<AgentRunResult> {
    const startTime = Date.now();
    const timeout = options.timeout || 600000; // 10 minutes default

    try {
      // Build the enhanced prompt with context
      const enhancedPrompt = this.buildEnhancedPrompt(prompt, options);

      // Build command arguments
      const args = this.buildGeminiArgs(enhancedPrompt, options);

      console.log(`[GeminiCliAdapter] Running: ${this.geminiBinary} ${args.join(' ')}`);
      console.log(`[GeminiCliAdapter] Workspace: ${workspace}`);

      // Execute Gemini CLI
      const result = await execa(this.geminiBinary, args, {
        cwd: workspace,
        timeout,
        env: {
          ...process.env,
          ...options.env,
          // Ensure Gemini knows the workspace
          GEMINI_WORKSPACE: workspace,
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
            context: 'Gemini CLI execution failed',
          },
        ],
        tokensUsed: { total: 0 },
        duration,
        exitCode: -1,
      };
    }
  }

  /**
   * Run Gemini CLI interactively with streaming output
   */
  async runStreaming(
    prompt: string,
    workspace: string,
    options: GeminiOptions = {},
    onEvent: (event: GeminiStreamEvent) => void
  ): Promise<AgentRunResult> {
    const startTime = Date.now();
    const timeout = options.timeout || 600000;

    const enhancedPrompt = this.buildEnhancedPrompt(prompt, options);
    const args = this.buildGeminiArgs(enhancedPrompt, {
      ...options,
      outputFormat: 'stream-json',
    });

    return new Promise((resolve) => {
      const subprocess = execa(this.geminiBinary, args, {
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
      let totalTokens = 0;

      // Process streaming output
      subprocess.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          fullOutput += line + '\n';

          try {
            const event = JSON.parse(line) as GeminiStreamEvent;
            onEvent(event);

            // Track token usage
            if (event.tokens) totalTokens += event.tokens;

            // Track tool uses for file changes
            if (event.tool_name === 'edit_file' || event.tool_name === 'write_file') {
              const filePath = event.tool_input?.path as string;
              if (filePath && !filesChanged.includes(filePath)) {
                filesChanged.push(filePath);
              }
            }

            // Track shell commands
            if (event.tool_name === 'shell' || event.tool_name === 'run_command') {
              const command = event.tool_input?.command as string;
              if (command) commandsRun.push(command);
            }

            // Track errors
            if (event.type === 'error' && event.error) {
              errors.push({
                message: event.error,
                type: 'execution',
              });
            }
          } catch {
            // Not JSON, append as raw output
          }
        }
      });

      subprocess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        fullOutput += text;

        if (text.toLowerCase().includes('error')) {
          errors.push({
            message: text.trim(),
            type: 'execution',
          });
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
          tokensUsed: { total: totalTokens },
          duration,
          exitCode: exitCode || 0,
        });
      });
    });
  }

  /**
   * Build enhanced prompt with context
   */
  private buildEnhancedPrompt(prompt: string, options: GeminiOptions): string {
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

    // Add main prompt
    parts.push('## Task:');
    parts.push(prompt);

    // Add context file references using @ syntax
    if (options.contextFiles && options.contextFiles.length > 0) {
      parts.push('\n## Context Files:');
      parts.push(options.contextFiles.map(f => `@${f}`).join(' '));
    }

    return parts.join('\n');
  }

  /**
   * Build Gemini CLI arguments
   */
  private buildGeminiArgs(prompt: string, options: GeminiOptions): string[] {
    const args: string[] = [];

    // Model selection
    const model = options.model || this.defaultModel;
    args.push('-m', model);

    // Output format
    const format = options.outputFormat || 'stream-json';
    args.push('-o', format);

    // Yolo mode (auto-approve all actions)
    if (options.yoloMode) {
      args.push('-y');
    }

    // Approval mode
    if (options.approvalMode) {
      args.push('--approval-mode', options.approvalMode);
    }

    // Sandbox mode
    if (options.sandbox) {
      args.push('-s');
    }

    // Add the prompt as positional argument at the end
    args.push(prompt);

    return args;
  }

  /**
   * Parse Gemini CLI output
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
        // Extract file changes from tool uses
        if (event.tool_name === 'edit_file' || event.tool_name === 'write_file') {
          const filePath = event.tool_input?.path as string;
          if (filePath && !result.structuredOutput.filesChanged!.includes(filePath)) {
            result.structuredOutput.filesChanged!.push(filePath);
          }
        }

        // Extract shell commands
        if (event.tool_name === 'shell' || event.tool_name === 'run_command') {
          const command = event.tool_input?.command as string;
          if (command) {
            result.structuredOutput.commandsRun!.push(command);
          }
        }

        // Extract errors
        if (event.type === 'error' && event.error) {
          result.errors.push({
            message: event.error,
            type: 'execution',
          });
        }

        // Extract model content as summary
        if (event.type === 'model' && event.content) {
          result.structuredOutput.summary += event.content;
        }

        // Track tokens
        if (event.tokens) {
          result.tokensUsed.total += event.tokens;
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
  private parseStreamJson(output: string): GeminiStreamEvent[] {
    const events: GeminiStreamEvent[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      if (!line.trim() || !line.startsWith('{')) continue;

      try {
        const event = JSON.parse(line) as GeminiStreamEvent;
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
    const fileChangeRegex = /(?:Created|Modified|Edited|Updated|Wrote)\\s+(?:file\\s+)?[`']?([^\\s`'\\n]+\\.[a-zA-Z]+)[`']?/gi;
    let match;
    while ((match = fileChangeRegex.exec(output)) !== null) {
      const file = match[1];
      if (!structured.filesChanged!.includes(file)) {
        structured.filesChanged!.push(file);
      }
    }

    // Extract commands
    const commandRegex = /(?:Running|Executed|Command):\\s*[`']([^`'\\n]+)[`']/gi;
    while ((match = commandRegex.exec(output)) !== null) {
      structured.commandsRun!.push(match[1]);
    }

    // Extract insights from bullet points
    const bulletRegex = /(?:^|\\n)[-*]\\s+(.+?)(?=\\n|$)/gm;
    while ((match = bulletRegex.exec(output)) !== null) {
      const insight = match[1].trim();
      if (insight.length > 15) {
        structured.insights!.push(insight);
      }
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
export async function runGeminiCli(input: {
  prompt: string;
  workspace: string;
  options?: GeminiOptions;
}): Promise<AgentRunResult> {
  const adapter = new GeminiCliAdapter();
  return adapter.run(input.prompt, input.workspace, input.options);
}
