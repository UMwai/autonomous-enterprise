/**
 * PR Autopilot Activities
 *
 * Temporal activities for executing PR review agents and interacting
 * with GitHub and security databases.
 */

import pino from 'pino';
import { AgentType } from '../../../agents/prAutopilot/definitions.js';
import {
  AgentResponse,
  Finding,
  Severity,
  FindingType,
} from '../../../agents/prAutopilot/protocol.js';
import {
  PRContext,
  get_pr_diff,
  get_changed_files,
  post_pr_comment,
  batchCheckCVE,
} from '../../../agents/prAutopilot/tools.js';

const logger = pino();

/**
 * Get PR context information
 */
export async function getPRContext(params: {
  owner: string;
  repo: string;
  pull_number: number;
}): Promise<PRContext> {
  logger.info({ params }, 'Fetching PR context');

  // In production, fetch PR details from GitHub API
  // For now, return basic context
  return {
    owner: params.owner,
    repo: params.repo,
    pull_number: params.pull_number,
  };
}

/**
 * Run a PR review agent
 */
export async function runPRAgent(params: {
  agent_type: AgentType;
  pr_context: PRContext;
  previous_responses: AgentResponse[];
  budget_remaining: number;
}): Promise<AgentResponse> {
  const startTime = Date.now();

  logger.info(
    { agent: params.agent_type, iteration: params.previous_responses.length + 1 },
    'Running PR agent'
  );

  try {
    // Build context from previous responses
    const previousFindings = params.previous_responses.flatMap(r => r.findings);

    // Execute agent based on type
    let response: AgentResponse;

    switch (params.agent_type) {
      case AgentType.COORDINATOR:
        response = await executeCoordinator(
          params.pr_context,
          previousFindings
        );
        break;

      case AgentType.SECURITY:
        response = await executeSecurity(params.pr_context);
        break;

      case AgentType.GITHUB:
        response = await executeGitHub(params.pr_context, previousFindings);
        break;

      case AgentType.STYLE:
        response = await executeStyle(params.pr_context);
        break;

      default:
        const exhaustive: never = params.agent_type;
        throw new Error(`Unknown agent type: ${exhaustive}`);
    }

    const duration = Date.now() - startTime;
    response.duration = duration;
    response.agent = params.agent_type;

    logger.info(
      {
        agent: params.agent_type,
        success: response.success,
        findings: response.findings.length,
        next_agent: response.next_agent,
      },
      'Agent execution completed'
    );

    return response;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);

    logger.error({ agent: params.agent_type, error: errorMsg }, 'Agent execution failed');

    return {
      agent: params.agent_type,
      success: false,
      summary: `Agent failed: ${errorMsg}`,
      findings: [],
      next_agent: null,
      tools_used: [],
      tokens_used: 0,
      cost: 0,
      duration,
      error: errorMsg,
    };
  }
}

/**
 * Execute Coordinator agent
 */
async function executeCoordinator(
  prContext: PRContext,
  previousFindings: Finding[]
): Promise<AgentResponse> {
  logger.info('Executing Coordinator agent');

  // Get changed files to determine routing
  const filesResult = await get_changed_files(prContext);
  if (!filesResult.success || !filesResult.data) {
    throw new Error(`Failed to get changed files: ${filesResult.error}`);
  }

  const changedFiles = filesResult.data;
  const filenames = changedFiles.map(f => f.filename);

  // Determine which agents to invoke
  let nextAgent: AgentType | null = null;
  let handoffReason = '';

  // Check if we've already run all necessary agents
  const hasSecurityFiles = filenames.some(f =>
    f.includes('package.json') ||
    f.includes('package-lock.json') ||
    f.includes('requirements.txt') ||
    f.includes('go.mod')
  );

  const hasSecurityFindings = previousFindings.some(
    f => f.type === FindingType.CVE || f.type === FindingType.SECRET
  );
  const hasCodeReview = previousFindings.some(
    f => f.type === FindingType.BUG || f.type === FindingType.ARCHITECTURE
  );

  // Routing logic
  if (hasSecurityFiles && !hasSecurityFindings) {
    nextAgent = AgentType.SECURITY;
    handoffReason = 'PR modifies dependency files - need security scan';
  } else if (changedFiles.length > 0 && !hasCodeReview) {
    nextAgent = AgentType.GITHUB;
    handoffReason = 'PR has code changes - need detailed review';
  } else {
    // All agents completed
    nextAgent = null;
    handoffReason = 'All specialist reviews completed';
  }

  return {
    agent: AgentType.COORDINATOR,
    success: true,
    summary: `Coordinator analyzed PR with ${changedFiles.length} changed files. ${handoffReason}`,
    findings: [],
    next_agent: nextAgent,
    handoff_reason: handoffReason,
    tools_used: ['get_changed_files'],
    tokens_used: 500, // Estimated
    cost: 0.01, // Tier 2 model
    duration: 0, // Set by caller
  };
}

/**
 * Execute Security agent
 */
async function executeSecurity(prContext: PRContext): Promise<AgentResponse> {
  logger.info('Executing Security agent');

  const toolsUsed: string[] = [];
  const findings: Finding[] = [];

  // Get changed files
  const filesResult = await get_changed_files(prContext);
  if (!filesResult.success || !filesResult.data) {
    throw new Error(`Failed to get changed files: ${filesResult.error}`);
  }
  toolsUsed.push('get_changed_files');

  const changedFiles = filesResult.data;

  // Check for dependency files
  const dependencyFiles = changedFiles.filter(f =>
    f.filename === 'package.json' ||
    f.filename === 'package-lock.json' ||
    f.filename === 'requirements.txt' ||
    f.filename === 'go.mod'
  );

  if (dependencyFiles.length === 0) {
    return {
      agent: AgentType.SECURITY,
      success: true,
      summary: 'No dependency files changed - no CVE scan needed',
      findings: [],
      next_agent: AgentType.COORDINATOR,
      handoff_reason: 'Security scan complete - no dependencies changed',
      tools_used: toolsUsed,
      tokens_used: 800,
      cost: 0.02, // Tier 1 model
      duration: 0,
    };
  }

  // Get PR diff to extract new/updated dependencies
  const diffResult = await get_pr_diff(prContext);
  if (!diffResult.success || !diffResult.data) {
    throw new Error(`Failed to get PR diff: ${diffResult.error}`);
  }
  toolsUsed.push('get_pr_diff');

  // Parse dependency files from diff
  // In production, we'd parse the actual file content
  // For now, simulate CVE check
  const mockDependencies = [
    { name: 'axios', version: '0.21.1', ecosystem: 'npm' as const },
    { name: 'lodash', version: '4.17.20', ecosystem: 'npm' as const },
  ];

  // Batch CVE check
  const cveResult = await batchCheckCVE(mockDependencies);
  toolsUsed.push('check_cve_database');

  if (cveResult.success && cveResult.data) {
    for (const vuln of cveResult.data) {
      findings.push({
        type: FindingType.CVE,
        severity:
          vuln.severity === 'CRITICAL' || vuln.severity === 'HIGH'
            ? Severity.HIGH
            : vuln.severity === 'MEDIUM'
            ? Severity.MEDIUM
            : Severity.LOW,
        file: 'package.json',
        message: `${vuln.package_name}@${vuln.affected_versions} has known vulnerability: ${vuln.cve_id}`,
        recommendation: vuln.fixed_version
          ? `Update to ${vuln.package_name}@${vuln.fixed_version}`
          : `Review and patch ${vuln.package_name}`,
        cve_id: vuln.cve_id,
      });
    }
  }

  // Check for exposed secrets in diff
  const secretPatterns = [
    { pattern: /AKIA[0-9A-Z]{16}/, type: 'AWS Access Key' },
    { pattern: /sk_live_[0-9a-zA-Z]{24,}/, type: 'Stripe Secret Key' },
    { pattern: /ghp_[0-9a-zA-Z]{36}/, type: 'GitHub Personal Access Token' },
  ];

  const diffLines = diffResult.data.split('\n');
  for (let i = 0; i < diffLines.length; i++) {
    const line = diffLines[i];
    if (!line.startsWith('+')) continue; // Only check added lines

    for (const { pattern, type } of secretPatterns) {
      if (pattern.test(line)) {
        findings.push({
          type: FindingType.SECRET,
          severity: Severity.HIGH,
          file: 'unknown', // Would extract from diff
          line: i + 1,
          message: `Potential ${type} detected in commit`,
          recommendation: 'Remove secret and rotate credentials immediately',
        });
      }
    }
  }

  return {
    agent: AgentType.SECURITY,
    success: true,
    summary: `Security scan complete. Found ${findings.length} issues (${findings.filter(f => f.severity === Severity.HIGH).length} high severity)`,
    findings,
    next_agent: AgentType.COORDINATOR,
    handoff_reason: 'Security analysis complete',
    tools_used: toolsUsed,
    tokens_used: 2000,
    cost: 0.05, // Tier 1 model
    duration: 0,
  };
}

/**
 * Execute GitHub review agent
 */
async function executeGitHub(
  prContext: PRContext,
  previousFindings: Finding[]
): Promise<AgentResponse> {
  logger.info('Executing GitHub review agent');

  const toolsUsed: string[] = [];
  const findings: Finding[] = [];

  // Get PR diff
  const diffResult = await get_pr_diff(prContext);
  if (!diffResult.success || !diffResult.data) {
    throw new Error(`Failed to get PR diff: ${diffResult.error}`);
  }
  toolsUsed.push('get_pr_diff');

  // Get changed files
  const filesResult = await get_changed_files(prContext);
  if (!filesResult.success || !filesResult.data) {
    throw new Error(`Failed to get changed files: ${filesResult.error}`);
  }
  toolsUsed.push('get_changed_files');

  const changedFiles = filesResult.data;

  // Simulate code review analysis
  // In production, this would use LLM to analyze code changes

  // Example: Check for missing tests
  const hasTestChanges = changedFiles.some(f =>
    f.filename.includes('test') || f.filename.includes('spec')
  );
  const hasCodeChanges = changedFiles.some(f =>
    !f.filename.includes('test') && !f.filename.includes('spec') && f.status !== 'removed'
  );

  if (hasCodeChanges && !hasTestChanges) {
    findings.push({
      type: FindingType.EDGE_CASE,
      severity: Severity.MEDIUM,
      file: 'tests/',
      message: 'No test files modified - new code may lack test coverage',
      recommendation: 'Add tests for new functionality',
    });
  }

  // Check for large files
  for (const file of changedFiles) {
    if (file.additions > 500) {
      findings.push({
        type: FindingType.ARCHITECTURE,
        severity: Severity.LOW,
        file: file.filename,
        message: `Large file change (${file.additions} additions) - consider splitting`,
        recommendation: 'Break down into smaller, focused changes',
      });
    }
  }

  // Post review comment
  const reviewBody = formatReviewComment(findings, previousFindings);
  await post_pr_comment(prContext, reviewBody);
  toolsUsed.push('post_pr_comment');

  return {
    agent: AgentType.GITHUB,
    success: true,
    summary: `Code review complete. Found ${findings.length} issues. Posted review comment.`,
    findings,
    next_agent: AgentType.COORDINATOR,
    handoff_reason: 'Code review complete',
    tools_used: toolsUsed,
    tokens_used: 1500,
    cost: 0.03, // Tier 2 model
    duration: 0,
  };
}

/**
 * Execute Style agent
 */
async function executeStyle(prContext: PRContext): Promise<AgentResponse> {
  logger.info('Executing Style agent');

  const toolsUsed: string[] = [];
  const findings: Finding[] = [];

  // Get changed files
  const filesResult = await get_changed_files(prContext);
  if (!filesResult.success || !filesResult.data) {
    throw new Error(`Failed to get changed files: ${filesResult.error}`);
  }
  toolsUsed.push('get_changed_files');

  // Get PR diff
  const diffResult = await get_pr_diff(prContext);
  if (!diffResult.success || !diffResult.data) {
    throw new Error(`Failed to get PR diff: ${diffResult.error}`);
  }
  toolsUsed.push('get_pr_diff');

  // Simulate style checks
  // In production, this would run linters or use LLM for style analysis

  const changedFiles = filesResult.data;

  // Example: Check for inconsistent naming
  for (const file of changedFiles) {
    if (file.filename.includes('_') && file.filename.endsWith('.ts')) {
      findings.push({
        type: FindingType.NAMING,
        severity: Severity.LOW,
        file: file.filename,
        message: 'TypeScript file uses snake_case - prefer kebab-case',
        recommendation: `Rename to ${file.filename.replace(/_/g, '-')}`,
        auto_fixable: true,
      });
    }
  }

  return {
    agent: AgentType.STYLE,
    success: true,
    summary: `Style check complete. Found ${findings.length} style issues.`,
    findings,
    next_agent: AgentType.COORDINATOR,
    handoff_reason: 'Style analysis complete',
    tools_used: toolsUsed,
    tokens_used: 600,
    cost: 0.01, // Tier 3 model
    duration: 0,
  };
}

/**
 * Format review comment from findings
 */
function formatReviewComment(
  currentFindings: Finding[],
  previousFindings: Finding[]
): string {
  const allFindings = [...currentFindings, ...previousFindings];

  const high = allFindings.filter(f => f.severity === Severity.HIGH);
  const medium = allFindings.filter(f => f.severity === Severity.MEDIUM);
  const low = allFindings.filter(f => f.severity === Severity.LOW);

  let comment = '## Code Review\n\n';

  if (high.length > 0) {
    comment += '### 🔴 High Priority Issues\n\n';
    for (const finding of high) {
      comment += `- **${finding.file}${finding.line ? `:${finding.line}` : ''}**: ${finding.message}\n`;
      comment += `  - Recommendation: ${finding.recommendation}\n\n`;
    }
  }

  if (medium.length > 0) {
    comment += '### 🟡 Medium Priority Issues\n\n';
    for (const finding of medium) {
      comment += `- **${finding.file}${finding.line ? `:${finding.line}` : ''}**: ${finding.message}\n`;
      comment += `  - Recommendation: ${finding.recommendation}\n\n`;
    }
  }

  if (low.length > 0) {
    comment += '### 🔵 Suggestions\n\n';
    for (const finding of low) {
      comment += `- **${finding.file}**: ${finding.message}\n`;
    }
  }

  if (allFindings.length === 0) {
    comment += '✅ No issues found. Code looks good!\n';
  }

  return comment;
}

/**
 * Post final review to PR
 */
export async function postFinalReview(params: {
  pr_context: PRContext;
  findings: Finding[];
  review_status: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  summary: string;
}): Promise<void> {
  logger.info({ pr: params.pr_context.pull_number }, 'Posting final review');

  // Build final review comment
  const reviewBody = `${params.summary}\n\n${formatReviewComment(params.findings, [])}`;

  // Post comment
  await post_pr_comment(params.pr_context, reviewBody);

  logger.info('Final review posted successfully');
}

/**
 * Track agent cost for billing
 */
export async function trackAgentCost(params: {
  agent_type: AgentType;
  cost: number;
  tokens: number;
}): Promise<void> {
  logger.info({ agent: params.agent_type, cost: params.cost }, 'Tracking agent cost');

  // In production, this would update cost tracking in database
  // For now, just log it
}
