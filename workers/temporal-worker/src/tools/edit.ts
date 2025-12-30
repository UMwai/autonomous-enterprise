/**
 * ApplyPatchTool - Atomic tool for applying text patches to files.
 */

import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, isAbsolute, dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { ActionType } from '../safety/policyClient.js';
import type { AtomicTool, ToolCategory, ToolContext, ToolResult, RiskLevel, SideEffect } from './types.js';

/**
 * Input parameters for applying a patch.
 */
export interface ApplyPatchInput {
  /** Path to the file to edit */
  path: string;
  /** Text to search for and replace */
  oldText: string;
  /** Text to replace with */
  newText: string;
  /** Replace all occurrences (default: false) */
  replaceAll?: boolean;
  /** Create backup before editing */
  createBackup?: boolean;
}

/**
 * Output from applying a patch.
 */
export interface ApplyPatchOutput {
  /** Absolute path to the edited file */
  path: string;
  /** Number of replacements made */
  replacements: number;
  /** Path to backup file (if created) */
  backupPath?: string;
  /** Size of the modified file in bytes */
  size: number;
}

/**
 * Tool for applying text patches to files.
 *
 * Features:
 * - Exact string replacement
 * - Optional replace-all mode
 * - Automatic backup creation
 * - Policy enforcement for file writes
 * - Rollback support via side effects
 */
export class ApplyPatchTool implements AtomicTool<ApplyPatchInput, ApplyPatchOutput> {
  readonly name = 'apply_patch';
  readonly description = 'Apply text patch to a file';
  readonly category: ToolCategory = 'edit' as ToolCategory;
  readonly riskLevel: RiskLevel = 'low' as RiskLevel;
  readonly estimatedCost = 0.0001;

  validateInput(input: ApplyPatchInput): string[] {
    const errors: string[] = [];

    if (!input.path || input.path.trim().length === 0) {
      errors.push('path is required and cannot be empty');
    }

    if (input.oldText === undefined || input.oldText === null) {
      errors.push('oldText is required');
    }

    if (input.newText === undefined || input.newText === null) {
      errors.push('newText is required');
    }

    if (input.oldText === input.newText) {
      errors.push('oldText and newText must be different');
    }

    return errors;
  }

  async execute(
    input: ApplyPatchInput,
    context: ToolContext
  ): Promise<ToolResult<ApplyPatchOutput>> {
    const startTime = Date.now();
    const sideEffects: SideEffect[] = [];

    try {
      // Resolve path
      const absolutePath = isAbsolute(input.path)
        ? input.path
        : resolve(context.workspace, input.path);

      // Policy check for file write
      const decision = await context.policyClient.checkAction(
        ActionType.EXECUTE_CODE,
        {
          operation: 'file_write',
          path: absolutePath,
        }
      );

      if (!decision.allowed) {
        return {
          success: false,
          errors: [
            {
              code: 'POLICY_DENIED',
              message: `File write blocked by policy: ${decision.reason}`,
              context: { decision },
            },
          ],
          cost: 0,
          duration: Date.now() - startTime,
          sideEffects: [],
        };
      }

      // Read current content
      const originalContent = await readFile(absolutePath, 'utf-8');

      // Create backup if requested
      let backupPath: string | undefined;
      if (input.createBackup) {
        backupPath = `${absolutePath}.backup`;
        await copyFile(absolutePath, backupPath);

        sideEffects.push({
          type: 'file_write',
          description: `Created backup at ${backupPath}`,
          resources: [backupPath],
        });
      }

      // Apply replacement
      let newContent: string;
      let replacements = 0;

      if (input.replaceAll) {
        // Replace all occurrences
        const parts = originalContent.split(input.oldText);
        replacements = parts.length - 1;
        newContent = parts.join(input.newText);
      } else {
        // Replace first occurrence only
        const index = originalContent.indexOf(input.oldText);
        if (index === -1) {
          return {
            success: false,
            errors: [
              {
                code: 'PATTERN_NOT_FOUND',
                message: `Pattern not found in file: ${input.oldText}`,
              },
            ],
            cost: this.estimatedCost,
            duration: Date.now() - startTime,
            sideEffects,
          };
        }

        newContent =
          originalContent.slice(0, index) +
          input.newText +
          originalContent.slice(index + input.oldText.length);
        replacements = 1;
      }

      // Ensure directory exists
      await mkdir(dirname(absolutePath), { recursive: true });

      // Write modified content
      await writeFile(absolutePath, newContent, 'utf-8');

      // Track side effect with rollback
      sideEffects.push({
        type: 'file_write',
        description: `Modified ${absolutePath} (${replacements} replacements)`,
        resources: [absolutePath],
        rollbackAction: async () => {
          // Rollback: restore original content
          await writeFile(absolutePath, originalContent, 'utf-8');
        },
      });

      const size = Buffer.byteLength(newContent, 'utf-8');

      return {
        success: true,
        data: {
          path: absolutePath,
          replacements,
          backupPath,
          size,
        },
        output: `Applied ${replacements} replacement(s) to ${absolutePath}`,
        cost: this.estimatedCost,
        duration: Date.now() - startTime,
        sideEffects,
      };
    } catch (error) {
      return {
        success: false,
        errors: [
          {
            code: 'EDIT_ERROR',
            message: error instanceof Error ? error.message : String(error),
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
