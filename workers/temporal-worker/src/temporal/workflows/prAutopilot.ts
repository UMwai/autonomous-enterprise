/**
 * PR Autopilot Workflow
 *
 * Temporal workflow that orchestrates the Coordinator-Worker pattern
 * for autonomous PR review using multiple specialist agents.
 */

import { proxyActivities, sleep } from '@temporalio/workflow';
import type * as activities from '../activities/index.js';
import { AgentType } from '../../agents/prAutopilot/definitions.js';
import { AgentResponse, Finding, Severity } from '../../agents/prAutopilot/protocol.js';

// Proxy activities with appropriate timeouts
const {
  runPRAgent,
  getPRContext,
  postFinalReview,
  trackAgentCost,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '2s',
    backoffCoefficient: 2,
    maximumInterval: '30s',
  },
});

/**
 * Input for PR Autopilot workflow
 */
export interface PRAutopilotInput {
  /** GitHub repository owner */
  owner: string;

  /** GitHub repository name */
  repo: string;

  /** Pull request number */
  pull_number: number;

  /** Budget limit for the review ($) */
  budget_limit?: number;

  /** Maximum iterations to prevent infinite loops */
  max_iterations?: number;

  /** Optional: specific agents to run (default: all) */
  agents_to_run?: AgentType[];

  /** Optional: skip style checks */
  skip_style?: boolean;
}

/**
 * Output from PR Autopilot workflow
 */
export interface PRAutopilotOutput {
  /** PR review completed successfully */
  success: boolean;

  /** Overall review status */
  review_status: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

  /** All findings from agents */
  findings: Finding[];

  /** Summary of findings by severity */
  summary: {
    high_severity: number;
    medium_severity: number;
    low_severity: number;
    info: number;
  };

  /** Agents that ran */
  agents_executed: AgentType[];

  /** Total cost incurred */
  total_cost: number;

  /** Total tokens used */
  total_tokens: number;

  /** Execution metadata */
  metadata: {
    started_at: string;
    completed_at: string;
    duration_ms: number;
    iterations: number;
  };

  /** Error message if failed */
  error?: string;
}

/**
 * PR Autopilot State - tracks workflow execution
 */
interface PRAutopilotState {
  /** Current agent executing */
  current_agent: AgentType;

  /** Agent execution history */
  agent_history: AgentType[];

  /** Responses from all agents */
  agent_responses: AgentResponse[];

  /** Accumulated findings */
  findings: Finding[];

  /** Total cost so far */
  cost_incurred: number;

  /** Total tokens used */
  tokens_used: number;

  /** Iteration count */
  iteration: number;

  /** Whether review is complete */
  completed: boolean;

  /** Completion reason */
  completion_reason?: string;
}

/**
 * PR Autopilot Workflow
 *
 * Orchestrates the coordinator-worker handoff pattern:
 * 1. Start with Coordinator agent
 * 2. Coordinator analyzes PR and routes to specialists
 * 3. Specialists execute and hand back to Coordinator
 * 4. Coordinator synthesizes findings and posts review
 */
export async function prAutopilot(
  input: PRAutopilotInput
): Promise<PRAutopilotOutput> {
  const startTime = Date.now();
  const budgetLimit = input.budget_limit || 5.0; // Default $5 budget
  const maxIterations = input.max_iterations || 15; // Prevent infinite loops

  // Initialize state
  const state: PRAutopilotState = {
    current_agent: AgentType.COORDINATOR,
    agent_history: [],
    agent_responses: [],
    findings: [],
    cost_incurred: 0,
    tokens_used: 0,
    iteration: 0,
    completed: false,
  };

  // Fetch PR context
  const prContext = await getPRContext({
    owner: input.owner,
    repo: input.repo,
    pull_number: input.pull_number,
  });

  try {
    // Main agent execution loop
    while (!state.completed && state.iteration < maxIterations) {
      state.iteration++;

      // Check budget
      if (state.cost_incurred >= budgetLimit) {
        state.completed = true;
        state.completion_reason = `Budget limit exceeded ($${budgetLimit})`;
        break;
      }

      // Execute current agent
      const agentResponse = await runPRAgent({
        agent_type: state.current_agent,
        pr_context: prContext,
        previous_responses: state.agent_responses,
        budget_remaining: budgetLimit - state.cost_incurred,
      });

      // Track response
      state.agent_responses.push(agentResponse);
      state.agent_history.push(state.current_agent);

      // Update cost and token tracking
      state.cost_incurred += agentResponse.cost;
      state.tokens_used += agentResponse.tokens_used;

      await trackAgentCost({
        agent_type: state.current_agent,
        cost: agentResponse.cost,
        tokens: agentResponse.tokens_used,
      });

      // Merge findings
      if (agentResponse.success && agentResponse.findings.length > 0) {
        state.findings.push(...agentResponse.findings);
      }

      // Check for handoff
      if (agentResponse.next_agent) {
        // Validate handoff target
        if (!isValidHandoff(state.current_agent, agentResponse.next_agent)) {
          state.completed = true;
          state.completion_reason = `Invalid handoff from ${state.current_agent} to ${agentResponse.next_agent}`;
          break;
        }

        // Check for infinite loop (same agent sequence repeating)
        if (detectLoop(state.agent_history, agentResponse.next_agent)) {
          state.completed = true;
          state.completion_reason = 'Agent handoff loop detected';
          break;
        }

        // Hand off to next agent
        state.current_agent = agentResponse.next_agent;

        // Small delay between agents
        await sleep('500ms');
      } else {
        // No handoff = workflow complete
        state.completed = true;
        state.completion_reason = 'All agents completed';
      }
    }

    // Check if max iterations reached
    if (state.iteration >= maxIterations && !state.completed) {
      state.completed = true;
      state.completion_reason = `Max iterations (${maxIterations}) reached`;
    }

    // Calculate review status
    const reviewStatus = calculateReviewStatus(state.findings);

    // Post final review to GitHub
    await postFinalReview({
      pr_context: prContext,
      findings: state.findings,
      review_status: reviewStatus.status,
      summary: formatReviewSummary(state),
    });

    const endTime = Date.now();

    return {
      success: true,
      review_status: reviewStatus.status,
      findings: state.findings,
      summary: {
        high_severity: state.findings.filter(f => f.severity === Severity.HIGH).length,
        medium_severity: state.findings.filter(f => f.severity === Severity.MEDIUM).length,
        low_severity: state.findings.filter(f => f.severity === Severity.LOW).length,
        info: state.findings.filter(f => f.severity === Severity.INFO).length,
      },
      agents_executed: [...new Set(state.agent_history)], // Unique agents
      total_cost: state.cost_incurred,
      total_tokens: state.tokens_used,
      metadata: {
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date(endTime).toISOString(),
        duration_ms: endTime - startTime,
        iterations: state.iteration,
      },
    };
  } catch (error) {
    // Handle workflow errors
    const errorMsg = error instanceof Error ? error.message : String(error);
    const endTime = Date.now();

    return {
      success: false,
      review_status: 'COMMENT',
      findings: state.findings,
      summary: {
        high_severity: 0,
        medium_severity: 0,
        low_severity: 0,
        info: 0,
      },
      agents_executed: state.agent_history,
      total_cost: state.cost_incurred,
      total_tokens: state.tokens_used,
      metadata: {
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date(endTime).toISOString(),
        duration_ms: endTime - startTime,
        iterations: state.iteration,
      },
      error: errorMsg,
    };
  }
}

/**
 * Validate that a handoff is allowed
 */
function isValidHandoff(from: AgentType, to: AgentType): boolean {
  // Coordinator can hand off to any specialist
  if (from === AgentType.COORDINATOR) {
    return to === AgentType.SECURITY || to === AgentType.GITHUB || to === AgentType.STYLE;
  }

  // Specialists can only hand off back to Coordinator
  if (from === AgentType.SECURITY || from === AgentType.GITHUB || from === AgentType.STYLE) {
    return to === AgentType.COORDINATOR;
  }

  return false;
}

/**
 * Detect infinite handoff loops
 */
function detectLoop(history: AgentType[], nextAgent: AgentType): boolean {
  if (history.length < 6) return false; // Need at least 6 to detect loop

  // Check if the last 4 transitions match a pattern
  const recentHistory = [...history.slice(-4), nextAgent];

  // Pattern: A -> B -> A -> B -> A (loop of length 2)
  if (recentHistory.length >= 5) {
    const pattern = recentHistory.slice(-2);
    const prevPattern = recentHistory.slice(-4, -2);
    if (pattern[0] === prevPattern[0] && pattern[1] === prevPattern[1]) {
      return true;
    }
  }

  return false;
}

/**
 * Calculate overall review status from findings
 */
function calculateReviewStatus(findings: Finding[]): {
  status: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  blocking_count: number;
} {
  const highSeverity = findings.filter(f => f.severity === Severity.HIGH);
  const mediumSeverity = findings.filter(f => f.severity === Severity.MEDIUM);

  // HIGH severity findings block merge
  if (highSeverity.length > 0) {
    return {
      status: 'REQUEST_CHANGES',
      blocking_count: highSeverity.length,
    };
  }

  // MEDIUM severity findings request changes
  if (mediumSeverity.length > 0) {
    return {
      status: 'REQUEST_CHANGES',
      blocking_count: 0,
    };
  }

  // Only LOW/INFO findings - approve with comments
  if (findings.length > 0) {
    return {
      status: 'COMMENT',
      blocking_count: 0,
    };
  }

  // No findings - approve
  return {
    status: 'APPROVE',
    blocking_count: 0,
  };
}

/**
 * Format review summary for GitHub comment
 */
function formatReviewSummary(state: PRAutopilotState): string {
  const findingsBySeverity = {
    high: state.findings.filter(f => f.severity === Severity.HIGH).length,
    medium: state.findings.filter(f => f.severity === Severity.MEDIUM).length,
    low: state.findings.filter(f => f.severity === Severity.LOW).length,
    info: state.findings.filter(f => f.severity === Severity.INFO).length,
  };

  const agentsSummary = state.agent_history
    .filter((agent, idx, arr) => arr.indexOf(agent) === idx) // Unique
    .map(agent => `- ${agent}`)
    .join('\n');

  return `
## PR Autopilot Review

**Status**: ${state.completion_reason || 'Completed'}

**Findings Summary**:
- 🔴 High: ${findingsBySeverity.high}
- 🟡 Medium: ${findingsBySeverity.medium}
- 🔵 Low: ${findingsBySeverity.low}
- ℹ️ Info: ${findingsBySeverity.info}

**Agents Executed**:
${agentsSummary}

**Execution Stats**:
- Iterations: ${state.iteration}
- Total Cost: $${state.cost_incurred.toFixed(4)}
- Tokens Used: ${state.tokens_used.toLocaleString()}

---
*Powered by Autonomous Enterprise PR Autopilot*
`.trim();
}
