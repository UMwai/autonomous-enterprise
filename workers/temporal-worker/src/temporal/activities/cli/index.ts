/**
 * CLI Activities Index
 *
 * Exports all CLI-related activities and adapters for agent execution.
 */

// Adapters
export { ClaudeCodeAdapter, runClaudeCode } from './claudeCode.js';
export type { ClaudeOptions } from './claudeCode.js';

export { GeminiCliAdapter, runGeminiCli } from './geminiCli.js';
export type { GeminiOptions } from './geminiCli.js';

export { CodexCliAdapter, runCodexCli } from './codexCli.js';
export type { CodexOptions } from './codexCli.js';

// Unified Harness
export {
  runAgent,
  validateAgentConfig,
  parseAgentOutput,
} from './harness.js';
export type {
  AgentProvider,
  AgentRunConfig,
  AgentRunResult,
  FilePatch,
} from './harness.js';

// Process Manager
export {
  CliProcessManager,
  getProcessManager,
  startCliSession,
  getCliSessionStatus,
  getCliSessionOutput,
  waitForCliSession,
  killCliSession,
} from './processManager.js';
export type {
  SessionInfo,
  SessionStatus,
  SessionOptions,
  ProcessOutputEvent,
} from './processManager.js';
