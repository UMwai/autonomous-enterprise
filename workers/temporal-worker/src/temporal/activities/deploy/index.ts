/**
 * Deployment Temporal activities
 *
 * Activities for deploying to Vercel and Netlify via FastAPI endpoints.
 */

import { Context } from '@temporalio/activity';

// Configuration
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8000';

export interface VercelDeployConfig {
  project_id: string;
  repository_path: string;
  project_name: string;
  env_vars?: Record<string, string>;
  build_command?: string;
  output_directory?: string;
}

export interface NetlifyDeployConfig {
  project_id: string;
  repository_path: string;
  site_name: string;
  env_vars?: Record<string, string>;
  build_command?: string;
  publish_directory?: string;
}

export interface DeploymentResult {
  deployment_id: string;
  url: string;
  state: string;
  platform: string;
}

/**
 * Deploy to Vercel
 *
 * Calls the FastAPI /deploy/vercel endpoint to deploy a project.
 *
 * @param config - Vercel deployment configuration
 * @returns Deployment result with ID, URL, and state
 */
export async function deployToVercel(config: VercelDeployConfig): Promise<DeploymentResult> {
  const logger = Context.current().log;

  try {
    logger.info('Deploying to Vercel', {
      project_name: config.project_name,
      source_path: config.repository_path
    });

    const response = await fetch(`${API_BASE_URL}/api/v1/deploy/vercel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        project_name: config.project_name,
        source_path: config.repository_path,
        env_vars: config.env_vars || {},
        build_command: config.build_command,
        output_directory: config.output_directory,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Vercel deployment failed: ${response.status} - ${error}`);
    }

    const deployment = await response.json();

    logger.info('Vercel deployment created', {
      deployment_id: deployment.id,
      url: deployment.url,
      state: deployment.state,
    });

    return {
      deployment_id: deployment.id,
      url: deployment.url,
      state: deployment.state,
      platform: 'vercel',
    };
  } catch (error) {
    logger.error('Vercel deployment failed', { error });
    throw error;
  }
}

/**
 * Deploy to Netlify
 *
 * Calls the FastAPI /deploy/netlify endpoint to deploy a site.
 *
 * @param config - Netlify deployment configuration
 * @returns Deployment result with ID, URL, and state
 */
export async function deployToNetlify(config: NetlifyDeployConfig): Promise<DeploymentResult> {
  const logger = Context.current().log;

  try {
    logger.info('Deploying to Netlify', {
      site_name: config.site_name,
      source_path: config.repository_path
    });

    const response = await fetch(`${API_BASE_URL}/api/v1/deploy/netlify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        site_name: config.site_name,
        source_path: config.repository_path,
        env_vars: config.env_vars || {},
        build_command: config.build_command,
        publish_directory: config.publish_directory,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Netlify deployment failed: ${response.status} - ${error}`);
    }

    const deployment = await response.json();

    logger.info('Netlify deployment created', {
      deployment_id: deployment.id,
      url: deployment.url,
      state: deployment.state,
    });

    return {
      deployment_id: deployment.id,
      url: deployment.url,
      state: deployment.state,
      platform: 'netlify',
    };
  } catch (error) {
    logger.error('Netlify deployment failed', { error });
    throw error;
  }
}

/**
 * Get deployment status
 *
 * Retrieves the current status of a deployment.
 *
 * @param deployment_id - The deployment ID
 * @param platform - The platform ('vercel' or 'netlify')
 * @returns Current deployment status
 */
export async function getDeploymentStatus(
  deployment_id: string,
  platform: 'vercel' | 'netlify'
): Promise<DeploymentResult> {
  const logger = Context.current().log;

  try {
    logger.info('Getting deployment status', { deployment_id, platform });

    const response = await fetch(
      `${API_BASE_URL}/api/v1/deploy/${deployment_id}?platform=${platform}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get deployment status: ${response.status} - ${error}`);
    }

    const status = await response.json();

    logger.info('Deployment status retrieved', {
      deployment_id,
      state: status.state,
    });

    return status;
  } catch (error) {
    logger.error('Failed to get deployment status', { error, deployment_id });
    throw error;
  }
}

/**
 * Wait for deployment to complete
 *
 * Polls the deployment status until it reaches a terminal state.
 *
 * @param deployment_id - The deployment ID
 * @param platform - The platform ('vercel' or 'netlify')
 * @param timeout_seconds - Maximum time to wait (default: 600 seconds)
 * @param poll_interval_seconds - Polling interval (default: 5 seconds)
 * @returns Final deployment status
 */
export async function waitForDeployment(
  deployment_id: string,
  platform: 'vercel' | 'netlify',
  timeout_seconds: number = 600,
  poll_interval_seconds: number = 5
): Promise<DeploymentResult> {
  const logger = Context.current().log;
  const start_time = Date.now();
  const timeout_ms = timeout_seconds * 1000;
  const poll_interval_ms = poll_interval_seconds * 1000;

  logger.info('Waiting for deployment', {
    deployment_id,
    platform,
    timeout_seconds
  });

  while (true) {
    // Check timeout
    if (Date.now() - start_time > timeout_ms) {
      throw new Error(
        `Deployment ${deployment_id} did not complete within ${timeout_seconds} seconds`
      );
    }

    // Get current status
    const status = await getDeploymentStatus(deployment_id, platform);

    // Check for terminal states
    if (platform === 'vercel') {
      if (status.state === 'READY') {
        logger.info('Deployment completed successfully', { deployment_id });
        return status;
      }
      if (status.state === 'ERROR' || status.state === 'CANCELED') {
        throw new Error(`Deployment failed with state: ${status.state}`);
      }
    } else if (platform === 'netlify') {
      if (status.state === 'ready') {
        logger.info('Deployment completed successfully', { deployment_id });
        return status;
      }
      if (status.state === 'error') {
        throw new Error('Deployment failed with error state');
      }
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, poll_interval_ms));
  }
}

/**
 * Set environment variables for a Vercel project
 *
 * @param project_id - Vercel project ID
 * @param env_vars - Environment variables to set
 * @param target - Target environments (production, preview, development)
 */
export async function setVercelEnvVars(
  project_id: string,
  env_vars: Record<string, string>,
  target?: string[]
): Promise<void> {
  const logger = Context.current().log;

  try {
    logger.info('Setting Vercel environment variables', {
      project_id,
      count: Object.keys(env_vars).length
    });

    const response = await fetch(
      `${API_BASE_URL}/api/v1/deploy/vercel/${project_id}/env`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          env_vars,
          target,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to set Vercel env vars: ${response.status} - ${error}`);
    }

    logger.info('Vercel environment variables set successfully', { project_id });
  } catch (error) {
    logger.error('Failed to set Vercel env vars', { error, project_id });
    throw error;
  }
}

/**
 * Set environment variables for a Netlify site
 *
 * @param site_id - Netlify site ID
 * @param env_vars - Environment variables to set
 */
export async function setNetlifyEnvVars(
  site_id: string,
  env_vars: Record<string, string>
): Promise<void> {
  const logger = Context.current().log;

  try {
    logger.info('Setting Netlify environment variables', {
      site_id,
      count: Object.keys(env_vars).length
    });

    const response = await fetch(
      `${API_BASE_URL}/api/v1/deploy/netlify/${site_id}/env`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          env_vars,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to set Netlify env vars: ${response.status} - ${error}`);
    }

    logger.info('Netlify environment variables set successfully', { site_id });
  } catch (error) {
    logger.error('Failed to set Netlify env vars', { error, site_id });
    throw error;
  }
}
