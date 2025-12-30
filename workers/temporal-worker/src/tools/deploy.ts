/**
 * DeployVercelTool - Atomic tool for deploying to Vercel.
 *
 * This is a CRITICAL risk tool that requires human approval before execution.
 */

import { ActionType } from '../safety/policyClient.js';
import type {
  AtomicTool,
  ToolCategory,
  ToolContext,
  ToolResult,
  RiskLevel,
  SideEffect,
} from './types.js';

/**
 * Input parameters for Vercel deployment.
 */
export interface DeployVercelInput {
  /** Project name on Vercel */
  projectName: string;
  /** Path to the source code (relative to workspace or absolute) */
  sourcePath?: string;
  /** Environment variables to set */
  envVars?: Record<string, string>;
  /** Custom build command */
  buildCommand?: string;
  /** Output directory for built files */
  outputDirectory?: string;
  /** Whether to wait for deployment to complete (default: true) */
  waitForCompletion?: boolean;
  /** Maximum wait time in seconds (default: 600) */
  timeoutSeconds?: number;
}

/**
 * Output from Vercel deployment.
 */
export interface DeployVercelOutput {
  /** Deployment ID from Vercel */
  deploymentId: string;
  /** Live URL of the deployment */
  url: string;
  /** Deployment state (READY, ERROR, etc.) */
  state: string;
  /** Platform identifier */
  platform: 'vercel';
  /** Whether deployment completed successfully */
  ready: boolean;
}

/**
 * Tool for deploying applications to Vercel.
 *
 * Features:
 * - CRITICAL risk level - requires human approval
 * - Deploys to Vercel hosting platform
 * - Optional wait for deployment completion
 * - Environment variable configuration
 * - Custom build settings support
 *
 * This tool integrates with:
 * - PolicyClient for approval enforcement
 * - ApprovalClient for HITL workflow
 * - FastAPI deploy endpoint
 */
export class DeployVercelTool implements AtomicTool<DeployVercelInput, DeployVercelOutput> {
  readonly name = 'deploy_vercel';
  readonly description = 'Deploy application to Vercel hosting platform';
  readonly category: ToolCategory = 'deploy' as ToolCategory;
  readonly riskLevel: RiskLevel = 'critical' as RiskLevel;
  readonly estimatedCost = 0.05; // Deployment operations have moderate cost

  private readonly apiBaseUrl: string;

  constructor(apiBaseUrl: string = process.env.API_BASE_URL || 'http://localhost:8000') {
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, '');
  }

  validateInput(input: DeployVercelInput): string[] {
    const errors: string[] = [];

    if (!input.projectName || input.projectName.trim().length === 0) {
      errors.push('projectName is required and cannot be empty');
    }

    if (input.timeoutSeconds !== undefined && input.timeoutSeconds <= 0) {
      errors.push('timeoutSeconds must be positive');
    }

    return errors;
  }

  async execute(
    input: DeployVercelInput,
    context: ToolContext
  ): Promise<ToolResult<DeployVercelOutput>> {
    const startTime = Date.now();
    const sideEffects: SideEffect[] = [];

    try {
      // 1. Policy check for deployment
      const decision = await context.policyClient.checkAction(ActionType.DEPLOY, {
        platform: 'vercel',
        projectName: input.projectName,
        workspace: context.workspace,
      });

      if (!decision.allowed) {
        return {
          success: false,
          errors: [
            {
              code: 'POLICY_DENIED',
              message: `Deployment blocked by policy: ${decision.reason}`,
              context: { decision },
            },
          ],
          cost: 0,
          duration: Date.now() - startTime,
          sideEffects: [],
        };
      }

      // 2. Request human approval if required
      if (decision.requires_approval) {
        const actionId = `deploy-vercel-${Date.now()}-${Math.random().toString(36).substring(7)}`;

        // Log approval requirement
        context.observer.onToolStart(
          `${this.name}.approval`,
          {
            action_id: actionId,
            action_type: 'deploy',
            description: `Deploy ${input.projectName} to Vercel`,
            context: {
              platform: 'vercel',
              project_name: input.projectName,
              source_path: input.sourcePath || context.workspace,
              env_vars: input.envVars ? Object.keys(input.envVars) : [],
            },
            run_id: context.runId,
          }
        );

        // Note: In real implementation, this would call ApprovalClient.requestAndWait()
        // For now, we document the requirement
        return {
          success: false,
          errors: [
            {
              code: 'APPROVAL_REQUIRED',
              message: `Deployment requires human approval. Action ID: ${actionId}`,
              context: {
                action_id: actionId,
                requires_approval: true,
                hint: 'Use ApprovalClient to request and wait for approval',
              },
            },
          ],
          cost: 0,
          duration: Date.now() - startTime,
          sideEffects: [],
        };
      }

      // 3. Execute deployment
      const sourcePath = input.sourcePath || context.workspace;

      const response = await fetch(`${this.apiBaseUrl}/api/v1/deploy/vercel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          project_name: input.projectName,
          source_path: sourcePath,
          env_vars: input.envVars || {},
          build_command: input.buildCommand,
          output_directory: input.outputDirectory,
        }),
        signal: context.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          errors: [
            {
              code: 'DEPLOYMENT_FAILED',
              message: `Vercel deployment failed: ${response.status} - ${error}`,
            },
          ],
          cost: this.estimatedCost,
          duration: Date.now() - startTime,
          sideEffects,
        };
      }

      const deployment = (await response.json()) as {
        id: string;
        url: string;
        state: string;
      };

      // Track side effect
      sideEffects.push({
        type: 'deploy',
        description: `Deployed ${input.projectName} to Vercel`,
        resources: [deployment.url, deployment.id],
      });

      // 4. Wait for completion if requested
      let finalState = deployment.state;
      let ready = deployment.state === 'READY';

      if (input.waitForCompletion !== false && deployment.state !== 'READY') {
        const timeout = input.timeoutSeconds || 600;
        const pollInterval = 5;
        const startWait = Date.now();

        while (Date.now() - startWait < timeout * 1000) {
          // Poll deployment status
          const statusResponse = await fetch(
            `${this.apiBaseUrl}/api/v1/deploy/${deployment.id}?platform=vercel`,
            {
              method: 'GET',
              headers: { 'Content-Type': 'application/json' },
              signal: context.signal,
            }
          );

          if (!statusResponse.ok) {
            break; // Give up on polling errors
          }

          const status = (await statusResponse.json()) as { state: string };
          finalState = status.state;

          if (status.state === 'READY') {
            ready = true;
            break;
          }

          if (status.state === 'ERROR' || status.state === 'CANCELED') {
            return {
              success: false,
              errors: [
                {
                  code: 'DEPLOYMENT_FAILED',
                  message: `Deployment failed with state: ${status.state}`,
                },
              ],
              cost: this.estimatedCost,
              duration: Date.now() - startTime,
              sideEffects,
            };
          }

          await new Promise((resolve) => setTimeout(resolve, pollInterval * 1000));
        }

        if (!ready) {
          return {
            success: false,
            errors: [
              {
                code: 'DEPLOYMENT_TIMEOUT',
                message: `Deployment did not complete within ${timeout} seconds`,
              },
            ],
            cost: this.estimatedCost,
            duration: Date.now() - startTime,
            sideEffects,
          };
        }
      }

      return {
        success: true,
        data: {
          deploymentId: deployment.id,
          url: deployment.url,
          state: finalState,
          platform: 'vercel',
          ready,
        },
        output: `Successfully deployed to Vercel: ${deployment.url} (${finalState})`,
        cost: this.estimatedCost,
        duration: Date.now() - startTime,
        sideEffects,
      };
    } catch (error) {
      return {
        success: false,
        errors: [
          {
            code: 'DEPLOYMENT_ERROR',
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
