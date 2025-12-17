/**
 * Unified Agent Harness - Execution Layer for CLI-based AI Agents
 *
 * Provides a unified interface for running different AI agent CLI tools
 * (Claude Code, Gemini CLI, Codex CLI) with consistent configuration,
 * result handling, and error management.
 */

import { ClaudeCodeAdapter } from './claudeCode.js';
import { GeminiCliAdapter } from './geminiCli.js';
import { CodexCliAdapter } from './codexCli.js';

/**
 * Supported agent providers
 */
export type AgentProvider = 'claude' | 'gemini' | 'codex';

/**
 * Configuration for running an agent
 */
export interface AgentRunConfig {
  /** The agent provider to use */
  provider: AgentProvider;

  /** Workspace directory path */
  workspace: string;

  /** Living specification for the agent */
  spec: {
    /** Main prompt/task for the agent */
    prompt: string;

    /** Mission context and history */
    missionLog?: string[];

    /** Error registry from previous attempts */
    errorRegistry?: string[];

    /** Current phase of execution */
    currentPhase?: string;

    /** Additional directives */
    directives?: string[];
  };

  /** Timeout in milliseconds (default: 300000 = 5 minutes) */
  timeout?: number;

  /** Token budget for the agent */
  budget?: {
    maxTokens?: number;
    maxCost?: number;
  };

  /** Provider-specific options */
  providerOptions?: Record<string, unknown>;
}

/**
 * File patch/change information
 */
export interface FilePatch {
  /** File path relative to workspace */
  path: string;

  /** Type of change */
  type: 'create' | 'modify' | 'delete';

  /** New file content (for create/modify) */
  content?: string;

  /** Diff/patch information */
  diff?: string;
}

/**
 * Result from running an agent
 */
export interface AgentRunResult {
  /** Whether the agent execution succeeded */
  success: boolean;

  /** Raw output from the agent */
  output: string;

  /** Structured output if available */
  structuredOutput?: {
    /** Summary of what was done */
    summary?: string;

    /** Files modified/created */
    filesChanged?: string[];

    /** Commands executed */
    commandsRun?: string[];

    /** Key insights or decisions */
    insights?: string[];
  };

  /** File patches/changes made by the agent */
  patches: FilePatch[];

  /** Errors encountered during execution */
  errors: Array<{
    message: string;
    type: 'execution' | 'parsing' | 'timeout' | 'budget';
    context?: string;
  }>;

  /** Token usage statistics */
  tokensUsed: {
    input?: number;
    output?: number;
    total: number;
  };

  /** Cost information */
  cost?: {
    amount: number;
    currency: string;
  };

  /** Execution duration in milliseconds */
  duration: number;

  /** Exit code from the CLI process */
  exitCode?: number;
}

/**
 * Parse agent output to extract structured data
 */
export function parseAgentOutput(
  output: string,
  provider: AgentProvider
): Partial<AgentRunResult> {
  const result: Partial<AgentRunResult> = {
    patches: [],
    errors: [],
    tokensUsed: { total: 0 },
    structuredOutput: {},
  };

  // Provider-specific parsing
  switch (provider) {
    case 'claude':
      return parseClaudeOutput(output);
    case 'gemini':
      return parseGeminiOutput(output);
    case 'codex':
      return parseCodexOutput(output);
    default:
      return result;
  }
}

/**
 * Parse Claude Code output
 */
function parseClaudeOutput(output: string): Partial<AgentRunResult> {
  const result: Partial<AgentRunResult> = {
    patches: [],
    errors: [],
    tokensUsed: { total: 0 },
    structuredOutput: {
      filesChanged: [],
      commandsRun: [],
      insights: [],
    },
  };

  // Extract file changes
  const fileChangeRegex = /(?:Created|Modified|Edited)\s+(.+\.(?:ts|js|json|md|yml|yaml))/gi;
  let match;
  while ((match = fileChangeRegex.exec(output)) !== null) {
    result.structuredOutput!.filesChanged!.push(match[1]);
  }

  // Extract commands run
  const commandRegex = /(?:Running|Executed|Command):\s*`([^`]+)`/gi;
  while ((match = commandRegex.exec(output)) !== null) {
    result.structuredOutput!.commandsRun!.push(match[1]);
  }

  // Extract errors
  const errorRegex = /(?:Error|Failed|Exception):\s*(.+?)(?:\n|$)/gi;
  while ((match = errorRegex.exec(output)) !== null) {
    result.errors!.push({
      message: match[1],
      type: 'execution',
    });
  }

  // Extract token usage (if present in output)
  const tokenRegex = /tokens?:\s*(\d+)/i;
  const tokenMatch = tokenRegex.exec(output);
  if (tokenMatch) {
    result.tokensUsed!.total = parseInt(tokenMatch[1], 10);
  }

  return result;
}

/**
 * Parse Gemini CLI output
 */
function parseGeminiOutput(output: string): Partial<AgentRunResult> {
  const result: Partial<AgentRunResult> = {
    patches: [],
    errors: [],
    tokensUsed: { total: 0 },
    structuredOutput: {
      filesChanged: [],
      insights: [],
    },
  };

  // Gemini CLI has different output format
  // Extract insights/recommendations
  const insightRegex = /(?:Recommendation|Insight|Suggestion):\s*(.+?)(?:\n\n|\n-|\n\d|$)/gi;
  let match;
  while ((match = insightRegex.exec(output)) !== null) {
    result.structuredOutput!.insights!.push(match[1].trim());
  }

  // Extract file references
  const fileRefRegex = /(?:File|Modified):\s*`?([^\s`]+\.(?:ts|js|json|md|yml|yaml))`?/gi;
  while ((match = fileRefRegex.exec(output)) !== null) {
    result.structuredOutput!.filesChanged!.push(match[1]);
  }

  return result;
}

/**
 * Parse Codex CLI output
 */
function parseCodexOutput(output: string): Partial<AgentRunResult> {
  const result: Partial<AgentRunResult> = {
    patches: [],
    errors: [],
    tokensUsed: { total: 0 },
    structuredOutput: {
      filesChanged: [],
      commandsRun: [],
      insights: [],
    },
  };

  // Extract file changes
  const fileChangeRegex = /(?:Created|Modified|Wrote|Updated|Edited)\s+[`']?([^\s`'\n]+\.[a-zA-Z]+)[`']?/gi;
  let match;
  while ((match = fileChangeRegex.exec(output)) !== null) {
    result.structuredOutput!.filesChanged!.push(match[1]);
  }

  // Extract commands run
  const commandRegex = /(?:Running|Executing|Command):\s*`([^`]+)`/gi;
  while ((match = commandRegex.exec(output)) !== null) {
    result.structuredOutput!.commandsRun!.push(match[1]);
  }

  // Extract errors
  const errorRegex = /(?:Error|Failed|Exception):\s*(.+?)(?:\n|$)/gi;
  while ((match = errorRegex.exec(output)) !== null) {
    result.errors!.push({
      message: match[1],
      type: 'execution',
    });
  }

  // Extract token usage
  const tokenRegex = /tokens?:\s*(\d+)/i;
  const tokenMatch = tokenRegex.exec(output);
  if (tokenMatch) {
    result.tokensUsed!.total = parseInt(tokenMatch[1], 10);
  }

  return result;
}

/**
 * Run an agent with the given configuration
 */
export async function runAgent(config: AgentRunConfig): Promise<AgentRunResult> {
  const startTime = Date.now();
  const timeout = config.timeout || 300000; // Default 5 minutes

  try {
    let result: AgentRunResult;

    switch (config.provider) {
      case 'claude': {
        const adapter = new ClaudeCodeAdapter();
        result = await adapter.run(
          config.spec.prompt,
          config.workspace,
          {
            timeout,
            missionLog: config.spec.missionLog,
            errorRegistry: config.spec.errorRegistry,
            currentPhase: config.spec.currentPhase,
            directives: config.spec.directives,
            budget: config.budget,
            ...config.providerOptions,
          }
        );
        break;
      }

      case 'gemini': {
        const adapter = new GeminiCliAdapter();
        result = await adapter.run(
          config.spec.prompt,
          config.workspace,
          {
            timeout,
            missionLog: config.spec.missionLog,
            errorRegistry: config.spec.errorRegistry,
            currentPhase: config.spec.currentPhase,
            ...config.providerOptions,
          }
        );
        break;
      }

      case 'codex': {
        const adapter = new CodexCliAdapter();
        result = await adapter.run(
          config.spec.prompt,
          config.workspace,
          {
            timeout,
            missionLog: config.spec.missionLog,
            errorRegistry: config.spec.errorRegistry,
            currentPhase: config.spec.currentPhase,
            ...config.providerOptions,
          }
        );
        break;
      }

      default: {
        const exhaustive: never = config.provider;
        throw new Error(`Unknown agent provider: ${exhaustive}`);
      }
    }

    // Calculate duration
    result.duration = Date.now() - startTime;

    return result;
  } catch (error) {
    // Handle execution errors
    const duration = Date.now() - startTime;

    return {
      success: false,
      output: error instanceof Error ? error.message : String(error),
      patches: [],
      errors: [
        {
          message: error instanceof Error ? error.message : String(error),
          type: 'execution',
          context: `Failed to run ${config.provider} agent`,
        },
      ],
      tokensUsed: { total: 0 },
      duration,
    };
  }
}

/**
 * Validate agent configuration
 */
export function validateAgentConfig(config: AgentRunConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!config.provider) {
    errors.push('Provider is required');
  }

  if (!config.workspace) {
    errors.push('Workspace path is required');
  }

  if (!config.spec || !config.spec.prompt) {
    errors.push('Spec with prompt is required');
  }

  if (config.timeout && config.timeout <= 0) {
    errors.push('Timeout must be positive');
  }

  if (config.budget?.maxTokens && config.budget.maxTokens <= 0) {
    errors.push('Max tokens must be positive');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
