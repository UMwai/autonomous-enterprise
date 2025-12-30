/**
 * Stripe monetization activities
 *
 * Activities for setting up Stripe products, prices, and payment infrastructure.
 * Uses the Stripe Node.js SDK for real API integration.
 */

import Stripe from 'stripe';

/**
 * Get Stripe client instance
 */
function getStripeClient(): Stripe {
  const apiKey = process.env.STRIPE_API_KEY;
  if (!apiKey) {
    throw new Error('STRIPE_API_KEY environment variable is not set');
  }
  return new Stripe(apiKey, {
    apiVersion: '2025-02-24.acacia',
  });
}

/**
 * Create a Stripe product
 */
export async function createStripeProduct(input: {
  name: string;
  description: string;
  projectId?: string;
  metadata?: Record<string, string>;
}): Promise<{
  id: string;
  name: string;
  active: boolean;
}> {
  console.log(`[Stripe] Creating product: ${input.name}`);

  const stripe = getStripeClient();

  const product = await stripe.products.create({
    name: input.name,
    description: input.description,
    metadata: {
      project_id: input.projectId || '',
      created_by: 'autonomous-enterprise',
      ...input.metadata,
    },
  });

  console.log(`[Stripe] Product created: ${product.id}`);

  return {
    id: product.id,
    name: product.name,
    active: product.active,
  };
}

/**
 * Create Stripe price for a product
 */
export async function createStripePrices(input: {
  product_id: string;
  unit_amount: number;
  currency: string;
  recurring?: {
    interval: 'month' | 'year';
    interval_count?: number;
  };
  metadata?: Record<string, string>;
}): Promise<{
  id: string;
  product_id: string;
  unit_amount: number;
  currency: string;
  type: 'one_time' | 'recurring';
}> {
  console.log(`[Stripe] Creating price for product: ${input.product_id}`);

  const stripe = getStripeClient();

  const priceData: Stripe.PriceCreateParams = {
    product: input.product_id,
    unit_amount: Math.round(input.unit_amount * 100), // Convert to cents
    currency: input.currency.toLowerCase(),
    metadata: {
      created_by: 'autonomous-enterprise',
      ...input.metadata,
    },
  };

  if (input.recurring) {
    priceData.recurring = {
      interval: input.recurring.interval,
      interval_count: input.recurring.interval_count || 1,
    };
  }

  const price = await stripe.prices.create(priceData);

  console.log(`[Stripe] Price created: ${price.id}`);

  return {
    id: price.id,
    product_id: input.product_id,
    unit_amount: input.unit_amount,
    currency: input.currency,
    type: price.type,
  };
}

/**
 * Generate a payment link
 */
export async function generatePaymentLink(input: {
  price_id: string;
  product_id: string;
  success_url?: string;
  cancel_url?: string;
  allow_promotion_codes?: boolean;
  metadata?: Record<string, string>;
}): Promise<{
  id: string;
  url: string;
  active: boolean;
}> {
  console.log(`[Stripe] Creating payment link for price: ${input.price_id}`);

  const stripe = getStripeClient();

  const paymentLink = await stripe.paymentLinks.create({
    line_items: [
      {
        price: input.price_id,
        quantity: 1,
      },
    ],
    allow_promotion_codes: input.allow_promotion_codes || false,
    after_completion: input.success_url
      ? {
          type: 'redirect',
          redirect: {
            url: input.success_url,
          },
        }
      : {
          type: 'hosted_confirmation',
          hosted_confirmation: {
            custom_message: 'Thank you for your purchase!',
          },
        },
    metadata: {
      product_id: input.product_id,
      created_by: 'autonomous-enterprise',
      ...input.metadata,
    },
  });

  console.log(`[Stripe] Payment link created: ${paymentLink.url}`);

  return {
    id: paymentLink.id,
    url: paymentLink.url,
    active: paymentLink.active,
  };
}

/**
 * Setup Stripe webhook endpoint
 */
export async function setupStripeWebhook(input: {
  endpoint_url: string;
  events: string[];
  description?: string;
  metadata?: Record<string, string>;
}): Promise<{
  id: string;
  secret: string;
  enabled_events: string[];
  url: string;
}> {
  console.log(`[Stripe] Setting up webhook: ${input.endpoint_url}`);

  const stripe = getStripeClient();

  const webhook = await stripe.webhookEndpoints.create({
    url: input.endpoint_url,
    enabled_events: input.events as Stripe.WebhookEndpointCreateParams.EnabledEvent[],
    description: input.description || 'Autonomous Enterprise webhook',
    metadata: {
      created_by: 'autonomous-enterprise',
      ...input.metadata,
    },
  });

  console.log(`[Stripe] Webhook created: ${webhook.id}`);

  return {
    id: webhook.id,
    secret: webhook.secret || '',
    enabled_events: webhook.enabled_events,
    url: webhook.url,
  };
}

/**
 * Create checkout session
 */
export async function createCheckoutSession(input: {
  price_id: string;
  success_url: string;
  cancel_url: string;
  customer_email?: string;
  mode?: 'payment' | 'subscription';
  trial_period_days?: number;
  metadata?: Record<string, string>;
}): Promise<{
  id: string;
  url: string;
  expires_at: number;
}> {
  console.log(`[Stripe] Creating checkout session for price: ${input.price_id}`);

  const stripe = getStripeClient();

  const sessionData: Stripe.Checkout.SessionCreateParams = {
    line_items: [
      {
        price: input.price_id,
        quantity: 1,
      },
    ],
    mode: input.mode || 'subscription',
    success_url: input.success_url,
    cancel_url: input.cancel_url,
    metadata: {
      created_by: 'autonomous-enterprise',
      ...input.metadata,
    },
  };

  if (input.customer_email) {
    sessionData.customer_email = input.customer_email;
  }

  if (input.trial_period_days && input.mode === 'subscription') {
    sessionData.subscription_data = {
      trial_period_days: input.trial_period_days,
    };
  }

  const session = await stripe.checkout.sessions.create(sessionData);

  console.log(`[Stripe] Checkout session created: ${session.id}`);

  return {
    id: session.id,
    url: session.url || '',
    expires_at: session.expires_at,
  };
}

/**
 * Configure billing portal
 */
export async function configureBillingPortal(input: {
  customer_id?: string;
  return_url: string;
}): Promise<{
  url: string;
}> {
  console.log(`[Stripe] Creating billing portal session`);

  const stripe = getStripeClient();

  // If no customer ID, create a portal configuration
  if (!input.customer_id) {
    // Get or create a default portal configuration
    const configurations = await stripe.billingPortal.configurations.list({
      limit: 1,
      active: true,
    });

    if (configurations.data.length === 0) {
      // Create a default configuration
      await stripe.billingPortal.configurations.create({
        business_profile: {
          headline: 'Manage your subscription',
        },
        features: {
          subscription_cancel: {
            enabled: true,
            mode: 'at_period_end',
          },
          subscription_update: {
            enabled: true,
            default_allowed_updates: ['price', 'quantity'],
            proration_behavior: 'create_prorations',
          },
          payment_method_update: {
            enabled: true,
          },
          invoice_history: {
            enabled: true,
          },
        },
        default_return_url: input.return_url,
      });
    }

    return {
      url: input.return_url, // Return to the provided URL if no customer
    };
  }

  // Create a portal session for the customer
  const session = await stripe.billingPortal.sessions.create({
    customer: input.customer_id,
    return_url: input.return_url,
  });

  console.log(`[Stripe] Billing portal session created`);

  return {
    url: session.url,
  };
}

/**
 * Create a customer
 */
export async function createCustomer(input: {
  email: string;
  name?: string;
  projectId?: string;
  metadata?: Record<string, string>;
}): Promise<{
  id: string;
  email: string;
}> {
  console.log(`[Stripe] Creating customer: ${input.email}`);

  const stripe = getStripeClient();

  const customer = await stripe.customers.create({
    email: input.email,
    name: input.name,
    metadata: {
      project_id: input.projectId || '',
      created_by: 'autonomous-enterprise',
      ...input.metadata,
    },
  });

  console.log(`[Stripe] Customer created: ${customer.id}`);

  return {
    id: customer.id,
    email: customer.email || input.email,
  };
}

/**
 * Get subscription status
 */
export async function getSubscriptionStatus(input: {
  subscription_id: string;
}): Promise<{
  id: string;
  status: string;
  current_period_end: number;
  cancel_at_period_end: boolean;
}> {
  console.log(`[Stripe] Getting subscription status: ${input.subscription_id}`);

  const stripe = getStripeClient();

  const subscription = await stripe.subscriptions.retrieve(input.subscription_id);

  return {
    id: subscription.id,
    status: subscription.status,
    current_period_end: subscription.current_period_end,
    cancel_at_period_end: subscription.cancel_at_period_end,
  };
}

/**
 * Get revenue metrics
 */
export async function getRevenueMetrics(input: {
  product_id?: string;
  start_date?: number;
  end_date?: number;
}): Promise<{
  total_revenue: number;
  active_subscriptions: number;
  mrr: number;
  currency: string;
}> {
  console.log(`[Stripe] Getting revenue metrics`);

  const stripe = getStripeClient();

  // Get active subscriptions
  const subscriptions = await stripe.subscriptions.list({
    status: 'active',
    limit: 100,
  });

  let totalRevenue = 0;
  let activeCount = 0;
  let mrr = 0;

  for (const sub of subscriptions.data) {
    // Filter by product if specified
    if (input.product_id) {
      const hasProduct = sub.items.data.some(item =>
        (item.price.product as string) === input.product_id
      );
      if (!hasProduct) continue;
    }

    activeCount++;

    // Calculate MRR from this subscription
    for (const item of sub.items.data) {
      const price = item.price;
      const quantity = item.quantity || 1;
      const amount = (price.unit_amount || 0) * quantity;

      // Normalize to monthly
      if (price.recurring?.interval === 'year') {
        mrr += amount / 12;
      } else {
        mrr += amount;
      }
    }
  }

  // Get recent charges for total revenue
  const charges = await stripe.charges.list({
    limit: 100,
    created: {
      gte: input.start_date || Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60, // Last 30 days
      lte: input.end_date || Math.floor(Date.now() / 1000),
    },
  });

  for (const charge of charges.data) {
    if (charge.paid && !charge.refunded) {
      totalRevenue += charge.amount;
    }
  }

  return {
    total_revenue: totalRevenue / 100, // Convert from cents
    active_subscriptions: activeCount,
    mrr: mrr / 100, // Convert from cents
    currency: 'usd',
  };
}
