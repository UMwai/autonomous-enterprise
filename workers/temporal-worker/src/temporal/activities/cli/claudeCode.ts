/**
 * Claude Code CLI Adapter
 *
 * Adapter for running Claude Code CLI in headless mode via subprocess.
 * Handles conversation history injection, streaming JSON parsing,
 * and extraction of file patches and errors from output.
 */

import { execa } from 'execa';
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

  /** Conversation history to inject */
  conversationHistory?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;

  /** Model to use (default: claude-sonnet-4-5) */
  model?: string;

  /** Output format (default: stream-json) */
  outputFormat?: 'stream-json' | 'text' | 'markdown';

  /** Environment variables to pass */
  env?: Record<string, string>;
}

/**
 * Streaming JSON event from Claude Code
 */
interface StreamEvent {
  type: 'tool_use' | 'text' | 'error' | 'completion' | 'token_usage';
  data?: unknown;
  content?: string;
  error?: string;
  tokens?: {
    input: number;
    output: number;
    total: number;
  };
}

/**
 * Claude Code CLI Adapter
 */
export class ClaudeCodeAdapter {
  private readonly claudeBinary: string;

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
    const timeout = options.timeout || 300000;

    try {
      // Build the enhanced prompt with context
      const enhancedPrompt = this.buildEnhancedPrompt(prompt, options);

      // Build command arguments
      const args = this.buildClaudeArgs(enhancedPrompt, options);

      // Execute Claude Code CLI
      const result = await execa(this.claudeBinary, args, {
        cwd: workspace,
        timeout,
        env: {
          ...process.env,
          ...options.env,
        },
        all: true, // Capture both stdout and stderr
        reject: false, // Don't throw on non-zero exit
      });

      // Parse the output
      const parsedResult = this.parseOutput(result.all || result.stdout, options.outputFormat);

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
      // Handle execution errors
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
   * Build enhanced prompt with context
   */
  private buildEnhancedPrompt(prompt: string, options: ClaudeOptions): string {
    const parts: string[] = [];

    // Add current phase context
    if (options.currentPhase) {
      parts.push(`# Current Phase: ${options.currentPhase}\n`);
    }

    // Add mission log context
    if (options.missionLog && options.missionLog.length > 0) {
      parts.push('# Mission Log (Recent History):');
      parts.push(options.missionLog.slice(-5).join('\n')); // Last 5 entries
      parts.push('');
    }

    // Add error registry
    if (options.errorRegistry && options.errorRegistry.length > 0) {
      parts.push('# Error Registry (Lessons Learned):');
      parts.push(options.errorRegistry.slice(-3).join('\n')); // Last 3 errors
      parts.push('');
    }

    // Add directives
    if (options.directives && options.directives.length > 0) {
      parts.push('# Directives:');
      parts.push(options.directives.join('\n'));
      parts.push('');
    }

    // Add token budget warning
    if (options.budget?.maxTokens) {
      parts.push(`# Token Budget: Maximum ${options.budget.maxTokens} tokens\n`);
    }

    // Add main prompt
    parts.push('# Task:');
    parts.push(prompt);

    return parts.join('\n');
  }

  /**
   * Build Claude CLI arguments
   */
  private buildClaudeArgs(prompt: string, options: ClaudeOptions): string[] {
    const args: string[] = [];

    // Prompt argument
    args.push('-p', prompt);

    // Output format
    const format = options.outputFormat || 'stream-json';
    args.push('--output-format', format);

    // Model selection
    if (options.model) {
      args.push('--model', options.model);
    }

    // Headless mode (no interactive prompts)
    args.push('--headless');

    return args;
  }

  /**
   * Parse Claude Code output
   */
  private parseOutput(
    output: string,
    format: string = 'stream-json'
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

    // Clean ANSI codes
    const cleanOutput = stripAnsi(output);

    if (format === 'stream-json') {
      // Parse streaming JSON events
      const events = this.parseStreamJson(cleanOutput);

      for (const event of events) {
        if (event.type === 'token_usage' && event.tokens) {
          result.tokensUsed = event.tokens;
        } else if (event.type === 'error' && event.error) {
          result.errors.push({
            message: event.error,
            type: 'execution',
          });
        } else if (event.type === 'tool_use' && event.data) {
          this.extractToolData(event.data, result.structuredOutput);
        } else if (event.type === 'text' && event.content) {
          result.structuredOutput.summary = (result.structuredOutput.summary || '') + event.content;
        }
      }
    } else {
      // Parse text/markdown output
      this.parseTextOutput(cleanOutput, result.structuredOutput);
    }

    return result;
  }

  /**
   * Parse streaming JSON output from Claude Code
   */
  parseStreamJson(output: string): StreamEvent[] {
    const events: StreamEvent[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      if (!line.trim() || !line.startsWith('{')) {
        continue;
      }

      try {
        const event = JSON.parse(line) as StreamEvent;
        events.push(event);
      } catch {
        // Skip invalid JSON lines
        continue;
      }
    }

    return events;
  }

  /**
   * Parse text output for file changes and commands
   */
  private parseTextOutput(
    output: string,
    structured: NonNullable<AgentRunResult['structuredOutput']>
  ): void {
    // Extract file changes
    const fileChangeRegex = /(?:Created|Modified|Edited|Updated)\s+(?:file\s+)?[`']?([^\s`']+\.(?:ts|js|json|md|yml|yaml|txt|py|go|java|rs))[`']?/gi;
    let match;
    while ((match = fileChangeRegex.exec(output)) !== null) {
      const file = match[1];
      if (!structured.filesChanged!.includes(file)) {
        structured.filesChanged!.push(file);
      }
    }

    // Extract commands
    const commandRegex = /(?:Running|Executed|Running command):\s*[`']([^`']+)[`']/gi;
    while ((match = commandRegex.exec(output)) !== null) {
      structured.commandsRun!.push(match[1]);
    }

    // Extract insights (look for bullet points or numbered lists)
    const insightRegex = /(?:^|\n)[-*]\s+(.+?)(?=\n|$)/gm;
    while ((match = insightRegex.exec(output)) !== null) {
      const insight = match[1].trim();
      if (insight.length > 10) { // Filter out very short items
        structured.insights!.push(insight);
      }
    }
  }

  /**
   * Extract data from tool use events
   */
  private extractToolData(
    data: unknown,
    structured: NonNullable<AgentRunResult['structuredOutput']>
  ): void {
    if (typeof data !== 'object' || !data) {
      return;
    }

    const toolData = data as Record<string, unknown>;

    // Extract file operations
    if (toolData.tool === 'write' || toolData.tool === 'edit') {
      const filePath = toolData.file_path || toolData.path;
      if (typeof filePath === 'string' && !structured.filesChanged!.includes(filePath)) {
        structured.filesChanged!.push(filePath);
      }
    }

    // Extract command executions
    if (toolData.tool === 'bash' || toolData.tool === 'shell') {
      const command = toolData.command;
      if (typeof command === 'string') {
        structured.commandsRun!.push(command);
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

    if (!structured?.filesChanged) {
      return patches;
    }

    for (const filePath of structured.filesChanged) {
      patches.push({
        path: filePath,
        type: 'modify', // Default to modify; could be enhanced to detect create vs modify
      });
    }

    return patches;
  }
}
