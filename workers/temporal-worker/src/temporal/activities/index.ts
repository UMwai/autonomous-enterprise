/**
 * Activity exports for Temporal worker
 *
 * Aggregates all activities from different modules for worker registration.
 */

// CLI Activities - Agent harness for Claude/Gemini/Codex
export * from './cli/claudeCode.js';
export * from './cli/geminiCli.js';
export * from './cli/codexCli.js';
export * from './cli/harness.js';
export * from './cli/processManager.js';

// Git Activities - Version control operations
export * from './git/index.js';

// Deployment Activities - Deploy to Vercel, etc.
export * from './deploy/index.js';

// Sandbox Activities - E2B secure execution
export * from './sandbox/index.js';

// Genesis Activities - Market research, niche identification, spec generation
export * from './genesis/index.js';

// Build Activities - Scaffolding, linting, testing, building
export * from './build/index.js';

// Stripe/Monetization Activities - Payments, subscriptions
export * from './stripe/index.js';

// PR Autopilot Activities - Autonomous PR review
export * from './prAutopilot/index.js';
