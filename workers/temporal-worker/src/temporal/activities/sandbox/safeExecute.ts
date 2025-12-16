/**
 * Safe code execution activity with policy checks and budget tracking.
 */

import { Context } from '@temporalio/activity';
import pino from 'pino';
import { E2BSandbox, ExecutionResult, SandboxSession } from './e2b';
import { PolicyClient, BudgetClient, ActionType } from '../../../safety';

const logger = pino();

/**
 * Input for safe code execution.
 */
export interface SafeExecuteInput {
  runId: string;
  command: string;
  workspaceFiles?: Array<{ path: string; content: string }>;
  timeout?: number;
  allowedDomains?: string[];
}

/**
 * Result of safe code execution with safety metadata.
 */
export interface SafeExecuteResult extends ExecutionResult {
  cost: number;
  budgetRemaining: number;
  policyChecked: boolean;
}

/**
 * Configuration for safe execution.
 */
interface SafeExecuteConfig {
  apiUrl: string;
  costPerExecution: number;
  defaultTimeout: number;
}

const DEFAULT_CONFIG: SafeExecuteConfig = {
  apiUrl: process.env.API_URL || 'http://localhost:8000',
  costPerExecution: 0.01,
  defaultTimeout: 60000,
};

/**
 * Execute code safely with policy checks and budget tracking.
 *
 * This activity:
 * 1. Checks policy to ensure code execution is allowed
 * 2. Checks budget to ensure sufficient funds
 * 3. Creates isolated E2B sandbox
 * 4. Executes code with timeout
 * 5. Records actual cost
 * 6. Cleans up resources
 *
 * @param input - Safe execution parameters
 * @param config - Optional configuration override
 * @returns Execution result with safety metadata
 */
export async function safeExecuteCode(
  input: SafeExecuteInput,
  config: Partial<SafeExecuteConfig> = {}
): Promise<SafeExecuteResult> {
  const effectiveConfig = { ...DEFAULT_CONFIG, ...config };
  const { runId, command, workspaceFiles = [], timeout = effectiveConfig.defaultTimeout, allowedDomains } = input;

  logger.info({ runId, command }, 'Starting safe code execution');

  // Initialize clients
  const policyClient = new PolicyClient(effectiveConfig.apiUrl);
  const budgetClient = new BudgetClient(effectiveConfig.apiUrl);

  let session: SandboxSession | null = null;

  try {
    // Step 1: Check policy
    logger.info({ command }, 'Checking policy');
    const policyDecision = await policyClient.checkCodeExecution(command);

    if (!policyDecision.allowed) {
      throw new Error(`Policy check failed: ${policyDecision.reason}`);
    }

    if (policyDecision.requires_approval) {
      throw new Error(`Action requires human approval: ${policyDecision.reason}`);
    }

    // Step 2: Check budget
    logger.info({ runId, cost: effectiveConfig.costPerExecution }, 'Checking budget');
    const canSpend = await budgetClient.canSpend(runId, effectiveConfig.costPerExecution);

    if (!canSpend) {
      const status = await budgetClient.getStatus(runId);
      throw new Error(
        `Budget limit exceeded: Remaining $${status.remaining} of $${status.limit}`
      );
    }

    // Step 3: Create sandbox
    logger.info('Creating E2B sandbox');
    session = await E2BSandbox.create('base', {
      timeoutMs: timeout,
      networkAllowlist: allowedDomains,
    });

    // Step 4: Upload workspace files if provided
    if (workspaceFiles.length > 0) {
      logger.info({ fileCount: workspaceFiles.length }, 'Uploading workspace files');
      await E2BSandbox.uploadFiles(session, workspaceFiles);
    }

    // Step 5: Execute command
    logger.info({ sessionId: session.id, command }, 'Executing command in sandbox');

    // Heartbeat for Temporal
    if (Context.current().info.isLocal === false) {
      Context.current().heartbeat({ status: 'executing', sessionId: session.id });
    }

    const result = await E2BSandbox.execute(session, command, timeout);

    // Step 6: Record cost
    logger.info({ cost: effectiveConfig.costPerExecution }, 'Recording cost');
    const budgetStatus = await budgetClient.spend(runId, effectiveConfig.costPerExecution);

    logger.info(
      {
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        budgetRemaining: budgetStatus.remaining,
      },
      'Safe execution completed'
    );

    return {
      ...result,
      cost: effectiveConfig.costPerExecution,
      budgetRemaining: budgetStatus.remaining,
      policyChecked: true,
    };

  } catch (error) {
    logger.error({ error, runId, command }, 'Safe execution failed');
    throw error;

  } finally {
    // Step 7: Always cleanup sandbox
    if (session) {
      logger.info({ sessionId: session.id }, 'Cleaning up sandbox');
      await E2BSandbox.destroy(session);
    }
  }
}

/**
 * Execute multiple commands sequentially in the same sandbox.
 *
 * This is useful for multi-step operations like:
 * 1. Install dependencies
 * 2. Run build
 * 3. Run tests
 *
 * @param input - Execution input with multiple commands
 * @param config - Optional configuration override
 * @returns Results of all executions
 */
export async function safeExecuteBatch(
  input: {
    runId: string;
    commands: string[];
    workspaceFiles?: Array<{ path: string; content: string }>;
    timeout?: number;
    allowedDomains?: string[];
  },
  config: Partial<SafeExecuteConfig> = {}
): Promise<SafeExecuteResult[]> {
  const effectiveConfig = { ...DEFAULT_CONFIG, ...config };
  const { runId, commands, workspaceFiles = [], timeout = effectiveConfig.defaultTimeout, allowedDomains } = input;

  logger.info({ runId, commandCount: commands.length }, 'Starting batch execution');

  const policyClient = new PolicyClient(effectiveConfig.apiUrl);
  const budgetClient = new BudgetClient(effectiveConfig.apiUrl);

  let session: SandboxSession | null = null;

  try {
    // Check all policies first
    for (const command of commands) {
      const decision = await policyClient.checkCodeExecution(command);
      if (!decision.allowed) {
        throw new Error(`Policy check failed for "${command}": ${decision.reason}`);
      }
    }

    // Check budget for all commands
    const totalCost = effectiveConfig.costPerExecution * commands.length;
    await budgetClient.enforceLimit(runId, totalCost);

    // Create sandbox once
    session = await E2BSandbox.create('base', {
      timeoutMs: timeout,
      networkAllowlist: allowedDomains,
    });

    // Upload workspace files
    if (workspaceFiles.length > 0) {
      await E2BSandbox.uploadFiles(session, workspaceFiles);
    }

    // Execute all commands
    const results: SafeExecuteResult[] = [];

    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];

      logger.info({ commandIndex: i, command }, 'Executing command');

      if (Context.current().info.isLocal === false) {
        Context.current().heartbeat({ status: 'executing', commandIndex: i, total: commands.length });
      }

      const result = await E2BSandbox.execute(session, command, timeout);

      // Record cost for this command
      const budgetStatus = await budgetClient.spend(runId, effectiveConfig.costPerExecution);

      results.push({
        ...result,
        cost: effectiveConfig.costPerExecution,
        budgetRemaining: budgetStatus.remaining,
        policyChecked: true,
      });

      // Stop on error unless continuing is explicitly requested
      if (result.exitCode !== 0) {
        logger.warn({ commandIndex: i, exitCode: result.exitCode }, 'Command failed, stopping batch');
        break;
      }
    }

    logger.info({ resultsCount: results.length }, 'Batch execution completed');
    return results;

  } finally {
    if (session) {
      await E2BSandbox.destroy(session);
    }
  }
}
