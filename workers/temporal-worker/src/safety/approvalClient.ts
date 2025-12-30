/**
 * Client for interacting with the HITL approval API.
 */

import pino from 'pino';

const logger = pino();

/**
 * Status of an approval request.
 */
export enum ApprovalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

/**
 * Full approval request with metadata.
 */
export interface ApprovalRequest {
  action_id: string;
  action_type: string;
  description: string;
  context: Record<string, any>;
  run_id: string;
  requested_by: string;
  requested_at: number;
  status: ApprovalStatus;
  decided_at?: number;
  decided_by?: string;
  decision_reason?: string;
  expires_at: number;
  timeout_seconds: number;
}

/**
 * Request to create a new approval.
 */
export interface CreateApprovalRequest {
  action_id: string;
  action_type: string;
  description: string;
  context?: Record<string, any>;
  run_id: string;
  requested_by?: string;
  timeout_seconds?: number;
}

/**
 * Decision on an approval request.
 */
export interface ApprovalDecision {
  approved: boolean;
  reason?: string;
  decided_by: string;
}

/**
 * Client for requesting and managing human approvals.
 */
export class ApprovalClient {
  private readonly baseUrl: string;

  /**
   * Create a new approval client.
   *
   * @param baseUrl - Base URL of the FastAPI service (default: http://localhost:8000)
   */
  constructor(baseUrl: string = 'http://localhost:8000') {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  /**
   * Request human approval for an action.
   *
   * @param request - Approval request details
   * @returns Created approval request
   */
  async requestApproval(request: CreateApprovalRequest): Promise<ApprovalRequest> {
    logger.info(
      { action_id: request.action_id, action_type: request.action_type },
      'Requesting human approval'
    );

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/approvals/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to request approval: ${response.status} ${error}`);
      }

      const approval = (await response.json()) as ApprovalRequest;

      logger.info(
        {
          action_id: approval.action_id,
          expires_at: approval.expires_at,
          timeout_seconds: approval.timeout_seconds,
        },
        'Approval request created'
      );

      return approval;
    } catch (error) {
      logger.error({ error, action_id: request.action_id }, 'Failed to request approval');
      throw new Error(
        `Failed to request approval: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Wait for an approval decision with polling.
   *
   * @param actionId - Unique identifier for the action
   * @param pollInterval - Seconds between polling attempts (default: 5)
   * @param timeoutOverride - Override the approval's timeout for testing
   * @returns Approval request with final decision
   * @throws Error if approval expires or fails
   */
  async waitForApproval(
    actionId: string,
    pollInterval: number = 5,
    timeoutOverride?: number
  ): Promise<ApprovalRequest> {
    logger.info({ action_id: actionId, poll_interval: pollInterval }, 'Waiting for approval decision');

    // Get initial approval to determine timeout
    const initialApproval = await this.getApproval(actionId);
    const timeout = timeoutOverride ?? initialApproval.timeout_seconds;
    const startTime = Date.now() / 1000; // Convert to seconds

    while (true) {
      // Check if timeout exceeded
      const elapsed = Date.now() / 1000 - startTime;
      if (elapsed > timeout) {
        logger.warn({ action_id: actionId, elapsed, timeout }, 'Approval timeout exceeded');
        throw new Error(`Approval timeout exceeded for action_id: ${actionId}`);
      }

      // Refresh approval status
      const approval = await this.getApproval(actionId);

      // Check if decision was made
      if (
        approval.status === ApprovalStatus.APPROVED ||
        approval.status === ApprovalStatus.REJECTED ||
        approval.status === ApprovalStatus.CANCELLED ||
        approval.status === ApprovalStatus.EXPIRED
      ) {
        logger.info(
          { action_id: actionId, status: approval.status },
          'Approval decision received'
        );

        // Throw error if not approved
        if (approval.status !== ApprovalStatus.APPROVED) {
          const reason = approval.decision_reason || `Approval ${approval.status}`;
          throw new Error(`Action not approved: ${reason}`);
        }

        return approval;
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval * 1000));
    }
  }

  /**
   * Get an approval request by action ID.
   *
   * @param actionId - Unique identifier for the action
   * @returns Approval request
   */
  async getApproval(actionId: string): Promise<ApprovalRequest> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/approvals/${actionId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to get approval: ${response.status} ${error}`);
      }

      return (await response.json()) as ApprovalRequest;
    } catch (error) {
      logger.error({ error, action_id: actionId }, 'Failed to get approval');
      throw new Error(
        `Failed to get approval: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * List pending approval requests.
   *
   * @param runId - Optional filter by workflow run ID
   * @param limit - Maximum number of approvals to return (default: 100)
   * @returns List of pending approval requests
   */
  async listPendingApprovals(runId?: string, limit: number = 100): Promise<ApprovalRequest[]> {
    try {
      const params = new URLSearchParams();
      if (runId) {
        params.append('run_id', runId);
      }
      params.append('limit', limit.toString());

      const response = await fetch(`${this.baseUrl}/api/v1/approvals/?${params.toString()}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to list approvals: ${response.status} ${error}`);
      }

      return (await response.json()) as ApprovalRequest[];
    } catch (error) {
      logger.error({ error, run_id: runId }, 'Failed to list approvals');
      throw new Error(
        `Failed to list approvals: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Cancel a pending approval request.
   *
   * @param actionId - Unique identifier for the action
   * @param reason - Optional reason for cancellation
   * @returns Updated approval request
   */
  async cancelApproval(actionId: string, reason?: string): Promise<ApprovalRequest> {
    logger.info({ action_id: actionId, reason }, 'Cancelling approval');

    try {
      const params = new URLSearchParams();
      if (reason) {
        params.append('reason', reason);
      }

      const response = await fetch(
        `${this.baseUrl}/api/v1/approvals/${actionId}/cancel?${params.toString()}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to cancel approval: ${response.status} ${error}`);
      }

      const approval = (await response.json()) as ApprovalRequest;

      logger.info({ action_id: actionId, status: approval.status }, 'Approval cancelled');

      return approval;
    } catch (error) {
      logger.error({ error, action_id: actionId }, 'Failed to cancel approval');
      throw new Error(
        `Failed to cancel approval: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Request approval and wait for decision in one call.
   *
   * @param request - Approval request details
   * @param pollInterval - Seconds between polling attempts (default: 5)
   * @returns Approved request
   * @throws Error if approval is rejected, expires, or fails
   */
  async requestAndWait(
    request: CreateApprovalRequest,
    pollInterval: number = 5
  ): Promise<ApprovalRequest> {
    // Create approval request
    const approval = await this.requestApproval(request);

    // Wait for decision
    return await this.waitForApproval(approval.action_id, pollInterval);
  }

  /**
   * Helper to request approval for code execution.
   *
   * @param command - Command to execute
   * @param runId - Workflow run ID
   * @param timeoutSeconds - Timeout in seconds (default: 3600)
   * @returns Approval request
   */
  async requestCodeExecutionApproval(
    command: string,
    runId: string,
    timeoutSeconds: number = 3600
  ): Promise<ApprovalRequest> {
    return await this.requestApproval({
      action_id: `code-exec-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      action_type: 'execute_code',
      description: `Execute command: ${command}`,
      context: { command },
      run_id: runId,
      requested_by: 'temporal-worker',
      timeout_seconds: timeoutSeconds,
    });
  }

  /**
   * Helper to request approval for deployment.
   *
   * @param platform - Deployment platform (vercel, netlify, etc.)
   * @param config - Deployment configuration
   * @param runId - Workflow run ID
   * @param timeoutSeconds - Timeout in seconds (default: 3600)
   * @returns Approval request
   */
  async requestDeploymentApproval(
    platform: string,
    config: Record<string, any>,
    runId: string,
    timeoutSeconds: number = 3600
  ): Promise<ApprovalRequest> {
    return await this.requestApproval({
      action_id: `deploy-${platform}-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      action_type: 'deploy',
      description: `Deploy to ${platform}`,
      context: { platform, config },
      run_id: runId,
      requested_by: 'temporal-worker',
      timeout_seconds: timeoutSeconds,
    });
  }

  /**
   * Helper to request approval for billing operation.
   *
   * @param operation - Billing operation type
   * @param amount - Amount in USD
   * @param runId - Workflow run ID
   * @param timeoutSeconds - Timeout in seconds (default: 3600)
   * @returns Approval request
   */
  async requestBillingApproval(
    operation: string,
    amount: number,
    runId: string,
    timeoutSeconds: number = 3600
  ): Promise<ApprovalRequest> {
    return await this.requestApproval({
      action_id: `billing-${operation}-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      action_type: 'create_billing',
      description: `Billing operation: ${operation} ($${amount})`,
      context: { operation, amount },
      run_id: runId,
      requested_by: 'temporal-worker',
      timeout_seconds: timeoutSeconds,
    });
  }
}
