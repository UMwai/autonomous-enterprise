/**
 * Core types for the Atomic Tools Layer.
 *
 * This module defines the fundamental interfaces and enums for the tool system,
 * including tool definitions, execution context, results, and observability.
 */

import type { PolicyClient } from '../safety/policyClient.js';
import type { BudgetClient } from '../safety/budgets.js';

/**
 * Categories of atomic tools.
 * Used for organizing tools and applying category-level policies.
 */
export enum ToolCategory {
  /** File reading operations */
  READ = 'read',
  /** Content search operations */
  SEARCH = 'search',
  /** Code and runtime inspection */
  INSPECT = 'inspect',
  /** File creation operations */
  WRITE = 'write',
  /** File modification operations */
  EDIT = 'edit',
  /** File and directory deletion */
  DELETE = 'delete',
  /** Shell command execution */
  SHELL = 'shell',
  /** Test execution and validation */
  TEST = 'test',
  /** Build and compilation operations */
  BUILD = 'build',
  /** Network and HTTP operations */
  NETWORK = 'network',
  /** Deployment operations */
  DEPLOY = 'deploy',
  /** Billing and payment operations */
  BILLING = 'billing',
}

/**
 * Risk levels for tool operations.
 * Used by policy engine to determine approval requirements.
 */
export enum RiskLevel {
  /** No risk - read-only operations */
  SAFE = 'safe',
  /** Low risk - isolated writes, reversible */
  LOW = 'low',
  /** Medium risk - multiple files, harder to reverse */
  MEDIUM = 'medium',
  /** High risk - destructive operations, deployments */
  HIGH = 'high',
  /** Critical risk - billing, production deploys */
  CRITICAL = 'critical',
}

/**
 * Side effect from a tool execution.
 * Tracks changes that can be rolled back if needed.
 */
export interface SideEffect {
  /** Type of side effect (file_write, file_delete, command, etc.) */
  type: string;
  /** Description of what changed */
  description: string;
  /** Affected resources (file paths, URLs, etc.) */
  resources: string[];
  /** Optional rollback action to undo the side effect */
  rollbackAction?: () => Promise<void>;
}

/**
 * Error from a tool execution.
 */
export interface ToolError {
  /** Error code or type */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Original error if caught from underlying system */
  cause?: Error;
  /** Additional context about the error */
  context?: Record<string, unknown>;
}

/**
 * Result from a tool execution.
 */
export interface ToolResult<T = unknown> {
  /** Whether the tool executed successfully */
  success: boolean;
  /** Typed result data (if successful) */
  data?: T;
  /** Raw output text (stdout, logs, etc.) */
  output?: string;
  /** Errors that occurred (if failed) */
  errors?: ToolError[];
  /** Cost in USD */
  cost: number;
  /** Execution duration in milliseconds */
  duration: number;
  /** Side effects produced by the execution */
  sideEffects: SideEffect[];
}

/**
 * Context provided to tool execution.
 * Contains all the infrastructure needed for safe, tracked execution.
 */
export interface ToolContext {
  /** Workspace directory (absolute path) */
  workspace: string;
  /** Unique run identifier for budget tracking */
  runId: string;
  /** Current workflow phase (genesis, build, ship, monetize) */
  phase: string;
  /** Budget limit for this run in USD */
  budget: number;
  /** Client for policy checks */
  policyClient: PolicyClient;
  /** Client for budget tracking */
  budgetClient: BudgetClient;
  /** Observer for metrics and logging */
  observer: ToolObserver;
  /** Environment variables */
  env: Record<string, string>;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

/**
 * Observer interface for tool execution metrics and events.
 * Implementations can send to logging, metrics, or tracing systems.
 */
export interface ToolObserver {
  /**
   * Called when a tool starts executing.
   */
  onToolStart(toolName: string, input: unknown): void;

  /**
   * Called when a tool completes successfully.
   */
  onToolSuccess(toolName: string, result: ToolResult): void;

  /**
   * Called when a tool fails.
   */
  onToolError(toolName: string, error: ToolError): void;

  /**
   * Called when a tool completes (success or failure).
   */
  onToolComplete(toolName: string, duration: number, cost: number): void;
}

/**
 * Core interface for all atomic tools.
 *
 * Tools are stateless, composable functions that:
 * - Accept typed input
 * - Return typed output wrapped in ToolResult
 * - Track cost and side effects
 * - Respect budget and policy constraints
 */
export interface AtomicTool<TInput = unknown, TOutput = unknown> {
  /** Unique identifier for the tool */
  readonly name: string;

  /** Human-readable description */
  readonly description: string;

  /** Category for organization and policy */
  readonly category: ToolCategory;

  /** Risk level for policy enforcement */
  readonly riskLevel: RiskLevel;

  /** Estimated cost in USD (base cost, actual may vary) */
  readonly estimatedCost: number;

  /**
   * Execute the tool with the given input and context.
   *
   * @param input - Tool-specific input parameters
   * @param context - Execution context with workspace, budget, policy clients
   * @returns Result with typed output, cost, duration, and side effects
   */
  execute(input: TInput, context: ToolContext): Promise<ToolResult<TOutput>>;

  /**
   * Validate input before execution.
   * Returns error messages if invalid, empty array if valid.
   *
   * @param input - Input to validate
   * @returns Array of validation error messages
   */
  validateInput(input: TInput): string[];
}

/**
 * Metadata about a registered tool.
 */
export interface ToolInfo {
  name: string;
  description: string;
  category: ToolCategory;
  riskLevel: RiskLevel;
  estimatedCost: number;
}

/**
 * Registry for discovering and retrieving tools.
 */
export interface ToolRegistry {
  /**
   * Register a tool in the registry.
   */
  register(tool: AtomicTool): void;

  /**
   * Get a tool by name.
   */
  get(name: string): AtomicTool | undefined;

  /**
   * Get all tools in a category.
   */
  getByCategory(category: ToolCategory): AtomicTool[];

  /**
   * Get all tools with risk level at or below the specified level.
   */
  getByMaxRisk(maxRisk: RiskLevel): AtomicTool[];

  /**
   * List all registered tools.
   */
  list(): ToolInfo[];
}
