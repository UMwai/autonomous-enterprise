/**
 * Genesis Workflow - Product Ideation and Specification
 *
 * Transforms user intent into validated product specifications using:
 * 1. Niche identification and market validation
 * 2. Product specification generation via MetaGPT
 * 3. Task graph creation for implementation
 */

import { proxyActivities, sleep } from '@temporalio/workflow';
import type * as activities from '../activities/index.js';

// Proxy activities with appropriate timeouts
const {
  identifyNiche,
  validateMarket,
  runMetaGPT,
  generateTaskGraph,
  storeSpecification,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '5s',
    backoffCoefficient: 2,
    maximumInterval: '1m',
  },
});

/**
 * Input for Genesis workflow
 */
export interface GenesisWorkflowInput {
  /** User's intent/prompt for product generation */
  intent: string;
  /** Budget in USD for this workflow run */
  budget: number;
  /** Maximum number of refinement iterations */
  max_iterations?: number;
  /** Optional industry/domain constraints */
  domain?: string;
  /** Optional target platform (web, mobile, cli, etc.) */
  platform?: string;
}

/**
 * Output from Genesis workflow
 */
export interface GenesisWorkflowOutput {
  /** Unique product identifier */
  product_id: string;
  /** Validated product specification */
  specification: ProductSpecification;
  /** Task dependency graph for implementation */
  task_graph: TaskGraph;
  /** Market validation results */
  market_validation: MarketValidation;
  /** Total cost of workflow execution */
  total_cost: number;
  /** Workflow execution metadata */
  metadata: WorkflowMetadata;
}

/**
 * Product specification structure
 */
export interface ProductSpecification {
  /** Product name */
  name: string;
  /** Brief description */
  description: string;
  /** Target audience/users */
  target_users: string[];
  /** Core features */
  features: Feature[];
  /** Technical stack */
  tech_stack: TechStack;
  /** Deployment requirements */
  deployment: DeploymentConfig;
  /** Monetization strategy */
  monetization: MonetizationStrategy;
}

export interface Feature {
  id: string;
  name: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  estimated_effort: string;
}

export interface TechStack {
  frontend?: string;
  backend?: string;
  database?: string;
  infrastructure?: string;
  apis?: string[];
}

export interface DeploymentConfig {
  platform: 'vercel' | 'netlify' | 'aws' | 'gcp';
  scaling: 'static' | 'serverless' | 'container';
  domains?: string[];
}

export interface MonetizationStrategy {
  model: 'free' | 'freemium' | 'subscription' | 'one-time' | 'ads';
  pricing?: {
    currency: string;
    tiers: PricingTier[];
  };
}

export interface PricingTier {
  name: string;
  price: number;
  interval?: 'month' | 'year';
  features: string[];
}

/**
 * Task dependency graph
 */
export interface TaskGraph {
  tasks: Task[];
  dependencies: Dependency[];
}

export interface Task {
  id: string;
  name: string;
  description: string;
  type: 'frontend' | 'backend' | 'database' | 'api' | 'deployment' | 'testing';
  estimated_hours: number;
  required_skills: string[];
}

export interface Dependency {
  task_id: string;
  depends_on: string[];
}

/**
 * Market validation results
 */
export interface MarketValidation {
  niche: string;
  market_size: 'small' | 'medium' | 'large';
  competition_level: 'low' | 'medium' | 'high';
  viability_score: number; // 0-100
  risks: string[];
  opportunities: string[];
}

/**
 * Workflow execution metadata
 */
export interface WorkflowMetadata {
  started_at: string;
  completed_at: string;
  iterations: number;
  llm_calls: number;
  tokens_used: number;
}

/**
 * Genesis Workflow
 *
 * Main workflow function that orchestrates product specification generation.
 */
export async function genesis(
  input: GenesisWorkflowInput
): Promise<GenesisWorkflowOutput> {
  const startTime = Date.now();
  let iterations = 0;
  const maxIterations = input.max_iterations || 3;

  // Step 1: Identify niche and validate market
  const marketValidation = await identifyNiche({
    intent: input.intent,
    domain: input.domain,
  });

  // Early exit if market is not viable
  if (marketValidation.viability_score < 30) {
    throw new Error(
      `Market viability too low (${marketValidation.viability_score}/100). ` +
        `Consider pivoting: ${marketValidation.risks.join(', ')}`
    );
  }

  // Step 2: Generate product specification using MetaGPT
  let specification: ProductSpecification | null = null;
  let validationPassed = false;

  while (iterations < maxIterations && !validationPassed) {
    iterations++;

    // Run MetaGPT to generate specification
    const metaGPTResult = await runMetaGPT({
      intent: input.intent,
      niche: marketValidation.niche,
      platform: input.platform || 'web',
      budget: input.budget,
      iteration: iterations,
    });

    specification = metaGPTResult.specification;

    // Validate specification
    const validation = await validateMarket({
      specification,
      market_validation: marketValidation,
    });

    if (validation.passed) {
      validationPassed = true;
    } else if (iterations < maxIterations) {
      // Wait before retrying
      await sleep('5s');
    }
  }

  if (!specification || !validationPassed) {
    throw new Error(
      `Failed to generate valid specification after ${maxIterations} iterations`
    );
  }

  // Step 3: Generate task graph for implementation
  const taskGraph = await generateTaskGraph({
    specification,
    budget: input.budget,
  });

  // Step 4: Store specification in database
  const productId = await storeSpecification({
    specification,
    task_graph: taskGraph,
    market_validation: marketValidation,
  });

  // Calculate total cost
  const totalCost = calculateWorkflowCost(iterations, taskGraph);

  return {
    product_id: productId,
    specification,
    task_graph: taskGraph,
    market_validation: marketValidation,
    total_cost: totalCost,
    metadata: {
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      iterations,
      llm_calls: iterations * 3, // Rough estimate
      tokens_used: 0, // Would be tracked by activities
    },
  };
}

/**
 * Calculate estimated workflow cost
 */
function calculateWorkflowCost(iterations: number, taskGraph: TaskGraph): number {
  // Rough cost estimation based on LLM calls
  // In production, this would be tracked by actual API costs
  const costPerIteration = 0.5; // $0.50 per iteration
  const costPerTask = 0.1; // $0.10 per task analyzed

  return iterations * costPerIteration + taskGraph.tasks.length * costPerTask;
}
