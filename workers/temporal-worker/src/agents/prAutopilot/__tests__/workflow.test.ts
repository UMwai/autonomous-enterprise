/**
 * PR Autopilot Workflow Tests
 *
 * Unit tests for the PR Autopilot coordinator-worker pattern.
 */

import { describe, it, expect } from 'vitest';
import { AgentType } from '../definitions.js';
import { AgentResponse, Severity, FindingType } from '../protocol.js';
import { parseHandoffSignal, parseFindings, createHandoffSignal } from '../protocol.js';

describe('PR Autopilot Protocol', () => {
  describe('parseHandoffSignal', () => {
    it('should parse handoff signal from JSON block', () => {
      const output = `
I've analyzed the PR and found dependency changes.

\`\`\`json
{
  "action": "handoff",
  "target": "security",
  "reason": "PR modifies package.json"
}
\`\`\`
      `;

      const signal = parseHandoffSignal(output);

      expect(signal).not.toBeNull();
      expect(signal?.action).toBe('handoff');
      expect(signal?.target).toBe('security');
      expect(signal?.reason).toBe('PR modifies package.json');
    });

    it('should return null for output without handoff signal', () => {
      const output = 'Just a regular message without handoff';
      const signal = parseHandoffSignal(output);

      expect(signal).toBeNull();
    });

    it('should parse handoff signal from pure JSON', () => {
      const output = JSON.stringify({
        action: 'handoff',
        target: 'github',
        reason: 'Need code review',
      });

      const signal = parseHandoffSignal(output);

      expect(signal).not.toBeNull();
      expect(signal?.target).toBe('github');
    });
  });

  describe('parseFindings', () => {
    it('should parse findings from JSON block', () => {
      const output = `
Security scan complete.

\`\`\`json
{
  "findings": [
    {
      "type": "CVE",
      "severity": "HIGH",
      "file": "package.json",
      "message": "axios@0.21.1 has CVE-2021-3749",
      "recommendation": "Update to axios@1.6.0",
      "cve_id": "CVE-2021-3749"
    }
  ]
}
\`\`\`
      `;

      const findings = parseFindings(output);

      expect(findings).toHaveLength(1);
      expect(findings[0].type).toBe('CVE');
      expect(findings[0].severity).toBe('HIGH');
      expect(findings[0].cve_id).toBe('CVE-2021-3749');
    });

    it('should return empty array for output without findings', () => {
      const output = 'No issues found';
      const findings = parseFindings(output);

      expect(findings).toEqual([]);
    });
  });

  describe('createHandoffSignal', () => {
    it('should create properly formatted handoff signal', () => {
      const signal = createHandoffSignal(
        AgentType.SECURITY,
        'Need CVE scan',
        { files: ['package.json'] }
      );

      expect(signal).toContain('```json');
      expect(signal).toContain('"action": "handoff"');
      expect(signal).toContain('"target": "security"');
      expect(signal).toContain('"reason": "Need CVE scan"');

      // Verify it can be parsed back
      const parsed = parseHandoffSignal(signal);
      expect(parsed).not.toBeNull();
      expect(parsed?.target).toBe(AgentType.SECURITY);
    });
  });
});

describe('Agent Definitions', () => {
  it('should have valid coordinator config', async () => {
    const { getAgentConfig } = await import('../definitions.js');
    const config = getAgentConfig(AgentType.COORDINATOR);

    expect(config.name).toBe(AgentType.COORDINATOR);
    expect(config.tools).toEqual([]); // Coordinator has no tools
    expect(config.handoff_targets).toContain(AgentType.SECURITY);
    expect(config.handoff_targets).toContain(AgentType.GITHUB);
    expect(config.handoff_targets).toContain(AgentType.STYLE);
  });

  it('should have valid security agent config', async () => {
    const { getAgentConfig } = await import('../definitions.js');
    const config = getAgentConfig(AgentType.SECURITY);

    expect(config.name).toBe(AgentType.SECURITY);
    expect(config.tools).toContain('check_cve_database');
    expect(config.tools).toContain('get_changed_files');
    expect(config.handoff_targets).toEqual([AgentType.COORDINATOR]);
  });

  it('should have all required agents', async () => {
    const { getAllAgents } = await import('../definitions.js');
    const agents = getAllAgents();

    expect(agents).toHaveLength(4);
    expect(agents.map(a => a.name)).toContain(AgentType.COORDINATOR);
    expect(agents.map(a => a.name)).toContain(AgentType.SECURITY);
    expect(agents.map(a => a.name)).toContain(AgentType.GITHUB);
    expect(agents.map(a => a.name)).toContain(AgentType.STYLE);
  });
});

describe('Review Status Calculation', () => {
  it('should request changes for HIGH severity findings', async () => {
    const { calculateReviewStatus } = await import('../protocol.js');

    const findings = [
      {
        type: FindingType.CVE,
        severity: Severity.HIGH,
        file: 'package.json',
        message: 'Critical vulnerability',
        recommendation: 'Update package',
      },
    ];

    const status = calculateReviewStatus(findings);

    expect(status.status).toBe('REQUEST_CHANGES');
    expect(status.blocking_count).toBe(1);
  });

  it('should approve for LOW severity findings', async () => {
    const { calculateReviewStatus } = await import('../protocol.js');

    const findings = [
      {
        type: FindingType.FORMATTING,
        severity: Severity.LOW,
        file: 'src/app.ts',
        message: 'Formatting issue',
        recommendation: 'Run prettier',
      },
    ];

    const status = calculateReviewStatus(findings);

    expect(status.status).toBe('COMMENT');
    expect(status.blocking_count).toBe(0);
  });

  it('should approve for no findings', async () => {
    const { calculateReviewStatus } = await import('../protocol.js');

    const status = calculateReviewStatus([]);

    expect(status.status).toBe('APPROVE');
    expect(status.blocking_count).toBe(0);
    expect(status.suggestion_count).toBe(0);
  });
});

describe('Agent Response Validation', () => {
  it('should validate complete agent response', async () => {
    const { validateAgentResponse } = await import('../protocol.js');

    const response: AgentResponse = {
      agent: AgentType.SECURITY,
      success: true,
      summary: 'Security scan complete',
      findings: [],
      next_agent: AgentType.COORDINATOR,
      tools_used: ['check_cve_database'],
      tokens_used: 1000,
      cost: 0.05,
      duration: 2500,
    };

    const validation = validateAgentResponse(response);

    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it('should reject response with missing required fields', async () => {
    const { validateAgentResponse } = await import('../protocol.js');

    const response: any = {
      agent: AgentType.SECURITY,
      // Missing success, summary, findings
      next_agent: null,
    };

    const validation = validateAgentResponse(response);

    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
  });

  it('should reject self-handoff', async () => {
    const { validateAgentResponse } = await import('../protocol.js');

    const response: AgentResponse = {
      agent: AgentType.SECURITY,
      success: true,
      summary: 'Complete',
      findings: [],
      next_agent: AgentType.SECURITY, // Invalid: self-handoff
      tools_used: [],
      tokens_used: 0,
      cost: 0,
      duration: 0,
    };

    const validation = validateAgentResponse(response);

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('Agent cannot hand off to itself');
  });
});

describe('Finding Merging', () => {
  it('should merge findings from multiple agents', async () => {
    const { mergeFindings } = await import('../protocol.js');

    const responses: AgentResponse[] = [
      {
        agent: AgentType.SECURITY,
        success: true,
        summary: 'Security complete',
        findings: [
          {
            type: FindingType.CVE,
            severity: Severity.HIGH,
            file: 'package.json',
            message: 'CVE found',
            recommendation: 'Update',
          },
        ],
        next_agent: null,
        tools_used: [],
        tokens_used: 0,
        cost: 0,
        duration: 0,
      },
      {
        agent: AgentType.GITHUB,
        success: true,
        summary: 'Review complete',
        findings: [
          {
            type: FindingType.BUG,
            severity: Severity.MEDIUM,
            file: 'src/api.ts',
            message: 'Potential bug',
            recommendation: 'Fix',
          },
        ],
        next_agent: null,
        tools_used: [],
        tokens_used: 0,
        cost: 0,
        duration: 0,
      },
    ];

    const merged = mergeFindings(responses);

    expect(merged).toHaveLength(2);
    // Should be sorted by severity (HIGH before MEDIUM)
    expect(merged[0].severity).toBe(Severity.HIGH);
    expect(merged[1].severity).toBe(Severity.MEDIUM);
  });

  it('should filter out findings from failed agents', async () => {
    const { mergeFindings } = await import('../protocol.js');

    const responses: AgentResponse[] = [
      {
        agent: AgentType.SECURITY,
        success: false, // Failed
        summary: 'Failed',
        findings: [
          {
            type: FindingType.CVE,
            severity: Severity.HIGH,
            file: 'package.json',
            message: 'Should be ignored',
            recommendation: 'N/A',
          },
        ],
        next_agent: null,
        tools_used: [],
        tokens_used: 0,
        cost: 0,
        duration: 0,
      },
    ];

    const merged = mergeFindings(responses);

    expect(merged).toHaveLength(0); // Failed agent findings excluded
  });
});
