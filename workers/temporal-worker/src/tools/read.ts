/**
 * ReadFileTool - Atomic tool for reading file contents.
 */

import { readFile } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import type { AtomicTool, ToolCategory, ToolContext, ToolResult, RiskLevel } from './types.js';

/**
 * Input parameters for reading a file.
 */
export interface ReadFileInput {
  /** Path to the file to read (absolute or relative to workspace) */
  path: string;
  /** Optional encoding (default: utf-8) */
  encoding?: BufferEncoding;
  /** Optional line offset to start reading from (0-indexed) */
  offset?: number;
  /** Optional number of lines to read */
  limit?: number;
}

/**
 * Output from reading a file.
 */
export interface ReadFileOutput {
  /** File contents */
  content: string;
  /** Absolute path to the file */
  path: string;
  /** File size in bytes */
  size: number;
  /** Number of lines in the content */
  lines: number;
  /** Whether the content was truncated */
  truncated: boolean;
}

/**
 * Tool for reading file contents.
 *
 * Features:
 * - Safe read-only operation (SAFE risk level)
 * - Supports absolute and relative paths
 * - Optional line-based pagination
 * - UTF-8 encoding by default
 */
export class ReadFileTool implements AtomicTool<ReadFileInput, ReadFileOutput> {
  readonly name = 'read_file';
  readonly description = 'Read contents of a file';
  readonly category: ToolCategory = 'read' as ToolCategory;
  readonly riskLevel: RiskLevel = 'safe' as RiskLevel;
  readonly estimatedCost = 0.0001; // Essentially free

  validateInput(input: ReadFileInput): string[] {
    const errors: string[] = [];

    if (!input.path || input.path.trim().length === 0) {
      errors.push('path is required and cannot be empty');
    }

    if (input.offset !== undefined && input.offset < 0) {
      errors.push('offset must be non-negative');
    }

    if (input.limit !== undefined && input.limit <= 0) {
      errors.push('limit must be positive');
    }

    return errors;
  }

  async execute(
    input: ReadFileInput,
    context: ToolContext
  ): Promise<ToolResult<ReadFileOutput>> {
    const startTime = Date.now();

    try {
      // Resolve path relative to workspace
      const absolutePath = isAbsolute(input.path)
        ? input.path
        : resolve(context.workspace, input.path);

      // Read file
      const encoding = input.encoding || 'utf-8';
      const content = await readFile(absolutePath, encoding);

      // Apply line-based pagination if requested
      let finalContent = content;
      let truncated = false;

      if (input.offset !== undefined || input.limit !== undefined) {
        const lines = content.split('\n');
        const offset = input.offset || 0;
        const limit = input.limit || lines.length;

        const selectedLines = lines.slice(offset, offset + limit);
        finalContent = selectedLines.join('\n');
        truncated = selectedLines.length < lines.length;
      }

      const lines = finalContent.split('\n').length;
      const size = Buffer.byteLength(finalContent, encoding);

      return {
        success: true,
        data: {
          content: finalContent,
          path: absolutePath,
          size,
          lines,
          truncated,
        },
        output: `Read ${lines} lines (${size} bytes) from ${absolutePath}`,
        cost: this.estimatedCost,
        duration: Date.now() - startTime,
        sideEffects: [],
      };
    } catch (error) {
      return {
        success: false,
        errors: [
          {
            code: 'READ_ERROR',
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
