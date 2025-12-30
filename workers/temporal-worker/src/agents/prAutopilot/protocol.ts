/**
 * PR Autopilot Handoff Protocol
 *
 * Defines the structured response format for agent communication,
 * including handoff signaling and state management.
 */

import { AgentType } from './definitions.js';

/**
 * Severity levels for findings
 */
export enum Severity {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  INFO = 'INFO',
}

/**
 * Finding categories
 */
export enum FindingType {
  // Security
  CVE = 'CVE',
  SECRET = 'SECRET',
  SQL_INJECTION = 'SQL_INJECTION',
  XSS = 'XSS',
  AUTH = 'AUTH',

  // Code quality
  BUG = 'BUG',
  PERFORMANCE = 'PERFORMANCE',
  ARCHITECTURE = 'ARCHITECTURE',
  EDGE_CASE = 'EDGE_CASE',

  // Style
  FORMATTING = 'FORMATTING',
  NAMING = 'NAMING',
  DOCUMENTATION = 'DOCUMENTATION',
}

/**
 * Individual finding from an agent
 */
export interface Finding {
  /** Type of finding */
  type: FindingType;

  /** Severity level */
  severity: Severity;

  /** File path */
  file: string;

  /** Line number (optional) */
  line?: number;

  /** Description of the issue */
  message: string;

  /** Recommended fix or action */
  recommendation: string;

  /** Auto-fixable (for style issues) */
  auto_fixable?: boolean;

  /** Related CVE ID (for security issues) */
  cve_id?: string;
}

/**
 * Agent response structure
 */
export interface AgentResponse {
  /** Agent that produced this response */
  agent: AgentType;

  /** Whether the agent completed successfully */
  success: boolean;

  /** Summary of what the agent did */
  summary: string;

  /** Findings discovered by this agent */
  findings: Finding[];

  /** Next agent to hand off to (null if done) */
  next_agent: AgentType | null;

  /** Reason for handoff */
  handoff_reason?: string;

  /** Context to pass to next agent */
  context?: Record<string, unknown>;

  /** Tool calls made by this agent */
  tools_used: string[];

  /** Tokens consumed */
  tokens_used: number;

  /** Cost incurred */
  cost: number;

  /** Execution time in milliseconds */
  duration: number;

  /** Error message if failed */
  error?: string;
}

/**
 * Handoff signal - embedded in agent output to trigger routing
 */
export interface HandoffSignal {
  /** Action type - always "handoff" */
  action: 'handoff';

  /** Target agent to hand off to */
  target: AgentType;

  /** Reason for handoff */
  reason: string;

  /** Optional context to pass */
  context?: Record<string, unknown>;
}

/**
 * Parse agent output for handoff signals
 *
 * Agents signal handoff by including JSON in their response:
 * ```json
 * {
 *   "action": "handoff",
 *   "target": "security",
 *   "reason": "PR modifies package.json, need CVE scan"
 * }
 * ```
 */
export function parseHandoffSignal(output: string): HandoffSignal | null {
  try {
    // Look for JSON block in output
    const jsonMatch = output.match(/```json\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.action === 'handoff' && parsed.target) {
        return parsed as HandoffSignal;
      }
    }

    // Also try parsing the entire output if it's pure JSON
    const parsed = JSON.parse(output);
    if (parsed.action === 'handoff' && parsed.target) {
      return parsed as HandoffSignal;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract findings from agent output
 *
 * Agents should output findings in structured JSON format:
 * ```json
 * {
 *   "findings": [
 *     {
 *       "type": "CVE",
 *       "severity": "HIGH",
 *       "file": "package.json",
 *       "message": "axios@0.21.1 has known CVE-2021-3749",
 *       "recommendation": "Update to axios@1.6.0",
 *       "cve_id": "CVE-2021-3749"
 *     }
 *   ]
 * }
 * ```
 */
export function parseFindings(output: string): Finding[] {
  try {
    // Look for JSON block in output
    const jsonMatch = output.match(/```json\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.findings && Array.isArray(parsed.findings)) {
        return parsed.findings;
      }
    }

    // Try parsing entire output
    const parsed = JSON.parse(output);
    if (parsed.findings && Array.isArray(parsed.findings)) {
      return parsed.findings;
    }

    return [];
  } catch {
    return [];
  }
}

/**
 * Create a handoff signal for agent output
 */
export function createHandoffSignal(
  target: AgentType,
  reason: string,
  context?: Record<string, unknown>
): string {
  const signal: HandoffSignal = {
    action: 'handoff',
    target,
    reason,
    context,
  };

  return `\n\n\`\`\`json\n${JSON.stringify(signal, null, 2)}\n\`\`\`\n`;
}

/**
 * Create findings output for agent response
 */
export function createFindingsOutput(findings: Finding[]): string {
  return `\n\n\`\`\`json\n${JSON.stringify({ findings }, null, 2)}\n\`\`\`\n`;
}

/**
 * Validate agent response structure
 */
export function validateAgentResponse(response: AgentResponse): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!response.agent) {
    errors.push('Agent type is required');
  }

  if (response.success === undefined) {
    errors.push('Success status is required');
  }

  if (!response.summary) {
    errors.push('Summary is required');
  }

  if (!Array.isArray(response.findings)) {
    errors.push('Findings must be an array');
  }

  if (response.next_agent && response.next_agent === response.agent) {
    errors.push('Agent cannot hand off to itself');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Merge findings from multiple agents
 */
export function mergeFindings(responses: AgentResponse[]): Finding[] {
  const allFindings: Finding[] = [];

  for (const response of responses) {
    if (response.success && response.findings.length > 0) {
      allFindings.push(...response.findings);
    }
  }

  // Sort by severity (HIGH -> MEDIUM -> LOW -> INFO)
  const severityOrder = {
    [Severity.HIGH]: 0,
    [Severity.MEDIUM]: 1,
    [Severity.LOW]: 2,
    [Severity.INFO]: 3,
  };

  allFindings.sort((a, b) => {
    const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDiff !== 0) return severityDiff;

    // Then sort by file
    return a.file.localeCompare(b.file);
  });

  return allFindings;
}

/**
 * Calculate overall PR review status from findings
 */
export function calculateReviewStatus(findings: Finding[]): {
  status: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  blocking_count: number;
  suggestion_count: number;
} {
  const highSeverity = findings.filter(f => f.severity === Severity.HIGH);
  const mediumSeverity = findings.filter(f => f.severity === Severity.MEDIUM);

  // HIGH severity findings block merge
  if (highSeverity.length > 0) {
    return {
      status: 'REQUEST_CHANGES',
      blocking_count: highSeverity.length,
      suggestion_count: mediumSeverity.length + findings.length - highSeverity.length,
    };
  }

  // MEDIUM severity findings request changes but don't block
  if (mediumSeverity.length > 0) {
    return {
      status: 'REQUEST_CHANGES',
      blocking_count: 0,
      suggestion_count: findings.length,
    };
  }

  // Only LOW/INFO findings - approve with comments
  if (findings.length > 0) {
    return {
      status: 'COMMENT',
      blocking_count: 0,
      suggestion_count: findings.length,
    };
  }

  // No findings - approve
  return {
    status: 'APPROVE',
    blocking_count: 0,
    suggestion_count: 0,
  };
}
