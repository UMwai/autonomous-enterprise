/**
 * Genesis workflow activities
 *
 * Activities for product ideation, market validation, and specification generation.
 */

import type { ProductSpecification, TaskGraph, MarketValidation } from '../../workflows/genesis.js';

/**
 * Identify niche and validate market opportunity
 */
export async function identifyNiche(input: {
  intent: string;
  domain?: string;
}): Promise<MarketValidation> {
  // TODO: Implement with LLM-based market research
  // For now, return placeholder data

  return {
    niche: extractNicheFromIntent(input.intent),
    market_size: 'medium',
    competition_level: 'medium',
    viability_score: 75,
    risks: [
      'Market saturation in some segments',
      'Requires ongoing maintenance',
    ],
    opportunities: [
      'Growing demand in target market',
      'Opportunity for differentiation',
    ],
  };
}

/**
 * Validate market fit for specification
 */
export async function validateMarket(input: {
  specification: ProductSpecification;
  market_validation: MarketValidation;
}): Promise<{ passed: boolean; issues?: string[] }> {
  // TODO: Implement validation logic
  // For now, always pass

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
  // TODO: Implement MetaGPT integration
  // For now, return a basic specification

  const appName = extractAppNameFromIntent(input.intent);

  const specification: ProductSpecification = {
    name: appName,
    description: input.intent,
    target_users: ['General users', 'Early adopters'],
    features: [
      {
        id: 'feat-1',
        name: 'Core Functionality',
        description: 'Primary feature set',
        priority: 'critical',
        estimated_effort: '2-3 days',
      },
      {
        id: 'feat-2',
        name: 'User Interface',
        description: 'Clean, intuitive UI',
        priority: 'high',
        estimated_effort: '1-2 days',
      },
    ],
    tech_stack: {
      frontend: 'React + TypeScript',
      backend: 'Node.js + Express',
      database: 'PostgreSQL',
      infrastructure: 'Vercel',
    },
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
            price: 9.99,
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
  // TODO: Implement intelligent task graph generation
  // For now, return a basic task graph

  return {
    tasks: [
      {
        id: 'task-1',
        name: 'Setup Project Structure',
        description: 'Initialize project with build tools and configuration',
        type: 'backend',
        estimated_hours: 2,
        required_skills: ['Node.js', 'TypeScript'],
      },
      {
        id: 'task-2',
        name: 'Implement Core Logic',
        description: 'Build main application logic',
        type: 'backend',
        estimated_hours: 8,
        required_skills: ['TypeScript', 'API Design'],
      },
      {
        id: 'task-3',
        name: 'Build UI Components',
        description: 'Create React components',
        type: 'frontend',
        estimated_hours: 6,
        required_skills: ['React', 'TypeScript', 'CSS'],
      },
      {
        id: 'task-4',
        name: 'Write Tests',
        description: 'Unit and integration tests',
        type: 'testing',
        estimated_hours: 4,
        required_skills: ['Testing', 'Jest'],
      },
    ],
    dependencies: [
      { task_id: 'task-2', depends_on: ['task-1'] },
      { task_id: 'task-3', depends_on: ['task-1'] },
      { task_id: 'task-4', depends_on: ['task-2', 'task-3'] },
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
  // TODO: Store in database via API
  // For now, generate a product ID

  const productId = `prod_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  return productId;
}

/**
 * Helper: Extract niche from intent
 */
function extractNicheFromIntent(intent: string): string {
  // Simple keyword extraction
  const keywords = intent.toLowerCase();

  if (keywords.includes('todo') || keywords.includes('task')) {
    return 'Productivity Tools';
  } else if (keywords.includes('ecommerce') || keywords.includes('shop')) {
    return 'E-commerce';
  } else if (keywords.includes('blog') || keywords.includes('content')) {
    return 'Content Management';
  } else {
    return 'Web Applications';
  }
}

/**
 * Helper: Extract app name from intent
 */
function extractAppNameFromIntent(intent: string): string {
  // Try to extract a name, otherwise generate one
  const words = intent.split(' ');

  // Look for patterns like "build a X app" or "create a Y platform"
  for (let i = 0; i < words.length - 1; i++) {
    if (
      ['build', 'create', 'make'].includes(words[i].toLowerCase()) &&
      words[i + 1] !== 'a'
    ) {
      return words
        .slice(i + 1, i + 3)
        .join(' ')
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .trim();
    }
  }

  return 'AutoGenApp';
}
