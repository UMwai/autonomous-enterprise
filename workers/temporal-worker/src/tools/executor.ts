/**
 * Tool execution engine with policy and budget enforcement.
 *
 * Wraps tool execution with validation, budget checks, cost tracking,
 * policy enforcement, and observability.
 */

import pino from 'pino';
import type { AtomicTool, ToolContext, ToolResult, ToolError } from './types.js';

const logger = pino();

/**
 * Executes tools with safety guarantees and tracking.
 */
export class ToolExecutor {
  /**
   * Execute a tool with full validation and enforcement.
   *
   * @param tool - The tool to execute
   * @param input - Tool input parameters
   * @param context - Execution context
   * @returns Tool result with output, cost, and side effects
   */
  async execute<TInput, TOutput>(
    tool: AtomicTool<TInput, TOutput>,
    input: TInput,
    context: ToolContext
  ): Promise<ToolResult<TOutput>> {
    const startTime = Date.now();

    try {
      // Notify observer of tool start
      context.observer.onToolStart(tool.name, input);

      logger.info(
        {
          tool: tool.name,
          category: tool.category,
          riskLevel: tool.riskLevel,
          runId: context.runId,
        },
        'Starting tool execution'
      );

      // 1. Validate input
      const validationErrors = tool.validateInput(input);
      if (validationErrors.length > 0) {
        const error: ToolError = {
          code: 'VALIDATION_ERROR',
          message: `Input validation failed: ${validationErrors.join(', ')}`,
        };

        context.observer.onToolError(tool.name, error);

        return {
          success: false,
          errors: [error],
          cost: 0,
          duration: Date.now() - startTime,
          sideEffects: [],
        };
      }

      // 2. Check budget before execution
      const canSpend = await context.budgetClient.canSpend(
        context.runId,
        tool.estimatedCost
      );

      if (!canSpend) {
        const status = await context.budgetClient.getStatus(context.runId);
        const error: ToolError = {
          code: 'BUDGET_EXCEEDED',
          message: `Budget exceeded: Would spend $${tool.estimatedCost}, but only $${status.remaining} remaining`,
          context: {
            estimatedCost: tool.estimatedCost,
            remaining: status.remaining,
            limit: status.limit,
          },
        };

        logger.warn(
          { tool: tool.name, error, runId: context.runId },
          'Tool execution blocked by budget'
        );

        context.observer.onToolError(tool.name, error);

        return {
          success: false,
          errors: [error],
          cost: 0,
          duration: Date.now() - startTime,
          sideEffects: [],
        };
      }

      // 3. Execute the tool
      const result = await tool.execute(input, context);

      // 4. Track actual cost
      if (result.cost > 0) {
        await context.budgetClient.spend(context.runId, result.cost);
      }

      // 5. Log result
      logger.info(
        {
          tool: tool.name,
          success: result.success,
          cost: result.cost,
          duration: result.duration,
          sideEffects: result.sideEffects.length,
          runId: context.runId,
        },
        'Tool execution completed'
      );

      // 6. Notify observer
      if (result.success) {
        context.observer.onToolSuccess(tool.name, result);
      } else {
        if (result.errors && result.errors.length > 0) {
          context.observer.onToolError(tool.name, result.errors[0]);
        }
      }

      context.observer.onToolComplete(tool.name, result.duration, result.cost);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      const toolError: ToolError = {
        code: 'EXECUTION_ERROR',
        message: error instanceof Error ? error.message : String(error),
        cause: error instanceof Error ? error : undefined,
      };

      logger.error(
        { tool: tool.name, error: toolError, runId: context.runId },
        'Tool execution failed with exception'
      );

      context.observer.onToolError(tool.name, toolError);
      context.observer.onToolComplete(tool.name, duration, 0);

      return {
        success: false,
        errors: [toolError],
        cost: 0,
        duration,
        sideEffects: [],
      };
    }
  }

  /**
   * Execute a sequence of tools in order.
   * Stops on first failure unless continueOnError is true.
   *
   * @param executions - Array of tool executions to run
   * @param context - Execution context
   * @param continueOnError - Whether to continue after errors
   * @returns Array of results
   */
  async executeSequence(
    executions: Array<{
      tool: AtomicTool;
      input: unknown;
    }>,
    context: ToolContext,
    continueOnError = false
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const { tool, input } of executions) {
      const result = await this.execute(tool, input, context);
      results.push(result);

      if (!result.success && !continueOnError) {
        logger.info(
          { tool: tool.name, runId: context.runId },
          'Stopping sequence execution due to failure'
        );
        break;
      }
    }

    return results;
  }

  /**
   * Execute multiple tools in parallel.
   * All tools run concurrently.
   *
   * @param executions - Array of tool executions to run
   * @param context - Execution context
   * @returns Array of results in the same order as input
   */
  async executeParallel(
    executions: Array<{
      tool: AtomicTool;
      input: unknown;
    }>,
    context: ToolContext
  ): Promise<ToolResult[]> {
    const promises = executions.map(({ tool, input }) =>
      this.execute(tool, input, context)
    );

    return Promise.all(promises);
  }

  /**
   * Execute a tool with automatic retry on transient failures.
   *
   * @param tool - The tool to execute
   * @param input - Tool input parameters
   * @param context - Execution context
   * @param maxRetries - Maximum number of retries (default: 3)
   * @param retryDelay - Delay between retries in ms (default: 1000)
   * @returns Tool result
   */
  async executeWithRetry<TInput, TOutput>(
    tool: AtomicTool<TInput, TOutput>,
    input: TInput,
    context: ToolContext,
    maxRetries = 3,
    retryDelay = 1000
  ): Promise<ToolResult<TOutput>> {
    let lastResult: ToolResult<TOutput> | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      lastResult = await this.execute(tool, input, context);

      if (lastResult.success) {
        return lastResult;
      }

      // Check if error is retryable
      const isRetryable =
        lastResult.errors?.some((err) =>
          ['NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMIT'].includes(err.code)
        ) ?? false;

      if (!isRetryable || attempt === maxRetries) {
        return lastResult;
      }

      logger.info(
        {
          tool: tool.name,
          attempt: attempt + 1,
          maxRetries,
          runId: context.runId,
        },
        'Retrying tool execution after transient failure'
      );

      await new Promise((resolve) => setTimeout(resolve, retryDelay * (attempt + 1)));
    }

    return lastResult!;
  }
}
