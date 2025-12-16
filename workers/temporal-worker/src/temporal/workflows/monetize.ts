/**
 * Monetization Workflow - Payment Setup and Revenue Automation
 *
 * Sets up monetization infrastructure for a deployed product:
 * 1. Creates Stripe product and pricing
 * 2. Generates payment links and checkout flows
 * 3. Sets up webhooks for payment processing
 * 4. Configures subscription management
 */

import { proxyActivities, sleep } from '@temporalio/workflow';
import type * as activities from '../activities/index.js';
import type { MonetizationStrategy, PricingTier } from './genesis.js';

// Proxy activities with appropriate timeouts
const {
  createStripeProduct,
  createStripePrices,
  generatePaymentLink,
  setupStripeWebhook,
  createCheckoutSession,
  configureBillingPortal,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '5s',
    backoffCoefficient: 2,
    maximumInterval: '1m',
  },
});

/**
 * Input for Monetization workflow
 */
export interface MonetizeWorkflowInput {
  /** Unique project identifier */
  project_id: string;
  /** Product name */
  product_name: string;
  /** Product description */
  product_description: string;
  /** Monetization strategy from specification */
  strategy: MonetizationStrategy;
  /** Deployment URL for success/cancel redirects */
  deployment_url: string;
  /** Webhook endpoint URL */
  webhook_url?: string;
}

/**
 * Output from Monetization workflow
 */
export interface MonetizeWorkflowOutput {
  /** Project identifier */
  project_id: string;
  /** Stripe product ID */
  stripe_product_id: string;
  /** Created Stripe prices */
  prices: StripePrice[];
  /** Payment links for each tier */
  payment_links: PaymentLink[];
  /** Webhook configuration */
  webhook: WebhookConfig;
  /** Billing portal configuration */
  billing_portal_url?: string;
  /** Setup summary */
  summary: MonetizationSummary;
}

export interface StripePrice {
  /** Stripe price ID */
  id: string;
  /** Price tier name */
  tier_name: string;
  /** Amount in cents */
  amount: number;
  /** Currency code */
  currency: string;
  /** Billing interval (for subscriptions) */
  interval?: 'month' | 'year';
  /** Whether this is the default price */
  is_default: boolean;
}

export interface PaymentLink {
  /** Price tier this link is for */
  tier_name: string;
  /** Stripe payment link URL */
  url: string;
  /** Stripe payment link ID */
  link_id: string;
  /** Whether this requires active subscription */
  is_subscription: boolean;
}

export interface WebhookConfig {
  /** Webhook endpoint URL */
  endpoint_url: string;
  /** Stripe webhook secret for signature verification */
  webhook_secret: string;
  /** Enabled webhook events */
  events: string[];
}

export interface MonetizationSummary {
  /** When setup started */
  started_at: string;
  /** When setup completed */
  completed_at: string;
  /** Total duration in milliseconds */
  total_duration_ms: number;
  /** Number of pricing tiers created */
  tiers_created: number;
  /** Monetization model type */
  model: string;
  /** Estimated monthly revenue potential */
  estimated_mrr?: number;
}

/**
 * Monetization Setup Workflow
 *
 * Main workflow that orchestrates payment infrastructure setup.
 */
export async function setupMonetization(
  input: MonetizeWorkflowInput
): Promise<MonetizeWorkflowOutput> {
  const startTime = Date.now();

  // Step 1: Create Stripe product
  const stripeProduct = await createStripeProduct({
    name: input.product_name,
    description: input.product_description,
    metadata: {
      project_id: input.project_id,
      created_by: 'autonomous-enterprise',
    },
  });

  // Step 2: Create pricing based on monetization strategy
  const prices: StripePrice[] = [];
  const paymentLinks: PaymentLink[] = [];

  if (input.strategy.model === 'free') {
    // No pricing setup needed for free products
  } else if (input.strategy.pricing) {
    // Create Stripe prices for each tier
    const pricingConfig = input.strategy.pricing;

    for (let i = 0; i < pricingConfig.tiers.length; i++) {
      const tier = pricingConfig.tiers[i];

      // Create the price in Stripe
      const stripePrice = await createStripePrices({
        product_id: stripeProduct.id,
        unit_amount: tier.price * 100, // Convert to cents
        currency: pricingConfig.currency.toLowerCase(),
        recurring:
          tier.interval
            ? {
                interval: tier.interval,
              }
            : undefined,
        metadata: {
          tier_name: tier.name,
          project_id: input.project_id,
        },
      });

      prices.push({
        id: stripePrice.id,
        tier_name: tier.name,
        amount: tier.price * 100,
        currency: pricingConfig.currency,
        interval: tier.interval,
        is_default: i === 0,
      });

      // Step 3: Generate payment link for this tier
      const paymentLink = await generatePaymentLink({
        price_id: stripePrice.id,
        product_id: stripeProduct.id,
        success_url: `${input.deployment_url}/success?tier=${tier.name}`,
        cancel_url: `${input.deployment_url}/pricing`,
      });

      paymentLinks.push({
        tier_name: tier.name,
        url: paymentLink.url,
        link_id: paymentLink.id,
        is_subscription: tier.interval !== undefined,
      });

      // Small delay between API calls to avoid rate limits
      await sleep('1s');
    }
  }

  // Step 4: Setup webhook for payment events
  const webhookEndpoint =
    input.webhook_url || `${input.deployment_url}/api/webhooks/stripe`;

  const webhook = await setupStripeWebhook({
    endpoint_url: webhookEndpoint,
    events: [
      'checkout.session.completed',
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'invoice.paid',
      'invoice.payment_failed',
    ],
    metadata: {
      project_id: input.project_id,
    },
  });

  // Step 5: Configure billing portal (for subscriptions)
  let billingPortalUrl: string | undefined;

  if (input.strategy.model === 'subscription' || input.strategy.model === 'freemium') {
    const billingPortal = await configureBillingPortal({
      product_id: stripeProduct.id,
      return_url: input.deployment_url,
    });

    billingPortalUrl = billingPortal.url;
  }

  // Calculate estimated MRR for subscription models
  let estimatedMRR: number | undefined;

  if (input.strategy.model === 'subscription' && input.strategy.pricing) {
    estimatedMRR = calculateEstimatedMRR(input.strategy.pricing.tiers);
  }

  const endTime = Date.now();

  return {
    project_id: input.project_id,
    stripe_product_id: stripeProduct.id,
    prices,
    payment_links: paymentLinks,
    webhook: {
      endpoint_url: webhookEndpoint,
      webhook_secret: webhook.secret,
      events: webhook.enabled_events,
    },
    billing_portal_url: billingPortalUrl,
    summary: {
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date(endTime).toISOString(),
      total_duration_ms: endTime - startTime,
      tiers_created: prices.length,
      model: input.strategy.model,
      estimated_mrr: estimatedMRR,
    },
  };
}

/**
 * Calculate estimated Monthly Recurring Revenue
 *
 * Simple heuristic based on pricing tiers.
 */
function calculateEstimatedMRR(tiers: PricingTier[]): number {
  // Assume 100 customers distributed across tiers (rough estimate)
  const totalCustomers = 100;

  // Weight distribution: 50% lowest tier, 30% middle, 20% highest
  const distribution =
    tiers.length === 1
      ? [1.0]
      : tiers.length === 2
        ? [0.7, 0.3]
        : [0.5, 0.3, 0.2];

  let mrr = 0;

  for (let i = 0; i < Math.min(tiers.length, distribution.length); i++) {
    const tier = tiers[i];
    const customersInTier = totalCustomers * distribution[i];

    // Convert to monthly if yearly
    const monthlyPrice =
      tier.interval === 'year' ? tier.price / 12 : tier.price;

    mrr += customersInTier * monthlyPrice;
  }

  return Math.round(mrr);
}

/**
 * Update pricing workflow
 *
 * Allows updating prices after initial setup.
 */
export async function updatePricing(input: {
  project_id: string;
  stripe_product_id: string;
  new_tiers: PricingTier[];
  currency: string;
}): Promise<{
  prices: StripePrice[];
  message: string;
}> {
  const prices: StripePrice[] = [];

  for (const tier of input.new_tiers) {
    const stripePrice = await createStripePrices({
      product_id: input.stripe_product_id,
      unit_amount: tier.price * 100,
      currency: input.currency.toLowerCase(),
      recurring:
        tier.interval
          ? {
              interval: tier.interval,
            }
          : undefined,
      metadata: {
        tier_name: tier.name,
        project_id: input.project_id,
      },
    });

    prices.push({
      id: stripePrice.id,
      tier_name: tier.name,
      amount: tier.price * 100,
      currency: input.currency,
      interval: tier.interval,
      is_default: false,
    });

    await sleep('1s');
  }

  return {
    prices,
    message: `Successfully created ${prices.length} new prices`,
  };
}
