/**
 * PR Autopilot Tool Definitions
 *
 * Tools available to PR review agents for interacting with
 * GitHub PRs and security databases.
 */

import { Octokit } from '@octokit/rest';
import pino from 'pino';

const logger = pino();

/**
 * GitHub PR context
 */
export interface PRContext {
  owner: string;
  repo: string;
  pull_number: number;
  base_sha?: string;
  head_sha?: string;
}

/**
 * File change information
 */
export interface FileChange {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

/**
 * CVE vulnerability information
 */
export interface CVEVulnerability {
  cve_id: string;
  package_name: string;
  affected_versions: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  fixed_version?: string;
  references: string[];
}

/**
 * Tool execution result
 */
export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  duration: number;
}

/**
 * Initialize GitHub client
 */
function getGitHubClient(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN environment variable is required');
  }

  return new Octokit({ auth: token });
}

/**
 * Get PR diff for all changed files
 */
export async function get_pr_diff(context: PRContext): Promise<ToolResult<string>> {
  const startTime = Date.now();

  try {
    logger.info({ context }, 'Fetching PR diff');

    const octokit = getGitHubClient();

    // Fetch PR details
    const { data: pr } = await octokit.pulls.get({
      owner: context.owner,
      repo: context.repo,
      pull_number: context.pull_number,
      mediaType: {
        format: 'diff',
      },
    });

    const duration = Date.now() - startTime;

    logger.info({ context, size: pr.length }, 'PR diff fetched successfully');

    return {
      success: true,
      data: pr as unknown as string,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);

    logger.error({ context, error: errorMsg }, 'Failed to fetch PR diff');

    return {
      success: false,
      error: errorMsg,
      duration,
    };
  }
}

/**
 * Get list of changed files in PR
 */
export async function get_changed_files(
  context: PRContext
): Promise<ToolResult<FileChange[]>> {
  const startTime = Date.now();

  try {
    logger.info({ context }, 'Fetching changed files');

    const octokit = getGitHubClient();

    // Fetch files changed in PR
    const { data: files } = await octokit.pulls.listFiles({
      owner: context.owner,
      repo: context.repo,
      pull_number: context.pull_number,
      per_page: 100,
    });

    const changes: FileChange[] = files.map(file => ({
      filename: file.filename,
      status: file.status as 'added' | 'modified' | 'removed' | 'renamed',
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch,
    }));

    const duration = Date.now() - startTime;

    logger.info(
      { context, file_count: changes.length },
      'Changed files fetched successfully'
    );

    return {
      success: true,
      data: changes,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);

    logger.error({ context, error: errorMsg }, 'Failed to fetch changed files');

    return {
      success: false,
      error: errorMsg,
      duration,
    };
  }
}

/**
 * Post a comment on the PR
 */
export async function post_pr_comment(
  context: PRContext,
  body: string,
  line?: number,
  path?: string
): Promise<ToolResult<void>> {
  const startTime = Date.now();

  try {
    logger.info({ context, has_line: !!line, has_path: !!path }, 'Posting PR comment');

    const octokit = getGitHubClient();

    if (line && path && context.head_sha) {
      // Post review comment on specific line
      await octokit.pulls.createReviewComment({
        owner: context.owner,
        repo: context.repo,
        pull_number: context.pull_number,
        body,
        commit_id: context.head_sha,
        path,
        line,
      });
    } else {
      // Post general comment on PR
      await octokit.issues.createComment({
        owner: context.owner,
        repo: context.repo,
        issue_number: context.pull_number,
        body,
      });
    }

    const duration = Date.now() - startTime;

    logger.info({ context }, 'PR comment posted successfully');

    return {
      success: true,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);

    logger.error({ context, error: errorMsg }, 'Failed to post PR comment');

    return {
      success: false,
      error: errorMsg,
      duration,
    };
  }
}

/**
 * Check CVE database for vulnerabilities
 *
 * Integrates with OSV (Open Source Vulnerabilities) database
 */
export async function check_cve_database(
  packageName: string,
  version: string,
  ecosystem: 'npm' | 'PyPI' | 'Go' | 'Maven' = 'npm'
): Promise<ToolResult<CVEVulnerability[]>> {
  const startTime = Date.now();

  try {
    logger.info({ packageName, version, ecosystem }, 'Checking CVE database');

    // Query OSV API
    const response = await fetch('https://api.osv.dev/v1/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version,
        package: {
          name: packageName,
          ecosystem,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`OSV API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { vulns?: unknown[] };
    const vulnerabilities: CVEVulnerability[] = [];

    if (data.vulns && Array.isArray(data.vulns)) {
      for (const vulnData of data.vulns) {
        // Type assertion for the vulnerability object from OSV API
        const vuln = vulnData as {
          id?: string;
          severity?: Array<{ type?: string }>;
          database_specific?: { severity?: string };
          affected?: Array<{
            ranges?: Array<{
              events?: Array<{ introduced?: string; fixed?: string }>;
            }>;
          }>;
          summary?: string;
          details?: string;
          references?: Array<{ url: string }>;
        };

        // Extract severity from database_specific or severity field
        let severity: CVEVulnerability['severity'] = 'MEDIUM';
        if (vuln.severity && vuln.severity[0]?.type) {
          severity = vuln.severity[0].type as CVEVulnerability['severity'];
        } else if (vuln.database_specific?.severity) {
          severity = vuln.database_specific.severity as CVEVulnerability['severity'];
        }

        // Find affected versions
        let affectedVersions = version;
        if (vuln.affected && vuln.affected[0]?.ranges) {
          affectedVersions = vuln.affected[0].ranges[0]?.events
            ?.map((e) => e.introduced || e.fixed)
            .filter(Boolean)
            .join(', ') || version;
        }

        // Find fixed version
        let fixedVersion: string | undefined;
        if (vuln.affected && vuln.affected[0]?.ranges) {
          const fixedEvent = vuln.affected[0].ranges[0]?.events?.find(
            (e) => e.fixed
          );
          fixedVersion = fixedEvent?.fixed;
        }

        vulnerabilities.push({
          cve_id: vuln.id || 'UNKNOWN',
          package_name: packageName,
          affected_versions: affectedVersions,
          severity,
          description: vuln.summary || vuln.details || 'No description available',
          fixed_version: fixedVersion,
          references: vuln.references?.map((r) => r.url) || [],
        });
      }
    }

    const duration = Date.now() - startTime;

    logger.info(
      { packageName, version, vuln_count: vulnerabilities.length },
      'CVE check completed'
    );

    return {
      success: true,
      data: vulnerabilities,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);

    logger.error({ packageName, version, error: errorMsg }, 'CVE check failed');

    return {
      success: false,
      error: errorMsg,
      duration,
    };
  }
}

/**
 * Parse dependency file and extract packages
 */
export function parseDependencyFile(
  filename: string,
  content: string
): Array<{ name: string; version: string; ecosystem: 'npm' | 'PyPI' | 'Go' }> {
  const dependencies: Array<{ name: string; version: string; ecosystem: 'npm' | 'PyPI' | 'Go' }> = [];

  try {
    if (filename === 'package.json') {
      const pkg = JSON.parse(content);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      for (const [name, version] of Object.entries(deps)) {
        if (typeof version === 'string') {
          // Remove semver prefix (^, ~, >=, etc.)
          const cleanVersion = version.replace(/^[\^~>=<]+/, '');
          dependencies.push({ name, version: cleanVersion, ecosystem: 'npm' });
        }
      }
    } else if (filename === 'requirements.txt') {
      const lines = content.split('\n');
      for (const line of lines) {
        const match = line.match(/^([a-zA-Z0-9_-]+)==([0-9.]+)/);
        if (match) {
          dependencies.push({ name: match[1], version: match[2], ecosystem: 'PyPI' });
        }
      }
    } else if (filename === 'go.mod') {
      const lines = content.split('\n');
      for (const line of lines) {
        const match = line.match(/^\s+([a-zA-Z0-9._/-]+)\s+v([0-9.]+)/);
        if (match) {
          dependencies.push({ name: match[1], version: match[2], ecosystem: 'Go' });
        }
      }
    }
  } catch (error) {
    logger.warn({ filename, error }, 'Failed to parse dependency file');
  }

  return dependencies;
}

/**
 * Batch CVE check for multiple dependencies
 */
export async function batchCheckCVE(
  dependencies: Array<{ name: string; version: string; ecosystem: 'npm' | 'PyPI' | 'Go' }>
): Promise<ToolResult<CVEVulnerability[]>> {
  const startTime = Date.now();
  const allVulnerabilities: CVEVulnerability[] = [];

  try {
    logger.info({ dep_count: dependencies.length }, 'Starting batch CVE check');

    // Check each dependency (with rate limiting)
    for (const dep of dependencies) {
      const result = await check_cve_database(dep.name, dep.version, dep.ecosystem);

      if (result.success && result.data) {
        allVulnerabilities.push(...result.data);
      }

      // Rate limiting - 100ms between requests
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const duration = Date.now() - startTime;

    logger.info(
      { total_vulns: allVulnerabilities.length, duration },
      'Batch CVE check completed'
    );

    return {
      success: true,
      data: allVulnerabilities,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);

    logger.error({ error: errorMsg }, 'Batch CVE check failed');

    return {
      success: false,
      error: errorMsg,
      duration,
    };
  }
}
