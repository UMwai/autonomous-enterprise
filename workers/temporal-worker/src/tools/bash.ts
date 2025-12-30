/**
 * RunCommandTool - Atomic tool for executing shell commands.
 */

import { execa } from 'execa';
import stripAnsi from 'strip-ansi';
import { ActionType } from '../safety/policyClient.js';
import type { AtomicTool, ToolCategory, ToolContext, ToolResult, RiskLevel, SideEffect } from './types.js';

/**
 * Input parameters for running a command.
 */
export interface RunCommandInput {
  /** Command to execute */
  command: string;
  /** Arguments to pass to the command */
  args?: string[];
  /** Working directory (defaults to workspace) */
  cwd?: string;
  /** Environment variables to add/override */
  env?: Record<string, string>;
  /** Timeout in milliseconds (default: 60000) */
  timeout?: number;
  /** Whether to capture stderr separately */
  captureSeparateStreams?: boolean;
  /** Whether to strip ANSI color codes from output */
  stripAnsi?: boolean;
}

/**
 * Output from running a command.
 */
export interface RunCommandOutput {
  /** Command that was executed */
  command: string;
  /** Exit code */
  exitCode: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Combined output (if not capturing separately) */
  output: string;
  /** Whether command succeeded (exit code 0) */
  succeeded: boolean;
  /** Execution time in milliseconds */
  executionTime: number;
}

/**
 * Tool for executing shell commands.
 *
 * Features:
 * - Policy enforcement for code execution
 * - Configurable timeout
 * - Environment variable support
 * - ANSI stripping
 * - Detailed output capture
 */
export class RunCommandTool implements AtomicTool<RunCommandInput, RunCommandOutput> {
  readonly name = 'run_command';
  readonly description = 'Execute a shell command';
  readonly category: ToolCategory = 'shell' as ToolCategory;
  readonly riskLevel: RiskLevel = 'medium' as RiskLevel;
  readonly estimatedCost = 0.001; // Small cost for execution

  validateInput(input: RunCommandInput): string[] {
    const errors: string[] = [];

    if (!input.command || input.command.trim().length === 0) {
      errors.push('command is required and cannot be empty');
    }

    if (input.timeout !== undefined && input.timeout <= 0) {
      errors.push('timeout must be positive');
    }

    return errors;
  }

  async execute(
    input: RunCommandInput,
    context: ToolContext
  ): Promise<ToolResult<RunCommandOutput>> {
    const startTime = Date.now();
    const sideEffects: SideEffect[] = [];

    try {
      // Policy check for command execution
      const fullCommand = input.args
        ? `${input.command} ${input.args.join(' ')}`
        : input.command;

      const decision = await context.policyClient.checkAction(
        ActionType.EXECUTE_CODE,
        {
          command: fullCommand,
          cwd: input.cwd || context.workspace,
        }
      );

      if (!decision.allowed) {
        return {
          success: false,
          errors: [
            {
              code: 'POLICY_DENIED',
              message: `Command execution blocked by policy: ${decision.reason}`,
              context: { decision, command: fullCommand },
            },
          ],
          cost: 0,
          duration: Date.now() - startTime,
          sideEffects: [],
        };
      }

      // Prepare execution options
      const cwd = input.cwd || context.workspace;
      const timeout = input.timeout || 60000;
      const env = {
        ...context.env,
        ...input.env,
      };

      // Execute command
      const execStartTime = Date.now();
      const result = await execa(input.command, input.args || [], {
        cwd,
        env,
        timeout,
        reject: false, // Don't throw on non-zero exit
        all: !input.captureSeparateStreams, // Combine streams if not capturing separately
        signal: context.signal,
      });

      const executionTime = Date.now() - execStartTime;

      // Process output
      let stdout = result.stdout;
      let stderr = result.stderr;
      let output = result.all || '';

      if (input.stripAnsi !== false) {
        stdout = stripAnsi(stdout);
        stderr = stripAnsi(stderr);
        output = stripAnsi(output);
      }

      const succeeded = result.exitCode === 0;

      // Track side effect
      sideEffects.push({
        type: 'command',
        description: `Executed: ${fullCommand}`,
        resources: [cwd],
      });

      return {
        success: true,
        data: {
          command: fullCommand,
          exitCode: result.exitCode ?? 1,
          stdout,
          stderr,
          output,
          succeeded,
          executionTime,
        },
        output: `Command exited with code ${result.exitCode ?? 1}`,
        cost: this.estimatedCost,
        duration: Date.now() - startTime,
        sideEffects,
      };
    } catch (error) {
      // Handle errors (timeout, signal, etc.)
      let errorCode = 'EXECUTION_ERROR';
      let errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes('timed out')) {
        errorCode = 'TIMEOUT';
      } else if (errorMessage.includes('aborted')) {
        errorCode = 'ABORTED';
      }

      return {
        success: false,
        errors: [
          {
            code: errorCode,
            message: errorMessage,
            cause: error instanceof Error ? error : undefined,
          },
        ],
        cost: this.estimatedCost,
        duration: Date.now() - startTime,
        sideEffects,
      };
    }
  }
}
