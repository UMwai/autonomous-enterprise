/**
 * Client for interacting with the budget tracking API.
 */

import pino from 'pino';

const logger = pino();

/**
 * Status of a budget for a specific run.
 */
export interface BudgetStatus {
  run_id: string;
  spent: number;
  limit: number;
  remaining: number;
  exceeded: boolean;
}

/**
 * Request to create a new budget.
 */
export interface CreateBudgetRequest {
  run_id: string;
  limit: number;
}

/**
 * Request to record spending.
 */
export interface SpendBudgetRequest {
  run_id: string;
  amount: number;
}

/**
 * Request to check if spending is allowed.
 */
export interface CanSpendRequest {
  run_id: string;
  amount: number;
}

/**
 * Response indicating if spending is allowed.
 */
export interface CanSpendResponse {
  can_spend: boolean;
  current_status: BudgetStatus;
}

/**
 * Client for tracking and enforcing spending budgets.
 */
export class BudgetClient {
  private readonly baseUrl: string;

  /**
   * Create a new budget client.
   *
   * @param baseUrl - Base URL of the FastAPI service (default: http://localhost:8000)
   */
  constructor(baseUrl: string = 'http://localhost:8000') {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  /**
   * Create a new budget for a run.
   *
   * @param runId - Unique identifier for the run
   * @param limit - Budget limit in USD
   * @returns Initial budget status
   */
  async createBudget(runId: string, limit: number): Promise<BudgetStatus> {
    logger.info({ runId, limit }, 'Creating budget');

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/safety/budget/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          run_id: runId,
          limit,
        } as CreateBudgetRequest),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create budget: ${response.status} ${error}`);
      }

      const status = await response.json() as BudgetStatus;
      logger.info({ runId, status }, 'Budget created successfully');
      return status;

    } catch (error) {
      logger.error({ error, runId, limit }, 'Failed to create budget');
      throw new Error(
        `Failed to create budget: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Record spending against a budget.
   *
   * @param runId - Unique identifier for the run
   * @param amount - Amount to spend in USD
   * @returns Updated budget status
   */
  async spend(runId: string, amount: number): Promise<BudgetStatus> {
    logger.info({ runId, amount }, 'Recording spend');

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/safety/budget/spend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          run_id: runId,
          amount,
        } as SpendBudgetRequest),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to record spend: ${response.status} ${error}`);
      }

      const status = await response.json() as BudgetStatus;

      if (status.exceeded) {
        logger.warn({ runId, status }, 'Budget exceeded');
      }

      return status;

    } catch (error) {
      logger.error({ error, runId, amount }, 'Failed to record spend');
      throw new Error(
        `Failed to record spend: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get current budget status for a run.
   *
   * @param runId - Unique identifier for the run
   * @returns Current budget status
   */
  async getStatus(runId: string): Promise<BudgetStatus> {
    logger.info({ runId }, 'Getting budget status');

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/safety/budget/${runId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to get budget status: ${response.status} ${error}`);
      }

      const status = await response.json() as BudgetStatus;
      return status;

    } catch (error) {
      logger.error({ error, runId }, 'Failed to get budget status');
      throw new Error(
        `Failed to get budget status: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Check if a spend amount would exceed the budget.
   *
   * @param runId - Unique identifier for the run
   * @param amount - Amount to check in USD
   * @returns True if the spend would be within budget
   */
  async canSpend(runId: string, amount: number): Promise<boolean> {
    logger.info({ runId, amount }, 'Checking can spend');

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/safety/budget/can-spend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          run_id: runId,
          amount,
        } as CanSpendRequest),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to check can spend: ${response.status} ${error}`);
      }

      const result = await response.json() as CanSpendResponse;
      return result.can_spend;

    } catch (error) {
      logger.error({ error, runId, amount }, 'Failed to check can spend');
      throw new Error(
        `Failed to check can spend: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Delete a budget and all associated data.
   *
   * @param runId - Unique identifier for the run
   */
  async deleteBudget(runId: string): Promise<void> {
    logger.info({ runId }, 'Deleting budget');

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/safety/budget/${runId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to delete budget: ${response.status} ${error}`);
      }

      logger.info({ runId }, 'Budget deleted successfully');

    } catch (error) {
      logger.error({ error, runId }, 'Failed to delete budget');
      throw new Error(
        `Failed to delete budget: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Check if budget is exceeded.
   *
   * @param runId - Unique identifier for the run
   * @returns True if budget is exceeded
   */
  async isExceeded(runId: string): Promise<boolean> {
    try {
      const status = await this.getStatus(runId);
      return status.exceeded;
    } catch {
      return false;
    }
  }

  /**
   * Enforce budget limit before spending.
   * Throws an error if spending would exceed budget.
   *
   * @param runId - Unique identifier for the run
   * @param amount - Amount to spend
   * @throws Error if spending would exceed budget
   */
  async enforceLimit(runId: string, amount: number): Promise<void> {
    const canSpend = await this.canSpend(runId, amount);

    if (!canSpend) {
      const status = await this.getStatus(runId);
      throw new Error(
        `Budget limit exceeded: Would spend $${amount}, but only $${status.remaining} remaining of $${status.limit} limit`
      );
    }
  }

  /**
   * Spend with enforcement.
   * Checks budget before spending and throws if exceeded.
   *
   * @param runId - Unique identifier for the run
   * @param amount - Amount to spend
   * @returns Updated budget status
   * @throws Error if spending would exceed budget
   */
  async spendWithEnforcement(runId: string, amount: number): Promise<BudgetStatus> {
    await this.enforceLimit(runId, amount);
    return await this.spend(runId, amount);
  }
}
