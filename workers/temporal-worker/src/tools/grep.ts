/**
 * GrepTool - Atomic tool for searching file contents using ripgrep.
 */

import { execa } from 'execa';
import { resolve, isAbsolute } from 'node:path';
import type { AtomicTool, ToolCategory, ToolContext, ToolResult, RiskLevel } from './types.js';

/**
 * Input parameters for grep search.
 */
export interface GrepInput {
  /** Pattern to search for (regex) */
  pattern: string;
  /** Path to search in (file or directory) */
  path?: string;
  /** Case-insensitive search */
  ignoreCase?: boolean;
  /** Glob pattern to filter files (e.g., "*.ts") */
  glob?: string;
  /** File type filter (e.g., "ts", "py") */
  fileType?: string;
  /** Show line numbers in output */
  showLineNumbers?: boolean;
  /** Number of context lines to show before match */
  contextBefore?: number;
  /** Number of context lines to show after match */
  contextAfter?: number;
  /** Maximum number of matches to return */
  maxResults?: number;
  /** Output mode: "content" or "files" */
  mode?: 'content' | 'files';
}

/**
 * Output from grep search.
 */
export interface GrepOutput {
  /** Search results */
  matches: GrepMatch[];
  /** Total number of matches found */
  totalMatches: number;
  /** Whether results were truncated */
  truncated: boolean;
  /** Raw output from ripgrep */
  rawOutput: string;
}

/**
 * A single grep match.
 */
export interface GrepMatch {
  /** File path */
  file: string;
  /** Line number (if available) */
  line?: number;
  /** Matching line content */
  content: string;
}

/**
 * Tool for searching file contents using ripgrep.
 *
 * Features:
 * - Fast regex-based search powered by ripgrep
 * - File type and glob filtering
 * - Context lines support
 * - Safe read-only operation
 */
export class GrepTool implements AtomicTool<GrepInput, GrepOutput> {
  readonly name = 'grep';
  readonly description = 'Search file contents using ripgrep';
  readonly category: ToolCategory = 'search' as ToolCategory;
  readonly riskLevel: RiskLevel = 'safe' as RiskLevel;
  readonly estimatedCost = 0.0001; // Essentially free

  validateInput(input: GrepInput): string[] {
    const errors: string[] = [];

    if (!input.pattern || input.pattern.trim().length === 0) {
      errors.push('pattern is required and cannot be empty');
    }

    if (input.contextBefore !== undefined && input.contextBefore < 0) {
      errors.push('contextBefore must be non-negative');
    }

    if (input.contextAfter !== undefined && input.contextAfter < 0) {
      errors.push('contextAfter must be non-negative');
    }

    if (input.maxResults !== undefined && input.maxResults <= 0) {
      errors.push('maxResults must be positive');
    }

    return errors;
  }

  async execute(
    input: GrepInput,
    context: ToolContext
  ): Promise<ToolResult<GrepOutput>> {
    const startTime = Date.now();

    try {
      // Build ripgrep arguments
      const args: string[] = [input.pattern];

      // Add path (default to workspace)
      const searchPath = input.path
        ? isAbsolute(input.path)
          ? input.path
          : resolve(context.workspace, input.path)
        : context.workspace;
      args.push(searchPath);

      // Add flags
      if (input.ignoreCase) {
        args.push('-i');
      }

      if (input.showLineNumbers !== false) {
        args.push('-n');
      }

      if (input.glob) {
        args.push('--glob', input.glob);
      }

      if (input.fileType) {
        args.push('--type', input.fileType);
      }

      if (input.contextBefore !== undefined) {
        args.push('-B', String(input.contextBefore));
      }

      if (input.contextAfter !== undefined) {
        args.push('-A', String(input.contextAfter));
      }

      if (input.maxResults !== undefined) {
        args.push('--max-count', String(input.maxResults));
      }

      // Set output mode
      if (input.mode === 'files') {
        args.push('--files-with-matches');
      }

      // Execute ripgrep
      const result = await execa('rg', args, {
        cwd: context.workspace,
        reject: false, // Don't throw on non-zero exit (no matches)
        timeout: 30000, // 30 second timeout
        signal: context.signal,
      });

      const rawOutput = result.stdout;

      // Parse output
      const matches: GrepMatch[] = [];

      if (input.mode === 'files') {
        // Files-only mode: one file path per line
        const files = rawOutput.split('\n').filter((line) => line.trim().length > 0);
        for (const file of files) {
          matches.push({
            file,
            content: '',
          });
        }
      } else {
        // Content mode: parse "file:line:content" format
        const lines = rawOutput.split('\n').filter((line) => line.trim().length > 0);
        for (const line of lines) {
          const match = line.match(/^([^:]+):(\d+):(.*)$/);
          if (match) {
            matches.push({
              file: match[1],
              line: parseInt(match[2], 10),
              content: match[3],
            });
          } else {
            // Fallback for lines without line numbers
            const simpleMatch = line.match(/^([^:]+):(.*)$/);
            if (simpleMatch) {
              matches.push({
                file: simpleMatch[1],
                content: simpleMatch[2],
              });
            }
          }
        }
      }

      const totalMatches = matches.length;
      const truncated =
        input.maxResults !== undefined && totalMatches >= input.maxResults;

      return {
        success: true,
        data: {
          matches,
          totalMatches,
          truncated,
          rawOutput,
        },
        output: `Found ${totalMatches} matches for pattern "${input.pattern}"`,
        cost: this.estimatedCost,
        duration: Date.now() - startTime,
        sideEffects: [],
      };
    } catch (error) {
      return {
        success: false,
        errors: [
          {
            code: 'GREP_ERROR',
            message: error instanceof Error ? error.message : String(error),
            cause: error instanceof Error ? error : undefined,
          },
        ],
        cost: this.estimatedCost,
        duration: Date.now() - startTime,
        sideEffects: [],
      };
    }
  }
}
