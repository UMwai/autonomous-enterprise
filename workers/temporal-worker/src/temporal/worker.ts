/**
 * Temporal Worker Configuration and Registration
 *
 * Sets up the Temporal worker with all workflows and activities.
 */

import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities/index.js';

/**
 * Create and configure the Temporal worker
 */
export async function createWorker(): Promise<Worker> {
  // Get configuration from environment
  const temporalHost = process.env.TEMPORAL_HOST || 'localhost:7233';
  const namespace = process.env.TEMPORAL_NAMESPACE || 'default';
  const taskQueue = process.env.TEMPORAL_TASK_QUEUE || 'autonomous-enterprise';
  const maxConcurrentWorkflows = parseInt(
    process.env.MAX_CONCURRENT_WORKFLOWS || '10',
    10
  );
  const maxConcurrentActivities = parseInt(
    process.env.MAX_CONCURRENT_ACTIVITIES || '20',
    10
  );

  // Connect to Temporal server
  const connection = await NativeConnection.connect({
    address: temporalHost,
  });

  // Create worker with workflows and activities
  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath: new URL('./workflows/index.js', import.meta.url).pathname,
    activities,
    maxConcurrentWorkflowTaskExecutions: maxConcurrentWorkflows,
    maxConcurrentActivityTaskExecutions: maxConcurrentActivities,
    // Enable workflow and activity failure logging
    enableSDKTracing: process.env.NODE_ENV !== 'production',
    // Identity for tracking this worker
    identity: process.env.WORKER_IDENTITY || `worker-${process.pid}`,
  });

  return worker;
}
