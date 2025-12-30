/**
 * Atomic Tools Layer - Export all tools and utilities.
 *
 * This module provides a complete toolkit for safe, tracked tool execution
 * with policy enforcement, budget tracking, and observability.
 */

// Core types and interfaces
export {
  ToolCategory,
  RiskLevel,
} from './types.js';

export type {
  AtomicTool,
  ToolContext,
  ToolResult,
  ToolError,
  SideEffect,
  ToolObserver,
  ToolRegistry,
  ToolInfo,
} from './types.js';

// Import for internal use in factory functions
import type { ToolObserver, ToolResult, ToolError } from './types.js';

// Registry
export { DefaultToolRegistry } from './registry.js';
import { DefaultToolRegistry } from './registry.js';

// Executor
export { ToolExecutor } from './executor.js';

// Concrete tools
export { ReadFileTool } from './read.js';
export type { ReadFileInput, ReadFileOutput } from './read.js';
import { ReadFileTool } from './read.js';

export { GrepTool } from './grep.js';
export type { GrepInput, GrepOutput, GrepMatch } from './grep.js';
import { GrepTool } from './grep.js';

export { ApplyPatchTool } from './edit.js';
export type { ApplyPatchInput, ApplyPatchOutput } from './edit.js';
import { ApplyPatchTool } from './edit.js';

export { RunCommandTool } from './bash.js';
export type { RunCommandInput, RunCommandOutput } from './bash.js';
import { RunCommandTool } from './bash.js';

export { DeployVercelTool } from './deploy.js';
export type { DeployVercelInput, DeployVercelOutput } from './deploy.js';
import { DeployVercelTool } from './deploy.js';

export { CreateStripeProductTool } from './billing.js';
export type { CreateStripeProductInput, CreateStripeProductOutput } from './billing.js';
import { CreateStripeProductTool } from './billing.js';

/**
 * Create a default tool registry with all built-in tools registered.
 *
 * @returns Configured tool registry
 */
export function createDefaultRegistry(): DefaultToolRegistry {
  const registry = new DefaultToolRegistry();

  // Register all built-in tools
  // SAFE risk level
  registry.register(new ReadFileTool());
  registry.register(new GrepTool());

  // LOW risk level
  registry.register(new ApplyPatchTool());

  // MEDIUM risk level
  registry.register(new RunCommandTool());

  // CRITICAL risk level
  registry.register(new DeployVercelTool());
  registry.register(new CreateStripeProductTool());

  return registry;
}

/**
 * Create a default tool observer that logs to console.
 *
 * @returns Console-based tool observer
 */
export function createConsoleObserver(): ToolObserver {
  return {
    onToolStart(toolName: string, input: unknown): void {
      console.log(`[TOOL START] ${toolName}`, { input });
    },

    onToolSuccess(toolName: string, result: ToolResult): void {
      console.log(`[TOOL SUCCESS] ${toolName}`, {
        cost: result.cost,
        duration: result.duration,
        sideEffects: result.sideEffects.length,
      });
    },

    onToolError(toolName: string, error: ToolError): void {
      console.error(`[TOOL ERROR] ${toolName}`, {
        code: error.code,
        message: error.message,
      });
    },

    onToolComplete(toolName: string, duration: number, cost: number): void {
      console.log(`[TOOL COMPLETE] ${toolName}`, { duration, cost });
    },
  };
}

/**
 * Create a no-op tool observer (for testing or when observability not needed).
 *
 * @returns No-op tool observer
 */
export function createNoopObserver(): ToolObserver {
  return {
    onToolStart(): void {},
    onToolSuccess(): void {},
    onToolError(): void {},
    onToolComplete(): void {},
  };
}
