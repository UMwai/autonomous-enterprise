/**
 * Genesis workflow activities
 *
 * Activities for product ideation, market validation, and specification generation.
 * These activities call the Python API endpoints which contain the actual LLM logic.
 */

import type { ProductSpecification, TaskGraph, MarketValidation } from '../../workflows/genesis.js';

/**
 * API base URL from environment
 */
const API_BASE_URL = process.env.API_URL || 'http://localhost:8000/api/v1';

/**
 * HTTP client helper with error handling
 */
async function apiCall<T>(
  endpoint: string,
  method: 'GET' | 'POST' = 'POST',
  body?: unknown
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API call failed: ${response.status} ${error}`);
  }

  return response.json() as Promise<T>;
}

/**
 * Internal state for storing niche data between activity calls
 */
interface NicheData {
  niche: Record<string, unknown>;
  validationReport: Record<string, unknown>;
}

// In-memory cache for niche data (in production, use Redis or Temporal workflow state)
const nicheCache = new Map<string, NicheData>();

/**
 * Identify niche and validate market opportunity
 *
 * This activity:
 * 1. Ingests trends from Reddit and HackerNews
 * 2. Identifies niches using RAG
 * 3. Validates the top niche
 */
export async function identifyNiche(input: {
  intent: string;
  domain?: string;
}): Promise<MarketValidation> {
  console.log(`[Genesis] Identifying niche for intent: ${input.intent}`);

  // Step 1: Ingest trends from sources
  console.log('[Genesis] Step 1: Ingesting trends from Reddit and HackerNews...');
  await apiCall<{ total_ingested: number }>('/genesis/ingest-trends', 'POST', {
    intent: input.intent,
    sources: ['reddit', 'hackernews'],
    limit: 50,
  });

  // Step 2: Identify niches using RAG
  console.log('[Genesis] Step 2: Identifying niches using RAG...');
  const nichesResponse = await apiCall<{ niches: Record<string, unknown>[]; total: number }>(
    '/genesis/identify-niches',
    'POST',
    {
      intent: input.intent,
      count: 5,
      domain: input.domain,
    }
  );

  if (nichesResponse.niches.length === 0) {
    throw new Error('No niches identified. Please try a different intent.');
  }

  const topNiche = nichesResponse.niches[0];
  console.log(`[Genesis] Top niche identified: ${topNiche.name}`);

  // Step 3: Validate the top niche
  console.log('[Genesis] Step 3: Validating top niche...');
  const validationResponse = await apiCall<{
    validation_report: Record<string, unknown>;
    should_pursue: boolean;
    validation_score: number;
  }>('/genesis/validate-niche', 'POST', {
    niche: topNiche,
  });

  // Store niche data for later use
  const cacheKey = `niche_${input.intent.substring(0, 50)}`;
  nicheCache.set(cacheKey, {
    niche: topNiche,
    validationReport: validationResponse.validation_report,
  });

  // Map to MarketValidation format
  const metrics = validationResponse.validation_report.metrics as Record<string, unknown> || {};
  const niche = topNiche as Record<string, unknown>;

  return {
    niche: niche.name as string || 'Unknown Niche',
    market_size: mapMarketSize(metrics.market_size_estimate as string),
    competition_level: mapCompetitionLevel(metrics.competitor_density as number),
    viability_score: validationResponse.validation_score,
    risks: (validationResponse.validation_report.weaknesses as string[]) || [],
    opportunities: (validationResponse.validation_report.strengths as string[]) || [],
  };
}

/**
 * Validate market fit for specification
 */
export async function validateMarket(input: {
  specification: ProductSpecification;
  market_validation: MarketValidation;
}): Promise<{ passed: boolean; issues?: string[] }> {
  console.log(`[Genesis] Validating market fit for: ${input.specification.name}`);

  // Market validation is primarily done in identifyNiche
  // This is a secondary check based on specification
  const viabilityScore = input.market_validation.viability_score;

  if (viabilityScore < 40) {
    return {
      passed: false,
      issues: [
        `Low viability score: ${viabilityScore}`,
        ...input.market_validation.risks,
      ],
    };
  }

  return {
    passed: true,
  };
}

/**
 * Run MetaGPT to generate product specification
 */
export async function runMetaGPT(input: {
  intent: string;
  niche: string;
  platform: string;
  budget: number;
  iteration: number;
}): Promise<{ specification: ProductSpecification }> {
  console.log(`[Genesis] Running MetaGPT for niche: ${input.niche}, iteration: ${input.iteration}`);

  // Retrieve cached niche data
  const cacheKey = `niche_${input.intent.substring(0, 50)}`;
  const cachedData = nicheCache.get(cacheKey);

  if (!cachedData) {
    throw new Error('Niche data not found. Run identifyNiche first.');
  }

  // Call generate-spec endpoint
  const specResponse = await apiCall<{
    product_spec: Record<string, unknown>;
    technical_spec: Record<string, unknown>;
    task_graph: Record<string, unknown>;
  }>('/genesis/generate-spec', 'POST', {
    niche: cachedData.niche,
    validation_report: cachedData.validationReport,
  });

  const productSpec = specResponse.product_spec;
  const technicalSpec = specResponse.technical_spec;

  // Map to ProductSpecification format
  const specification: ProductSpecification = {
    name: productSpec.product_name as string || 'AutoGenApp',
    description: productSpec.vision_statement as string || input.intent,
    target_users: [productSpec.target_users as string || 'General users'],
    features: mapFeatures(productSpec.core_features as string[], productSpec.user_stories as unknown[]),
    tech_stack: mapTechStack(technicalSpec.tech_stack as Record<string, string>),
    deployment: {
      platform: 'vercel',
      scaling: 'serverless',
    },
    monetization: {
      model: 'freemium',
      pricing: {
        currency: 'USD',
        tiers: [
          {
            name: 'Free',
            price: 0,
            features: ['Basic features', 'Community support'],
          },
          {
            name: 'Pro',
            price: 29.99,
            interval: 'month',
            features: ['All features', 'Priority support', 'Advanced analytics'],
          },
        ],
      },
    },
  };

  return { specification };
}

/**
 * Generate task dependency graph from specification
 */
export async function generateTaskGraph(input: {
  specification: ProductSpecification;
  budget: number;
}): Promise<TaskGraph> {
  console.log(`[Genesis] Generating task graph for: ${input.specification.name}`);

  // The task graph was already generated by runMetaGPT
  // For now, we'll retrieve it from cache or create a default one

  // In a full implementation, we'd store the task_graph from generate-spec
  // and retrieve it here. For now, we create a sensible default based on the spec.

  const tasks = [
    {
      id: 'task-setup',
      name: 'Project Setup',
      description: 'Initialize repository, configure build tools, set up CI/CD',
      type: 'backend' as const,
      estimated_hours: 4,
      required_skills: ['Git', 'Node.js', 'DevOps'],
    },
    {
      id: 'task-db',
      name: 'Database Schema',
      description: `Create database models for ${input.specification.name}`,
      type: 'database' as const,
      estimated_hours: 4,
      required_skills: ['PostgreSQL', 'Database Design'],
    },
    {
      id: 'task-api',
      name: 'Backend API',
      description: 'Implement REST API endpoints',
      type: 'backend' as const,
      estimated_hours: 12,
      required_skills: ['Node.js', 'TypeScript', 'REST API'],
    },
    {
      id: 'task-auth',
      name: 'Authentication',
      description: 'Implement user authentication and authorization',
      type: 'backend' as const,
      estimated_hours: 8,
      required_skills: ['Auth0', 'JWT', 'Security'],
    },
    {
      id: 'task-ui',
      name: 'Frontend UI',
      description: 'Build React components and pages',
      type: 'frontend' as const,
      estimated_hours: 16,
      required_skills: ['React', 'TypeScript', 'CSS'],
    },
    {
      id: 'task-integration',
      name: 'Frontend-Backend Integration',
      description: 'Connect frontend to API, implement state management',
      type: 'frontend' as const,
      estimated_hours: 8,
      required_skills: ['React', 'API Integration'],
    },
    {
      id: 'task-tests',
      name: 'Testing',
      description: 'Write unit and integration tests',
      type: 'testing' as const,
      estimated_hours: 8,
      required_skills: ['Jest', 'Testing'],
    },
    {
      id: 'task-deploy',
      name: 'Deployment',
      description: 'Deploy to production environment',
      type: 'deployment' as const,
      estimated_hours: 4,
      required_skills: ['Vercel', 'DevOps'],
    },
  ];

  return {
    tasks,
    dependencies: [
      { task_id: 'task-db', depends_on: ['task-setup'] },
      { task_id: 'task-api', depends_on: ['task-setup', 'task-db'] },
      { task_id: 'task-auth', depends_on: ['task-api'] },
      { task_id: 'task-ui', depends_on: ['task-setup'] },
      { task_id: 'task-integration', depends_on: ['task-api', 'task-ui'] },
      { task_id: 'task-tests', depends_on: ['task-integration', 'task-auth'] },
      { task_id: 'task-deploy', depends_on: ['task-tests'] },
    ],
  };
}

/**
 * Store specification in database
 */
export async function storeSpecification(input: {
  specification: ProductSpecification;
  task_graph: TaskGraph;
  market_validation: MarketValidation;
}): Promise<string> {
  console.log(`[Genesis] Storing specification for: ${input.specification.name}`);

  // TODO: Call API to store in database
  // For now, generate a product ID
  const productId = `prod_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  console.log(`[Genesis] Product ID generated: ${productId}`);

  return productId;
}

// ============================================================================
// Helper Functions
// ============================================================================

function mapMarketSize(estimate: string | undefined): 'small' | 'medium' | 'large' {
  if (!estimate) return 'medium';
  const lower = estimate.toLowerCase();
  if (lower.includes('micro') || lower.includes('small')) return 'small';
  if (lower.includes('large') || lower.includes('massive')) return 'large';
  return 'medium';
}

function mapCompetitionLevel(density: number | undefined): 'low' | 'medium' | 'high' {
  if (density === undefined) return 'medium';
  if (density <= 5) return 'low';
  if (density >= 20) return 'high';
  return 'medium';
}

function mapFeatures(
  coreFeatures: string[] | undefined,
  _userStories: unknown[] | undefined
): ProductSpecification['features'] {
  const features: ProductSpecification['features'] = [];

  if (coreFeatures) {
    coreFeatures.slice(0, 5).forEach((feature, index) => {
      features.push({
        id: `feat-${index + 1}`,
        name: feature.split(' ').slice(0, 3).join(' '),
        description: feature,
        priority: index === 0 ? 'critical' : index < 3 ? 'high' : 'medium',
        estimated_effort: index < 2 ? '2-3 days' : '1-2 days',
      });
    });
  }

  if (features.length === 0) {
    features.push({
      id: 'feat-1',
      name: 'Core Functionality',
      description: 'Primary feature set',
      priority: 'critical',
      estimated_effort: '2-3 days',
    });
  }

  return features;
}

function mapTechStack(
  stack: Record<string, string> | undefined
): ProductSpecification['tech_stack'] {
  if (!stack) {
    return {
      frontend: 'React + TypeScript',
      backend: 'Node.js + Express',
      database: 'PostgreSQL',
      infrastructure: 'Vercel',
    };
  }

  return {
    frontend: extractTech(stack.frontend) || 'React + TypeScript',
    backend: extractTech(stack.backend) || 'Node.js + Express',
    database: extractTech(stack.database) || 'PostgreSQL',
    infrastructure: extractTech(stack.hosting) || 'Vercel',
    apis: stack.other ? [stack.other] : undefined,
  };
}

function extractTech(value: string | undefined): string | undefined {
  if (!value) return undefined;
  // Extract just the technology name, not the "why"
  const parts = value.split(':');
  return parts[0].trim();
}
