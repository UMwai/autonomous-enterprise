/**
 * CreateStripeProductTool - Atomic tool for creating Stripe products.
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
 * Input parameters for creating a Stripe product.
 */
export interface CreateStripeProductInput {
  /** Product name */
  name: string;
  /** Product description */
  description?: string;
  /** Price in cents (e.g., 999 for $9.99) */
  priceInCents: number;
  /** Currency code (default: 'usd') */
  currency?: string;
  /** Billing interval ('month' or 'year') */
  interval: 'month' | 'year';
  /** Whether this is a one-time payment (default: false for recurring) */
  oneTime?: boolean;
  /** Trial period in days (default: 0) */
  trialPeriodDays?: number;
  /** Product metadata */
  metadata?: Record<string, string>;
}

/**
 * Output from creating a Stripe product.
 */
export interface CreateStripeProductOutput {
  /** Stripe product ID */
  productId: string;
  /** Stripe price ID */
  priceId: string;
  /** Product name */
  name: string;
  /** Price in cents */
  priceInCents: number;
  /** Currency code */
  currency: string;
  /** Billing interval */
  interval: string;
  /** Whether created successfully */
  created: boolean;
}

/**
 * Tool for creating Stripe products and pricing.
 *
 * Features:
 * - CRITICAL risk level - requires human approval
 * - Creates Stripe products with pricing
 * - Supports recurring and one-time payments
 * - Trial period configuration
 * - Metadata support
 *
 * This tool integrates with:
 * - PolicyClient for approval enforcement
 * - ApprovalClient for HITL workflow
 * - FastAPI billing endpoint
 */
export class CreateStripeProductTool
  implements AtomicTool<CreateStripeProductInput, CreateStripeProductOutput>
{
  readonly name = 'create_stripe_product';
  readonly description = 'Create a Stripe product with pricing';
  readonly category: ToolCategory = 'billing' as ToolCategory;
  readonly riskLevel: RiskLevel = 'critical' as RiskLevel;
  readonly estimatedCost = 0.01; // API calls have minimal cost

  private readonly apiBaseUrl: string;

  constructor(apiBaseUrl: string = process.env.API_BASE_URL || 'http://localhost:8000') {
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, '');
  }

  validateInput(input: CreateStripeProductInput): string[] {
    const errors: string[] = [];

    if (!input.name || input.name.trim().length === 0) {
      errors.push('name is required and cannot be empty');
    }

    if (!input.priceInCents || input.priceInCents <= 0) {
      errors.push('priceInCents must be a positive number');
    }

    if (!['month', 'year'].includes(input.interval)) {
      errors.push('interval must be either "month" or "year"');
    }

    if (input.trialPeriodDays !== undefined && input.trialPeriodDays < 0) {
      errors.push('trialPeriodDays must be non-negative');
    }

    // Validate price is reasonable (not more than $100,000)
    if (input.priceInCents > 10000000) {
      errors.push('priceInCents exceeds maximum allowed value ($100,000)');
    }

    return errors;
  }

  async execute(
    input: CreateStripeProductInput,
    context: ToolContext
  ): Promise<ToolResult<CreateStripeProductOutput>> {
    const startTime = Date.now();
    const sideEffects: SideEffect[] = [];

    try {
      // 1. Policy check for billing operation
      const priceInDollars = input.priceInCents / 100;

      const decision = await context.policyClient.checkAction(ActionType.CREATE_BILLING, {
        operation: 'create_product',
        product_name: input.name,
        price: priceInDollars,
        currency: input.currency || 'usd',
        interval: input.interval,
      });

      if (!decision.allowed) {
        return {
          success: false,
          errors: [
            {
              code: 'POLICY_DENIED',
              message: `Billing operation blocked by policy: ${decision.reason}`,
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
        const actionId = `billing-create-${Date.now()}-${Math.random().toString(36).substring(7)}`;

        const approval = await context.observer.onToolStart(
          `${this.name}.approval`,
          {
            action_id: actionId,
            action_type: 'create_billing',
            description: `Create Stripe product: ${input.name} at $${priceInDollars}/${input.interval}`,
            context: {
              operation: 'create_product',
              name: input.name,
              price: priceInDollars,
              currency: input.currency || 'usd',
              interval: input.interval,
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
              message: `Billing operation requires human approval. Action ID: ${actionId}`,
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

      // 3. Execute billing operation
      const response = await fetch(`${this.apiBaseUrl}/api/v1/billing/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: input.name,
          description: input.description,
          price_in_cents: input.priceInCents,
          currency: input.currency || 'usd',
          interval: input.interval,
          one_time: input.oneTime || false,
          trial_period_days: input.trialPeriodDays || 0,
          metadata: input.metadata || {},
        }),
        signal: context.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          errors: [
            {
              code: 'BILLING_FAILED',
              message: `Stripe product creation failed: ${response.status} - ${error}`,
            },
          ],
          cost: this.estimatedCost,
          duration: Date.now() - startTime,
          sideEffects,
        };
      }

      const result = (await response.json()) as {
        product_id: string;
        price_id: string;
        name: string;
        price_in_cents: number;
        currency: string;
        interval: string;
      };

      // Track side effect (cannot easily rollback Stripe operations)
      sideEffects.push({
        type: 'billing',
        description: `Created Stripe product: ${result.name} (${result.product_id})`,
        resources: [result.product_id, result.price_id],
      });

      return {
        success: true,
        data: {
          productId: result.product_id,
          priceId: result.price_id,
          name: result.name,
          priceInCents: result.price_in_cents,
          currency: result.currency,
          interval: result.interval,
          created: true,
        },
        output: `Successfully created Stripe product: ${result.name} at $${result.price_in_cents / 100}/${result.interval}`,
        cost: this.estimatedCost,
        duration: Date.now() - startTime,
        sideEffects,
      };
    } catch (error) {
      return {
        success: false,
        errors: [
          {
            code: 'BILLING_ERROR',
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
