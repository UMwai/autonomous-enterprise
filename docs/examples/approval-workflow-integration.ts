/**
 * Example: Integrating HITL Approval Gateway with Temporal Workflows
 *
 * This example demonstrates how to use the approval gateway within
 * Temporal workflows for the Autonomous Enterprise.
 */

import { proxyActivities } from '@temporalio/workflow';
import { PolicyClient, ActionType, ApprovalClient, ApprovalStatus } from '../workers/temporal-worker/src/safety';

// Define activities interface
interface Activities {
  deployToVercel(config: DeployConfig): Promise<DeployResult>;
  createStripeProduct(product: ProductConfig): Promise<StripeProduct>;
  executeCommand(command: string): Promise<CommandResult>;
}

interface DeployConfig {
  projectName: string;
  environment: string;
  domain?: string;
}

interface DeployResult {
  url: string;
  deploymentId: string;
  status: string;
}

interface ProductConfig {
  name: string;
  price: number;
  interval: string;
}

interface StripeProduct {
  id: string;
  priceId: string;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// Proxy activities with retry policies
const { deployToVercel, createStripeProduct, executeCommand } = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    initialInterval: '5s',
    maximumInterval: '30s',
    maximumAttempts: 3,
  },
});

/**
 * Example 1: Build & Ship Workflow with Deployment Approval
 */
export async function buildAndShipWorkflow(
  projectName: string,
  environment: string
): Promise<DeployResult> {
  const runId = 'wf_' + Date.now().toString(); // In real workflow, use workflowInfo.workflowId
  const policyClient = new PolicyClient();
  const approvalClient = new ApprovalClient();

  // 1. Build phase (no approval needed)
  console.log(`Building ${projectName}...`);
  await executeCommand(`npm run build`);

  // 2. Test phase (no approval needed)
  console.log(`Testing ${projectName}...`);
  await executeCommand(`npm run test`);

  // 3. Deployment phase (requires approval)
  console.log(`Preparing to deploy ${projectName} to ${environment}...`);

  const deployConfig: DeployConfig = {
    projectName,
    environment,
  };

  // Check policy first
  const policyDecision = await policyClient.checkDeployment(environment, deployConfig);

  if (!policyDecision.allowed) {
    throw new Error(`Deployment blocked by policy: ${policyDecision.reason}`);
  }

  // If approval required, request it
  if (policyDecision.requires_approval) {
    console.log(`Deployment requires human approval. Requesting approval...`);

    try {
      // Request approval and wait (blocks workflow until decision)
      const approval = await approvalClient.requestAndWait(
        {
          action_id: `deploy-${projectName}-${Date.now()}`,
          action_type: 'deploy',
          description: `Deploy ${projectName} to ${environment} environment`,
          context: {
            platform: 'vercel',
            config: deployConfig,
            tests_passed: true,
            build_successful: true,
          },
          run_id: runId,
          requested_by: 'build-ship-workflow',
          timeout_seconds: 3600, // 1 hour for deployment review
        },
        5 // Poll every 5 seconds
      );

      console.log(
        `Deployment approved by ${approval.decided_by}: ${approval.decision_reason || 'No reason provided'}`
      );
    } catch (error) {
      // Approval was rejected, expired, or cancelled
      throw new Error(`Deployment approval failed: ${error.message}`);
    }
  }

  // Proceed with deployment (approval granted or not required)
  console.log(`Deploying ${projectName} to ${environment}...`);
  const result = await deployToVercel(deployConfig);

  console.log(`Deployment successful: ${result.url}`);
  return result;
}

/**
 * Example 2: Monetization Workflow with Billing Approval
 */
export async function monetizeWorkflow(
  projectName: string,
  pricingTier: 'free' | 'pro' | 'enterprise'
): Promise<StripeProduct> {
  const runId = 'wf_' + Date.now().toString();
  const policyClient = new PolicyClient();
  const approvalClient = new ApprovalClient();

  const pricingMap = {
    free: { price: 0, name: 'Free' },
    pro: { price: 29.99, name: 'Pro' },
    enterprise: { price: 299.99, name: 'Enterprise' },
  };

  const pricing = pricingMap[pricingTier];

  const productConfig: ProductConfig = {
    name: `${projectName} - ${pricing.name}`,
    price: pricing.price,
    interval: 'month',
  };

  // Skip approval for free tier
  if (pricingTier === 'free') {
    console.log('Creating free tier product (no approval needed)...');
    return await createStripeProduct(productConfig);
  }

  // Check policy for paid tiers
  const policyDecision = await policyClient.checkBilling('create_product', pricing.price);

  if (!policyDecision.allowed) {
    throw new Error(`Billing operation blocked: ${policyDecision.reason}`);
  }

  // Request approval for paid tiers
  if (policyDecision.requires_approval) {
    console.log(
      `Creating paid product ($${pricing.price}/month) requires approval. Requesting approval...`
    );

    try {
      const approval = await approvalClient.requestBillingApproval(
        'create_product',
        pricing.price,
        runId,
        7200 // 2 hours for billing review
      );

      // Wait for decision
      await approvalClient.waitForApproval(approval.action_id, 10); // Poll every 10 seconds

      console.log(`Billing approved, creating Stripe product...`);
    } catch (error) {
      throw new Error(`Billing approval failed: ${error.message}`);
    }
  }

  // Create product in Stripe
  return await createStripeProduct(productConfig);
}

/**
 * Example 3: Code Execution with Dynamic Approval
 */
export async function executeCodeWorkflow(
  commands: string[]
): Promise<CommandResult[]> {
  const runId = 'wf_' + Date.now().toString();
  const policyClient = new PolicyClient();
  const approvalClient = new ApprovalClient();

  const results: CommandResult[] = [];

  for (const command of commands) {
    console.log(`Checking policy for command: ${command}`);

    // Check if command is allowed
    const policyDecision = await policyClient.checkCodeExecution(command);

    if (!policyDecision.allowed) {
      console.error(`Command blocked: ${policyDecision.reason}`);
      results.push({
        stdout: '',
        stderr: `Blocked by policy: ${policyDecision.reason}`,
        exitCode: 1,
      });
      continue;
    }

    // If approval required (e.g., destructive command)
    if (policyDecision.requires_approval) {
      console.log(`Command requires approval: ${command}`);

      try {
        const approval = await approvalClient.requestCodeExecutionApproval(
          command,
          runId,
          1800 // 30 minutes for code review
        );

        await approvalClient.waitForApproval(approval.action_id, 5);

        console.log(`Command approved, executing...`);
      } catch (error) {
        console.error(`Command approval failed: ${error.message}`);
        results.push({
          stdout: '',
          stderr: `Approval failed: ${error.message}`,
          exitCode: 1,
        });
        continue;
      }
    }

    // Execute command
    const result = await executeCommand(command);
    results.push(result);
  }

  return results;
}

/**
 * Example 4: Async Approval Pattern (Non-blocking)
 *
 * For long-running workflows that can continue while waiting for approval.
 */
export async function asyncApprovalWorkflow(
  projectName: string
): Promise<void> {
  const runId = 'wf_' + Date.now().toString();
  const approvalClient = new ApprovalClient();

  // Phase 1: Do work that doesn't require approval
  console.log('Phase 1: Building and testing...');
  await executeCommand('npm run build');
  await executeCommand('npm run test');

  // Request approval but don't wait yet
  console.log('Requesting deployment approval...');
  const deploymentApproval = await approvalClient.requestDeploymentApproval(
    'vercel',
    { projectName, environment: 'production' },
    runId,
    7200 // 2 hours
  );

  // Phase 2: Do other work while approval is pending
  console.log('Phase 2: Preparing deployment assets...');
  await executeCommand('npm run build:assets');
  await executeCommand('npm run optimize:images');

  // Request billing approval
  console.log('Requesting billing setup approval...');
  const billingApproval = await approvalClient.requestBillingApproval(
    'create_subscription',
    29.99,
    runId,
    7200
  );

  // Phase 3: Now wait for approvals
  console.log('Waiting for approvals...');

  try {
    // Wait for both approvals in parallel
    await Promise.all([
      approvalClient.waitForApproval(deploymentApproval.action_id, 10),
      approvalClient.waitForApproval(billingApproval.action_id, 10),
    ]);

    console.log('All approvals granted, proceeding with deployment and billing...');

    // Execute approved actions
    await deployToVercel({ projectName, environment: 'production' });
    await createStripeProduct({
      name: `${projectName} - Pro`,
      price: 29.99,
      interval: 'month',
    });

    console.log('Workflow completed successfully!');
  } catch (error) {
    // One or more approvals failed
    console.error(`Approval failed: ${error.message}`);

    // Cancel any pending approvals
    await Promise.allSettled([
      approvalClient.cancelApproval(deploymentApproval.action_id, 'Workflow failed'),
      approvalClient.cancelApproval(billingApproval.action_id, 'Workflow failed'),
    ]);

    throw error;
  }
}

/**
 * Example 5: Conditional Approval Based on Budget
 */
export async function budgetAwareWorkflow(
  projectName: string,
  estimatedCost: number
): Promise<DeployResult> {
  const runId = 'wf_' + Date.now().toString();
  const policyClient = new PolicyClient();
  const approvalClient = new ApprovalClient();

  // Define cost threshold for automatic approval
  const AUTO_APPROVE_THRESHOLD = 10.0; // $10

  const deployConfig: DeployConfig = {
    projectName,
    environment: 'production',
  };

  // Check policy
  const policyDecision = await policyClient.checkDeployment('vercel', deployConfig);

  if (!policyDecision.allowed) {
    throw new Error(`Deployment blocked: ${policyDecision.reason}`);
  }

  // If cost is high OR policy requires approval, get human approval
  const needsApproval = policyDecision.requires_approval || estimatedCost > AUTO_APPROVE_THRESHOLD;

  if (needsApproval) {
    const approvalDescription =
      estimatedCost > AUTO_APPROVE_THRESHOLD
        ? `High cost deployment ($${estimatedCost}) exceeds auto-approve threshold`
        : 'Deployment requires policy approval';

    console.log(`Requesting approval: ${approvalDescription}`);

    const approval = await approvalClient.requestAndWait(
      {
        action_id: `deploy-${projectName}-${Date.now()}`,
        action_type: 'deploy',
        description: approvalDescription,
        context: {
          config: deployConfig,
          estimated_cost: estimatedCost,
          auto_approve_threshold: AUTO_APPROVE_THRESHOLD,
        },
        run_id: runId,
        timeout_seconds: 3600,
      },
      5
    );

    console.log(`Deployment approved: ${approval.decision_reason}`);
  } else {
    console.log(
      `Low cost deployment ($${estimatedCost}), proceeding without approval...`
    );
  }

  return await deployToVercel(deployConfig);
}

/**
 * Example 6: Approval with Retry Logic
 */
export async function approvalWithRetryWorkflow(
  projectName: string,
  maxRetries: number = 2
): Promise<DeployResult> {
  const runId = 'wf_' + Date.now().toString();
  const approvalClient = new ApprovalClient();

  const deployConfig: DeployConfig = {
    projectName,
    environment: 'production',
  };

  let retryCount = 0;
  let lastError: Error | null = null;

  while (retryCount <= maxRetries) {
    try {
      console.log(
        `Requesting deployment approval (attempt ${retryCount + 1}/${maxRetries + 1})...`
      );

      const approval = await approvalClient.requestAndWait(
        {
          action_id: `deploy-${projectName}-${Date.now()}-retry${retryCount}`,
          action_type: 'deploy',
          description: `Deploy ${projectName} to production${retryCount > 0 ? ` (retry ${retryCount})` : ''}`,
          context: {
            config: deployConfig,
            retry_count: retryCount,
            previous_error: lastError?.message,
          },
          run_id: runId,
          timeout_seconds: 3600,
        },
        5
      );

      console.log(`Approval granted on attempt ${retryCount + 1}`);
      return await deployToVercel(deployConfig);
    } catch (error) {
      lastError = error as Error;
      retryCount++;

      if (retryCount > maxRetries) {
        console.error(`Failed to get approval after ${maxRetries + 1} attempts`);
        throw new Error(
          `Deployment approval failed after ${maxRetries + 1} attempts: ${lastError.message}`
        );
      }

      console.log(`Approval failed, will retry (${maxRetries - retryCount + 1} attempts remaining)...`);

      // Wait before retry (exponential backoff)
      const backoffMs = Math.min(30000, 5000 * Math.pow(2, retryCount - 1));
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw new Error('Unexpected end of retry loop');
}
