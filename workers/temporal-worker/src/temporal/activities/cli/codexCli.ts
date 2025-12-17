/**
 * Codex CLI Adapter
 *
 * Real adapter for running OpenAI Codex CLI (`codex`) in headless mode.
 * Uses `codex exec` for non-interactive execution.
 */

import { execa } from 'execa';
import stripAnsi from 'strip-ansi';
import type { AgentRunResult, FilePatch } from './harness.js';

/**
 * Options for Codex CLI execution
 */
export interface CodexOptions {
  /** Timeout in milliseconds */
  timeout?: number;

  /** Mission log entries for context */
  missionLog?: string[];

  /** Error registry from previous attempts */
  errorRegistry?: string[];

  /** Current execution phase */
  currentPhase?: string;

  /** Model to use (default: gpt-5.2) */
  model?: string;

  /** Config overrides (key=value format) */
  configOverrides?: Record<string, string>;

  /** Images to attach to prompt */
  images?: string[];

  /** Resume last session */
  resumeLast?: boolean;

  /** Sandbox permissions */
  sandboxPermissions?: string[];

  /** Environment variables to pass */
  env?: Record<string, string>;

  /** Approval policy: untrusted, on-failure, on-request, never */
  approvalPolicy?: 'untrusted' | 'on-failure' | 'on-request' | 'never';

  /** Sandbox mode */
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
}

/**
 * Codex CLI Adapter
 */
export class CodexCliAdapter {
  private readonly codexBinary: string;
  private readonly defaultModel: string = 'gpt-5.2';

  constructor(codexBinary = 'codex') {
    this.codexBinary = codexBinary;
  }

  /**
   * Run Codex CLI with the given prompt and options
   */
  async run(
    prompt: string,
    workspace: string,
    options: CodexOptions = {}
  ): Promise<AgentRunResult> {
    const startTime = Date.now();
    const timeout = options.timeout || 600000; // 10 minutes default

    try {
      // Build the enhanced prompt with context
      const enhancedPrompt = this.buildEnhancedPrompt(prompt, options);

      // Build command arguments
      const args = this.buildCodexArgs(enhancedPrompt, options);

      console.log(`[CodexCliAdapter] Running: ${this.codexBinary} ${args.join(' ')}`);
      console.log(`[CodexCliAdapter] Workspace: ${workspace}`);

      // Execute Codex CLI using `exec` subcommand for non-interactive mode
      const result = await execa(this.codexBinary, args, {
        cwd: workspace,
        timeout,
        env: {
          ...process.env,
          ...options.env,
        },
        all: true,
        reject: false,
      });

      // Parse the output
      const parsedResult = this.parseOutput(result.all || result.stdout);

      // Extract file patches
      const patches = this.extractPatches(parsedResult.structuredOutput);

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
            context: 'Codex CLI execution failed',
          },
        ],
        tokensUsed: { total: 0 },
        duration,
        exitCode: -1,
      };
    }
  }

  /**
   * Run Codex in interactive mode with streaming
   */
  async runInteractive(
    prompt: string,
    workspace: string,
    options: CodexOptions = {},
    onOutput: (output: string) => void
  ): Promise<AgentRunResult> {
    const startTime = Date.now();
    const timeout = options.timeout || 600000;

    // For interactive mode, use the base command without `exec`
    const enhancedPrompt = this.buildEnhancedPrompt(prompt, options);
    const args = this.buildInteractiveArgs(enhancedPrompt, options);

    return new Promise((resolve) => {
      const subprocess = execa(this.codexBinary, args, {
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

      subprocess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        fullOutput += text;
        onOutput(text);

        // Parse output for file changes
        const fileMatches = text.match(/(?:Created|Modified|Wrote)\s+([^\s]+\.[a-zA-Z]+)/g);
        if (fileMatches) {
          for (const match of fileMatches) {
            const file = match.replace(/^(?:Created|Modified|Wrote)\s+/, '');
            if (!filesChanged.includes(file)) {
              filesChanged.push(file);
            }
          }
        }

        // Parse for commands
        const cmdMatches = text.match(/(?:Running|Executing):\s*`([^`]+)`/g);
        if (cmdMatches) {
          for (const match of cmdMatches) {
            const cmd = match.replace(/^(?:Running|Executing):\s*`/, '').replace(/`$/, '');
            commandsRun.push(cmd);
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
          tokensUsed: { total: 0 },
          duration,
          exitCode: exitCode || 0,
        });
      });
    });
  }

  /**
   * Build enhanced prompt with context
   */
  private buildEnhancedPrompt(prompt: string, options: CodexOptions): string {
    const parts: string[] = [];

    if (options.currentPhase) {
      parts.push(`## Current Phase: ${options.currentPhase}\n`);
    }

    if (options.missionLog && options.missionLog.length > 0) {
      parts.push('## Mission Log:');
      parts.push(options.missionLog.slice(-5).join('\n'));
      parts.push('');
    }

    if (options.errorRegistry && options.errorRegistry.length > 0) {
      parts.push('## Previous Errors:');
      parts.push(options.errorRegistry.slice(-3).join('\n'));
      parts.push('');
    }

    parts.push('## Task:');
    parts.push(prompt);

    return parts.join('\n');
  }

  /**
   * Build Codex CLI arguments for exec mode
   */
  private buildCodexArgs(prompt: string, options: CodexOptions): string[] {
    const args: string[] = [];

    // Use exec subcommand for non-interactive execution
    args.push('exec', prompt);

    // Model selection
    const model = options.model || this.defaultModel;
    args.push('-m', model);

    // Approval policy for automation
    if (options.approvalPolicy) {
      args.push('-c', `approval-policy="${options.approvalPolicy}"`);
    }

    // Sandbox mode
    if (options.sandboxMode) {
      args.push('-c', `sandbox="${options.sandboxMode}"`);
    }

    // Config overrides
    if (options.configOverrides) {
      for (const [key, value] of Object.entries(options.configOverrides)) {
        args.push('-c', `${key}=${value}`);
      }
    }

    // Images
    if (options.images && options.images.length > 0) {
      for (const image of options.images) {
        args.push('-i', image);
      }
    }

    return args;
  }

  /**
   * Build Codex CLI arguments for interactive mode
   */
  private buildInteractiveArgs(prompt: string, options: CodexOptions): string[] {
    const args: string[] = [];

    // Positional prompt (interactive mode)
    args.push(prompt);

    // Model selection
    const model = options.model || this.defaultModel;
    args.push('-m', model);

    // Config overrides
    if (options.configOverrides) {
      for (const [key, value] of Object.entries(options.configOverrides)) {
        args.push('-c', `${key}=${value}`);
      }
    }

    return args;
  }

  /**
   * Parse Codex output
   */
  private parseOutput(output: string): {
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
      tokensUsed: { total: 0 },
      cost: undefined as AgentRunResult['cost'],
    };

    const cleanOutput = stripAnsi(output);

    // Parse file changes
    const fileChangeRegex = /(?:Created|Modified|Wrote|Updated|Edited)\s+[`']?([^\s`'\n]+\.[a-zA-Z]+)[`']?/gi;
    let match;
    while ((match = fileChangeRegex.exec(cleanOutput)) !== null) {
      if (!result.structuredOutput.filesChanged!.includes(match[1])) {
        result.structuredOutput.filesChanged!.push(match[1]);
      }
    }

    // Parse commands
    const commandRegex = /(?:Running|Executing|Command):\s*[`']([^`'\n]+)[`']/gi;
    while ((match = commandRegex.exec(cleanOutput)) !== null) {
      result.structuredOutput.commandsRun!.push(match[1]);
    }

    // Parse errors
    const errorRegex = /(?:Error|Failed|Exception):\s*(.+?)(?:\n|$)/gi;
    while ((match = errorRegex.exec(cleanOutput)) !== null) {
      result.errors.push({
        message: match[1],
        type: 'execution',
      });
    }

    // Try to extract summary (first paragraph or main content)
    const paragraphs = cleanOutput.split('\n\n');
    if (paragraphs.length > 0) {
      result.structuredOutput.summary = paragraphs[0].substring(0, 500);
    }

    return result;
  }

  /**
   * Extract file patches
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
export async function runCodexCli(input: {
  prompt: string;
  workspace: string;
  options?: CodexOptions;
}): Promise<AgentRunResult> {
  const adapter = new CodexCliAdapter();
  return adapter.run(input.prompt, input.workspace, input.options);
}
