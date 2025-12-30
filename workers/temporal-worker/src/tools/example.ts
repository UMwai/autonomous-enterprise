/**
 * Example usage of the Atomic Tools Layer.
 *
 * This file demonstrates how to:
 * - Create a tool registry
 * - Set up a tool context
 * - Execute tools with safety guarantees
 * - Handle results and side effects
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import {
  createDefaultRegistry,
  createConsoleObserver,
  ToolExecutor,
  ToolContext,
} from './index.js';
import { PolicyClient } from '../safety/policyClient.js';
import { BudgetClient } from '../safety/budgets.js';

/**
 * Example: Execute a sequence of tools to read and search files.
 */
export async function exampleReadAndSearch() {
  // 1. Create registry with all built-in tools
  const registry = createDefaultRegistry();

  // 2. Set up infrastructure clients
  const policyClient = new PolicyClient('http://localhost:8000');
  const budgetClient = new BudgetClient('http://localhost:8000');
  const observer = createConsoleObserver();

  // 3. Create execution context
  const context: ToolContext = {
    workspace: '/tmp/test-workspace',
    runId: 'example-run-001',
    phase: 'build',
    budget: 10.0,
    policyClient,
    budgetClient,
    observer,
    env: {
      NODE_ENV: 'development',
    },
  };

  // 4. Create executor
  const executor = new ToolExecutor();

  // 5. Execute read tool
  const readTool = registry.get('read_file');
  if (!readTool) {
    throw new Error('read_file tool not found');
  }

  const readResult = await executor.execute(
    readTool,
    {
      path: 'package.json',
      encoding: 'utf-8',
    },
    context
  );

  if (readResult.success && readResult.data) {
    console.log('Read file successfully:', readResult.data);
  } else {
    console.error('Failed to read file:', readResult.errors);
  }

  // 6. Execute grep tool
  const grepTool = registry.get('grep');
  if (!grepTool) {
    throw new Error('grep tool not found');
  }

  const grepResult = await executor.execute(
    grepTool,
    {
      pattern: 'import.*from',
      path: 'src',
      fileType: 'ts',
      showLineNumbers: true,
      maxResults: 10,
    },
    context
  );

  if (grepResult.success && grepResult.data) {
    console.log('Grep results:', grepResult.data);
  }
}

/**
 * Example: Execute tools in sequence with error handling.
 */
export async function exampleSequenceExecution() {
  const registry = createDefaultRegistry();
  const executor = new ToolExecutor();

  // Mock context (in real use, these would be actual clients)
  const context: ToolContext = {
    workspace: '/tmp/test-workspace',
    runId: 'example-run-002',
    phase: 'build',
    budget: 10.0,
    policyClient: new PolicyClient(),
    budgetClient: new BudgetClient(),
    observer: createConsoleObserver(),
    env: {},
  };

  // Execute a sequence: read, then edit, then read again
  const results = await executor.executeSequence(
    [
      {
        tool: registry.get('read_file')!,
        input: { path: 'test.txt' },
      },
      {
        tool: registry.get('apply_patch')!,
        input: {
          path: 'test.txt',
          oldText: 'foo',
          newText: 'bar',
        },
      },
      {
        tool: registry.get('read_file')!,
        input: { path: 'test.txt' },
      },
    ],
    context,
    false // Stop on first error
  );

  // Check results
  const allSucceeded = results.every((r) => r.success);
  console.log('All operations succeeded:', allSucceeded);

  // Calculate total cost
  const totalCost = results.reduce((sum, r) => sum + r.cost, 0);
  console.log('Total cost:', totalCost);

  // Rollback if needed
  if (!allSucceeded) {
    console.log('Rolling back side effects...');
    for (const result of results.reverse()) {
      for (const effect of result.sideEffects) {
        if (effect.rollbackAction) {
          await effect.rollbackAction();
        }
      }
    }
  }
}

/**
 * Example: Parallel execution of independent tools.
 */
export async function exampleParallelExecution() {
  const registry = createDefaultRegistry();
  const executor = new ToolExecutor();

  const context: ToolContext = {
    workspace: '/tmp/test-workspace',
    runId: 'example-run-003',
    phase: 'build',
    budget: 10.0,
    policyClient: new PolicyClient(),
    budgetClient: new BudgetClient(),
    observer: createConsoleObserver(),
    env: {},
  };

  // Execute multiple greps in parallel
  const results = await executor.executeParallel(
    [
      {
        tool: registry.get('grep')!,
        input: { pattern: 'TODO', path: 'src', fileType: 'ts' },
      },
      {
        tool: registry.get('grep')!,
        input: { pattern: 'FIXME', path: 'src', fileType: 'ts' },
      },
      {
        tool: registry.get('grep')!,
        input: { pattern: 'console.log', path: 'src', fileType: 'ts' },
      },
    ],
    context
  );

  console.log('Parallel execution results:', results.length);
}

/**
 * Example: List available tools and their metadata.
 */
function exampleListTools() {
  const registry = createDefaultRegistry();

  console.log('Available tools:');
  console.log('=================');

  for (const tool of registry.list()) {
    console.log(`
Name:        ${tool.name}
Description: ${tool.description}
Category:    ${tool.category}
Risk Level:  ${tool.riskLevel}
Est. Cost:   $${tool.estimatedCost.toFixed(4)}
    `);
  }

  // Get tools by category
  const readTools = registry.getByCategory('read' as any);
  console.log(`Found ${readTools.length} read tools`);

  // Get safe tools only
  const safeTools = registry.getByMaxRisk('safe' as any);
  console.log(`Found ${safeTools.length} safe tools`);
}

/**
 * Example: Execute critical-risk tools (requires approval).
 */
export async function exampleCriticalTools() {
  const registry = createDefaultRegistry();
  const executor = new ToolExecutor();

  const context: ToolContext = {
    workspace: '/tmp/test-workspace',
    runId: 'example-run-004',
    phase: 'ship',
    budget: 10.0,
    policyClient: new PolicyClient(),
    budgetClient: new BudgetClient(),
    observer: createConsoleObserver(),
    env: {},
  };

  // Example 1: Deploy to Vercel (CRITICAL risk)
  const deployTool = registry.get('deploy_vercel');
  if (deployTool) {
    console.log('\n=== Attempting Vercel Deployment (CRITICAL) ===');

    const result = await executor.execute(
      deployTool,
      {
        projectName: 'my-saas-app',
        envVars: {
          NODE_ENV: 'production',
          API_KEY: 'secret-key',
        },
        waitForCompletion: true,
      },
      context
    );

    if (!result.success) {
      console.log('Deployment blocked or failed:', result.errors?.[0]?.message);
      if (result.errors?.[0]?.code === 'APPROVAL_REQUIRED') {
        console.log('Action requires human approval via ApprovalClient');
      }
    } else {
      console.log('Deployment succeeded:', result.data);
    }
  }

  // Example 2: Create Stripe product (CRITICAL risk)
  const billingTool = registry.get('create_stripe_product');
  if (billingTool) {
    console.log('\n=== Attempting Stripe Product Creation (CRITICAL) ===');

    const result = await executor.execute(
      billingTool,
      {
        name: 'Premium Plan',
        description: 'Full access to all features',
        priceInCents: 2999, // $29.99
        currency: 'usd',
        interval: 'month',
        trialPeriodDays: 14,
      },
      context
    );

    if (!result.success) {
      console.log('Billing operation blocked or failed:', result.errors?.[0]?.message);
      if (result.errors?.[0]?.code === 'APPROVAL_REQUIRED') {
        console.log('Action requires human approval via ApprovalClient');
      }
    } else {
      console.log('Product created:', result.data);
    }
  }
}

// Run examples (comment out as needed)
if (import.meta.url === `file://${process.argv[1]}`) {
  exampleListTools();
  // Uncomment to run other examples:
  // exampleReadAndSearch().catch(console.error);
  // exampleSequenceExecution().catch(console.error);
  // exampleParallelExecution().catch(console.error);
  // exampleCriticalTools().catch(console.error);
}
