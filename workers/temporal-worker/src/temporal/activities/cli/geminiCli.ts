/**
 * Gemini CLI Adapter
 *
 * Adapter for running Gemini CLI (gemini-cli tool) via subprocess.
 * Handles context-aware execution in project directories and parses
 * Gemini's output for code changes and recommendations.
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

  /** Model to use (default: gemini-3.0-flash) */
  model?: string;

  /** Enable code execution mode */
  enableCodeExecution?: boolean;

  /** Project files to include as context */
  contextFiles?: string[];

  /** Environment variables to pass */
  env?: Record<string, string>;

  /** Maximum context length */
  maxContextLength?: number;
}

/**
 * Gemini CLI Adapter
 */
export class GeminiCliAdapter {
  private readonly geminiBinary: string;

  constructor(geminiBinary = 'gemini-cli') {
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
    const timeout = options.timeout || 300000;

    try {
      // Build the enhanced prompt with context
      const enhancedPrompt = this.buildEnhancedPrompt(prompt, options);

      // Build command arguments
      const args = this.buildGeminiArgs(enhancedPrompt, workspace, options);

      // Execute Gemini CLI
      const result = await execa(this.geminiBinary, args, {
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
      const parsedResult = this.parseOutput(result.all || result.stdout);

      // Extract file patches
      const patches = this.extractPatches(parsedResult.structuredOutput, workspace);

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
   * Build enhanced prompt with context
   */
  private buildEnhancedPrompt(prompt: string, options: GeminiOptions): string {
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
      parts.push('# Previous Errors to Avoid:');
      parts.push(options.errorRegistry.slice(-3).join('\n')); // Last 3 errors
      parts.push('');
    }

    // Add directives
    if (options.directives && options.directives.length > 0) {
      parts.push('# Additional Directives:');
      parts.push(options.directives.join('\n'));
      parts.push('');
    }

    // Add main prompt
    parts.push('# Task:');
    parts.push(prompt);

    // Add context file references if provided
    if (options.contextFiles && options.contextFiles.length > 0) {
      parts.push('\n# Context Files:');
      parts.push(options.contextFiles.map(f => `@${f}`).join(' '));
    }

    return parts.join('\n');
  }

  /**
   * Build Gemini CLI arguments
   */
  private buildGeminiArgs(
    prompt: string,
    _workspace: string,
    options: GeminiOptions
  ): string[] {
    const args: string[] = [];

    // Model selection
    if (options.model) {
      args.push('--model', options.model);
    }

    // Enable code execution if requested
    if (options.enableCodeExecution) {
      args.push('--code-execution');
    }

    // Add context files using @ syntax
    if (options.contextFiles && options.contextFiles.length > 0) {
      for (const file of options.contextFiles) {
        args.push('--context', `@${file}`);
      }
    }

    // Add the prompt
    args.push(prompt);

    return args;
  }

  /**
   * Parse Gemini CLI output
   */
  parseOutput(output: string): {
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

    // Extract summary (first paragraph or section)
    const summaryMatch = cleanOutput.match(/^(.+?)(?:\n\n|\n#)/s);
    if (summaryMatch) {
      result.structuredOutput.summary = summaryMatch[1].trim();
    }

    // Extract file references
    const fileRegex = /(?:File|Modified|Created|Updated):\s*[`']?([^\s`'\n]+\.(?:ts|js|json|md|yml|yaml|txt|py|go|java|rs))[`']?/gi;
    let match;
    while ((match = fileRegex.exec(cleanOutput)) !== null) {
      const file = match[1];
      if (!result.structuredOutput.filesChanged!.includes(file)) {
        result.structuredOutput.filesChanged!.push(file);
      }
    }

    // Also look for @file references
    const atFileRegex = /@([^\s]+\.(?:ts|js|json|md|yml|yaml|txt|py|go|java|rs))/gi;
    while ((match = atFileRegex.exec(cleanOutput)) !== null) {
      const file = match[1];
      if (!result.structuredOutput.filesChanged!.includes(file)) {
        result.structuredOutput.filesChanged!.push(file);
      }
    }

    // Extract code blocks (potential file changes)
    const codeBlockRegex = /```(?:typescript|javascript|json|yaml|python|go|java|rust)?\n([\s\S]+?)```/g;
    const codeBlocks: string[] = [];
    while ((match = codeBlockRegex.exec(cleanOutput)) !== null) {
      codeBlocks.push(match[1]);
    }

    // Extract recommendations/insights
    const insightRegex = /(?:Recommendation|Insight|Suggestion|Note):\s*(.+?)(?=\n\n|\n-|\n\d+\.|$)/gi;
    while ((match = insightRegex.exec(cleanOutput)) !== null) {
      result.structuredOutput.insights!.push(match[1].trim());
    }

    // Extract bullet points as insights
    const bulletRegex = /(?:^|\n)[-*]\s+(.+?)(?=\n|$)/gm;
    while ((match = bulletRegex.exec(cleanOutput)) !== null) {
      const insight = match[1].trim();
      if (insight.length > 15 && !insight.toLowerCase().includes('error')) {
        result.structuredOutput.insights!.push(insight);
      }
    }

    // Extract errors
    const errorRegex = /(?:Error|Failed|Exception|Warning):\s*(.+?)(?=\n\n|\n-|\n[A-Z]|$)/gi;
    while ((match = errorRegex.exec(cleanOutput)) !== null) {
      result.errors.push({
        message: match[1].trim(),
        type: 'execution',
      });
    }

    // Extract token usage if present
    const tokenRegex = /tokens?:\s*(\d+)/i;
    const tokenMatch = tokenRegex.exec(cleanOutput);
    if (tokenMatch) {
      result.tokensUsed.total = parseInt(tokenMatch[1], 10);
    }

    return result;
  }

  /**
   * Extract file patches from structured output
   */
  private extractPatches(
    structured: AgentRunResult['structuredOutput'],
    _workspace: string
  ): FilePatch[] {
    const patches: FilePatch[] = [];

    if (!structured?.filesChanged) {
      return patches;
    }

    for (const filePath of structured.filesChanged) {
      // Determine if this is a create or modify based on file existence
      // For now, default to modify
      patches.push({
        path: filePath,
        type: 'modify',
      });
    }

    return patches;
  }

  /**
   * Parse code execution results from Gemini output
   * Currently unused but available for future enhancement
   */
  /*
  private parseCodeExecutionResults(output: string): {
    executed: boolean;
    results: string[];
  } {
    const results: string[] = [];
    let executed = false;

    // Look for code execution markers
    const executionRegex = /Code execution result:\s*```\n([\s\S]+?)```/gi;
    let match;

    while ((match = executionRegex.exec(output)) !== null) {
      executed = true;
      results.push(match[1].trim());
    }

    return { executed, results };
  }
  */
}
