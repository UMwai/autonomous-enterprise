/**
 * Build & Ship Workflow - Code Generation and Deployment
 *
 * Implements the product specification through:
 * 1. Git repository initialization
 * 2. LangGraph write-test-fix loop for code generation
 * 3. Automated testing and quality checks
 * 4. Deployment to hosting platform (Vercel/Netlify)
 */

import {
  proxyActivities,
  sleep,
  executeChild,
  defineQuery,
  setHandler,
  condition,
} from '@temporalio/workflow';
import type * as activities from '../activities/index.js';
import type { ProductSpecification, TaskGraph } from './genesis.js';

// Proxy activities with appropriate timeouts
const {
  initializeGitRepo,
  setupProjectScaffolding,
  deployToVercel,
  deployToNetlify,
  runTests,
  runLinter,
  createGitTag,
  pushToRemote,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '10s',
    backoffCoefficient: 2,
    maximumInterval: '2m',
  },
});

// LangGraph activities with longer timeout
const { runLangGraphLoop } = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 hours',
  heartbeatTimeout: '5 minutes',
  retry: {
    maximumAttempts: 2,
    initialInterval: '30s',
    backoffCoefficient: 2,
    maximumInterval: '5m',
  },
});

/**
 * Input for Build & Ship workflow
 */
export interface BuildWorkflowInput {
  /** Product specification from Genesis workflow */
  spec: ProductSpecification;
  /** Unique project identifier */
  project_id: string;
  /** Task graph for implementation guidance */
  task_graph?: TaskGraph;
  /** Whether to run tests before deployment */
  run_tests?: boolean;
  /** Whether to auto-deploy on success */
  auto_deploy?: boolean;
  /** Deployment target platform */
  deployment_target?: 'vercel' | 'netlify';
  /** Git repository URL (if existing) */
  git_repo_url?: string;
}

/**
 * Output from Build & Ship workflow
 */
export interface BuildWorkflowOutput {
  /** Project identifier */
  project_id: string;
  /** Git repository URL */
  repository_url: string;
  /** Deployment URL (if deployed) */
  deployment_url?: string;
  /** Build artifacts */
  artifacts: BuildArtifacts;
  /** Test results */
  test_results?: TestResults;
  /** Deployment metadata */
  deployment?: DeploymentMetadata;
  /** Workflow execution summary */
  summary: BuildSummary;
}

export interface BuildArtifacts {
  commit_sha: string;
  git_tag?: string;
  build_logs_url?: string;
  files_generated: number;
  lines_of_code: number;
}

export interface TestResults {
  total_tests: number;
  passed: number;
  failed: number;
  skipped: number;
  coverage_percentage?: number;
  test_duration_ms: number;
}

export interface DeploymentMetadata {
  platform: 'vercel' | 'netlify';
  deployment_id: string;
  deployment_url: string;
  deployed_at: string;
  status: 'success' | 'failed';
}

export interface BuildSummary {
  started_at: string;
  completed_at: string;
  total_duration_ms: number;
  langgraph_iterations: number;
  code_quality_score?: number;
  errors_encountered: number;
  warnings: string[];
}

/**
 * Progress tracking state
 */
interface BuildProgress {
  current_phase: string;
  progress_percentage: number;
  files_completed: number;
  total_files: number;
}

// Query for build progress
export const getProgressQuery = defineQuery<BuildProgress>('getProgress');

/**
 * Build & Ship Workflow
 *
 * Main workflow that orchestrates code generation, testing, and deployment.
 */
export async function buildAndShip(
  input: BuildWorkflowInput
): Promise<BuildWorkflowOutput> {
  const startTime = Date.now();
  const warnings: string[] = [];
  let errorsEncountered = 0;

  // Progress tracking state
  let progress: BuildProgress = {
    current_phase: 'initializing',
    progress_percentage: 0,
    files_completed: 0,
    total_files: 0,
  };

  // Set up progress query handler
  setHandler(getProgressQuery, () => progress);

  try {
    // Phase 1: Initialize Git repository
    progress.current_phase = 'git_init';
    progress.progress_percentage = 10;

    const repoUrl = input.git_repo_url || (await initializeGitRepo({
      project_id: input.project_id,
      project_name: input.spec.name,
    }));

    // Phase 2: Setup project scaffolding
    progress.current_phase = 'scaffolding';
    progress.progress_percentage = 20;

    await setupProjectScaffolding({
      project_id: input.project_id,
      tech_stack: input.spec.tech_stack,
      repository_path: `/tmp/${input.project_id}`,
    });

    // Phase 3: Run LangGraph write-test-fix loop
    progress.current_phase = 'code_generation';
    progress.progress_percentage = 30;

    const langGraphResult = await runLangGraphLoop({
      specification: input.spec,
      task_graph: input.task_graph,
      repository_path: `/tmp/${input.project_id}`,
      max_iterations: 10,
    });

    progress.files_completed = langGraphResult.files_generated;
    progress.total_files = langGraphResult.files_generated;
    progress.progress_percentage = 60;

    // Phase 4: Run linter and code quality checks
    progress.current_phase = 'quality_checks';
    progress.progress_percentage = 70;

    const lintResults = await runLinter({
      repository_path: `/tmp/${input.project_id}`,
    });

    if (lintResults.errors > 0) {
      warnings.push(`Linting found ${lintResults.errors} errors`);
      errorsEncountered += lintResults.errors;
    }

    // Phase 5: Run tests if requested
    let testResults: TestResults | undefined;

    if (input.run_tests !== false) {
      progress.current_phase = 'testing';
      progress.progress_percentage = 80;

      try {
        testResults = await runTests({
          repository_path: `/tmp/${input.project_id}`,
          test_command: 'npm test',
        });

        if (testResults.failed > 0) {
          warnings.push(`${testResults.failed} tests failed`);
          errorsEncountered += testResults.failed;
        }
      } catch (error) {
        warnings.push(`Test execution failed: ${error}`);
        errorsEncountered++;
        // Don't fail the workflow for test failures
      }
    }

    // Phase 6: Commit and tag
    progress.current_phase = 'committing';
    progress.progress_percentage = 85;

    const commitSha = await createGitTag({
      repository_path: `/tmp/${input.project_id}`,
      tag: 'v1.0.0',
      message: `Initial release of ${input.spec.name}`,
    });

    // Push to remote
    await pushToRemote({
      repository_path: `/tmp/${input.project_id}`,
      remote_url: repoUrl,
    });

    // Phase 7: Deploy if auto-deploy is enabled
    let deploymentMetadata: DeploymentMetadata | undefined;
    let deploymentUrl: string | undefined;

    if (input.auto_deploy !== false && errorsEncountered === 0) {
      progress.current_phase = 'deploying';
      progress.progress_percentage = 90;

      const target = input.deployment_target || 'vercel';

      try {
        if (target === 'vercel') {
          const vercelResult = await deployToVercel({
            project_id: input.project_id,
            repository_path: `/tmp/${input.project_id}`,
            project_name: input.spec.name,
          });

          deploymentMetadata = {
            platform: 'vercel',
            deployment_id: vercelResult.deployment_id,
            deployment_url: vercelResult.url,
            deployed_at: new Date().toISOString(),
            status: 'success',
          };
          deploymentUrl = vercelResult.url;
        } else {
          const netlifyResult = await deployToNetlify({
            project_id: input.project_id,
            repository_path: `/tmp/${input.project_id}`,
            site_name: input.spec.name,
          });

          deploymentMetadata = {
            platform: 'netlify',
            deployment_id: netlifyResult.deployment_id,
            deployment_url: netlifyResult.url,
            deployed_at: new Date().toISOString(),
            status: 'success',
          };
          deploymentUrl = netlifyResult.url;
        }
      } catch (error) {
        warnings.push(`Deployment failed: ${error}`);
        errorsEncountered++;
      }
    }

    // Phase 8: Complete
    progress.current_phase = 'completed';
    progress.progress_percentage = 100;

    const endTime = Date.now();

    return {
      project_id: input.project_id,
      repository_url: repoUrl,
      deployment_url: deploymentUrl,
      artifacts: {
        commit_sha: commitSha,
        git_tag: 'v1.0.0',
        files_generated: langGraphResult.files_generated,
        lines_of_code: langGraphResult.lines_of_code,
      },
      test_results: testResults,
      deployment: deploymentMetadata,
      summary: {
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date(endTime).toISOString(),
        total_duration_ms: endTime - startTime,
        langgraph_iterations: langGraphResult.iterations,
        code_quality_score: lintResults.quality_score,
        errors_encountered: errorsEncountered,
        warnings,
      },
    };
  } catch (error) {
    // Mark as failed
    progress.current_phase = 'failed';

    throw error;
  }
}

/**
 * Signal handler for pausing/resuming build
 */
export async function buildAndShipWithControls(
  input: BuildWorkflowInput
): Promise<BuildWorkflowOutput> {
  let isPaused = false;
  let shouldCancel = false;

  // Signal handlers for workflow control
  const pauseSignal = defineSignal('pause');
  const resumeSignal = defineSignal('resume');
  const cancelSignal = defineSignal('cancel');

  setHandler(pauseSignal, () => {
    isPaused = true;
  });

  setHandler(resumeSignal, () => {
    isPaused = false;
  });

  setHandler(cancelSignal, () => {
    shouldCancel = true;
  });

  // Check for pause/cancel before each phase
  async function checkControls() {
    if (shouldCancel) {
      throw new Error('Build cancelled by user');
    }

    // Wait while paused
    await condition(() => !isPaused);
  }

  // Run the build workflow with control checks
  // (This is a simplified version - full implementation would integrate checkControls throughout)
  return buildAndShip(input);
}

/**
 * Helper to define a signal
 */
function defineSignal(name: string) {
  return name;
}
