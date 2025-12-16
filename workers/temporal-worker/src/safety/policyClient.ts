/**
 * Client for interacting with the safety policy API.
 */

import pino from 'pino';

const logger = pino();

/**
 * Action types that require policy checks.
 */
export enum ActionType {
  EXECUTE_CODE = 'execute_code',
  DEPLOY = 'deploy',
  CREATE_BILLING = 'create_billing',
  DELETE_FILES = 'delete_files',
  NETWORK_ACCESS = 'network_access',
}

/**
 * Result of a policy check.
 */
export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  requires_approval: boolean;
}

/**
 * Request to check if an action is allowed.
 */
export interface CheckActionRequest {
  action: ActionType;
  context: Record<string, any>;
}

/**
 * Client for checking actions against safety policies.
 */
export class PolicyClient {
  private readonly baseUrl: string;

  /**
   * Create a new policy client.
   *
   * @param baseUrl - Base URL of the FastAPI service (default: http://localhost:8000)
   */
  constructor(baseUrl: string = 'http://localhost:8000') {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  /**
   * Check if an action is allowed under current policies.
   *
   * @param action - Type of action to check
   * @param context - Additional context for the decision
   * @returns Policy decision with allowed status and reasoning
   */
  async checkAction(
    action: ActionType,
    context: Record<string, any> = {}
  ): Promise<PolicyDecision> {
    logger.info({ action, context }, 'Checking action policy');

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/safety/check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action,
          context,
        } as CheckActionRequest),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Policy check failed: ${response.status} ${error}`);
      }

      const decision: PolicyDecision = await response.json();

      logger.info(
        { action, allowed: decision.allowed, requires_approval: decision.requires_approval },
        'Policy check completed'
      );

      return decision;

    } catch (error) {
      logger.error({ error, action }, 'Failed to check action policy');
      throw new Error(
        `Failed to check action policy: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Check if code execution is allowed.
   *
   * @param command - Command to execute
   * @returns Policy decision
   */
  async checkCodeExecution(command: string): Promise<PolicyDecision> {
    return this.checkAction(ActionType.EXECUTE_CODE, { command });
  }

  /**
   * Check if deployment is allowed.
   *
   * @param platform - Deployment platform (vercel, netlify, etc.)
   * @param config - Deployment configuration
   * @returns Policy decision
   */
  async checkDeployment(
    platform: string,
    config: Record<string, any> = {}
  ): Promise<PolicyDecision> {
    return this.checkAction(ActionType.DEPLOY, { platform, config });
  }

  /**
   * Check if billing operation is allowed.
   *
   * @param operation - Billing operation type
   * @param amount - Amount in USD
   * @returns Policy decision
   */
  async checkBilling(
    operation: string,
    amount?: number
  ): Promise<PolicyDecision> {
    return this.checkAction(ActionType.CREATE_BILLING, { operation, amount });
  }

  /**
   * Check if file deletion is allowed.
   *
   * @param paths - File paths to delete
   * @returns Policy decision
   */
  async checkDeleteFiles(paths: string[]): Promise<PolicyDecision> {
    return this.checkAction(ActionType.DELETE_FILES, { paths });
  }

  /**
   * Check if network access is allowed.
   *
   * @param url - URL to access
   * @param allowlist - Optional allowlist of allowed domains
   * @returns Policy decision
   */
  async checkNetworkAccess(
    url: string,
    allowlist?: string[]
  ): Promise<PolicyDecision> {
    return this.checkAction(ActionType.NETWORK_ACCESS, { url, allowlist });
  }

  /**
   * Enforce a policy decision.
   * Throws an error if action is not allowed.
   *
   * @param decision - Policy decision to enforce
   * @throws Error if action is not allowed
   */
  enforceDecision(decision: PolicyDecision): void {
    if (!decision.allowed) {
      logger.error({ decision }, 'Action blocked by policy');
      throw new Error(`Action blocked by policy: ${decision.reason}`);
    }

    if (decision.requires_approval) {
      logger.warn({ decision }, 'Action requires human approval');
      throw new Error(`Action requires human approval: ${decision.reason}`);
    }
  }

  /**
   * Check and enforce an action in one call.
   *
   * @param action - Type of action to check
   * @param context - Additional context for the decision
   * @returns Policy decision (only if allowed)
   * @throws Error if action is not allowed
   */
  async checkAndEnforce(
    action: ActionType,
    context: Record<string, any> = {}
  ): Promise<PolicyDecision> {
    const decision = await this.checkAction(action, context);
    this.enforceDecision(decision);
    return decision;
  }
}
