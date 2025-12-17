/**
 * Test Script: Trading Bot Generation
 *
 * Demonstrates the end-to-end workflow of generating a trading bot
 * using the Autonomous Enterprise system with real CLI agents.
 *
 * Run: npx tsx scripts/test-trading-bot.ts
 */

import { runAgent, AgentProvider, AgentRunResult } from '../workers/temporal-worker/src/temporal/activities/cli/harness.js';
import {
  CliProcessManager,
  getProcessManager,
} from '../workers/temporal-worker/src/temporal/activities/cli/processManager.js';

// Configuration
const WORKSPACE = '/tmp/trading-bot-test';
const PROVIDERS: AgentProvider[] = ['claude', 'gemini', 'codex'];

// Trading bot specification
const TRADING_BOT_SPEC = {
  prompt: `Create a cryptocurrency trading bot with the following requirements:

## Goal
Generate $5,000 MRR (Monthly Recurring Revenue) through automated trading profits.

## Technical Requirements
1. **Exchange Integration**: Connect to Binance API for spot trading
2. **Strategy**: Implement a momentum-based strategy with:
   - RSI (Relative Strength Index) for overbought/oversold detection
   - MACD (Moving Average Convergence Divergence) for trend confirmation
   - Volume analysis for trade validation
3. **Risk Management**:
   - Maximum 2% of portfolio per trade
   - Stop-loss at 3% below entry
   - Take-profit at 5% above entry
   - Daily drawdown limit of 5%
4. **Pairs**: Focus on BTC/USDT and ETH/USDT
5. **Infrastructure**:
   - Async Python with ccxt library
   - Redis for caching market data
   - SQLite for trade history
   - Discord webhook notifications

## Deliverables
1. Main trading bot script (bot.py)
2. Strategy implementation (strategy.py)
3. Exchange connector (exchange.py)
4. Configuration file (config.yaml)
5. Requirements file (requirements.txt)
6. README with setup instructions
7. Basic backtesting script (backtest.py)

Start by analyzing the project structure and then implement each component.`,

  missionLog: [
    'Project initialized: Trading bot for $5K MRR target',
    'Architecture: Async Python + ccxt + Redis + SQLite',
    'Focus: Momentum strategy with RSI, MACD, Volume',
  ],

  directives: [
    'Use type hints throughout all Python code',
    'Include comprehensive error handling',
    'Add logging for debugging and monitoring',
    'Write docstrings for all functions',
    'Follow PEP 8 style guidelines',
  ],
};

/**
 * Test a single CLI agent
 */
async function testAgent(
  provider: AgentProvider,
  prompt: string,
  workspace: string
): Promise<AgentRunResult> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing ${provider.toUpperCase()} CLI Agent`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    const result = await runAgent({
      provider,
      workspace,
      spec: {
        prompt,
        missionLog: TRADING_BOT_SPEC.missionLog,
        directives: TRADING_BOT_SPEC.directives,
        currentPhase: 'Initial Implementation',
      },
      timeout: 300000, // 5 minutes
      providerOptions: {
        // Claude-specific
        dangerouslySkipPermissions: true,
        budget: { maxCost: 1.0 },
        // Gemini-specific
        yoloMode: true,
        // Codex-specific
        approvalPolicy: 'never',
        sandboxMode: 'workspace-write',
      },
    });

    console.log(`\nResult Summary:`);
    console.log(`  Success: ${result.success}`);
    console.log(`  Duration: ${(result.duration / 1000).toFixed(2)}s`);
    console.log(`  Exit Code: ${result.exitCode}`);
    console.log(`  Files Changed: ${result.structuredOutput?.filesChanged?.length || 0}`);
    console.log(`  Commands Run: ${result.structuredOutput?.commandsRun?.length || 0}`);
    console.log(`  Errors: ${result.errors.length}`);

    if (result.structuredOutput?.filesChanged?.length) {
      console.log(`\n  Files:`);
      for (const file of result.structuredOutput.filesChanged) {
        console.log(`    - ${file}`);
      }
    }

    if (result.errors.length > 0) {
      console.log(`\n  Errors:`);
      for (const err of result.errors) {
        console.log(`    - [${err.type}] ${err.message.substring(0, 100)}...`);
      }
    }

    return result;
  } catch (error) {
    console.error(`\nAgent failed:`, error);
    throw error;
  }
}

/**
 * Test the process manager with multiple sessions
 */
async function testProcessManager(): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing CLI Process Manager`);
  console.log(`${'='.repeat(60)}\n`);

  const manager = getProcessManager();

  // Start a simple session
  console.log('Starting Claude session...');
  const sessionId = await manager.startSession(
    'claude',
    'List the files in the current directory and describe the project structure',
    WORKSPACE,
    {
      timeout: 60000,
      autoApprove: true,
    }
  );

  console.log(`Session started: ${sessionId}`);

  // Get session info
  const session = manager.getSession(sessionId);
  console.log(`Session status: ${session?.status}`);
  console.log(`Session PID: ${session?.pid}`);

  // Wait for completion
  console.log('\nWaiting for session to complete...');
  const result = await manager.waitForSession(sessionId, 60000);

  console.log(`\nSession completed:`);
  console.log(`  Success: ${result.success}`);
  console.log(`  Duration: ${(result.duration / 1000).toFixed(2)}s`);

  // Cleanup
  manager.cleanup();
}

/**
 * Main test runner
 */
async function main(): Promise<void> {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║     Autonomous Enterprise - Trading Bot Test Suite            ║
║                                                               ║
║  Testing CLI agents: Claude Code, Gemini CLI, Codex CLI       ║
╚═══════════════════════════════════════════════════════════════╝
`);

  // Ensure workspace exists
  const fs = await import('fs/promises');
  try {
    await fs.mkdir(WORKSPACE, { recursive: true });
    console.log(`Workspace created: ${WORKSPACE}`);
  } catch {
    console.log(`Workspace exists: ${WORKSPACE}`);
  }

  // Test each agent individually
  const results: Record<AgentProvider, AgentRunResult | null> = {
    claude: null,
    gemini: null,
    codex: null,
  };

  for (const provider of PROVIDERS) {
    try {
      // Use a simpler prompt for testing
      const testPrompt = `
Create a simple Python script called hello.py that:
1. Prints "Hello from ${provider}!"
2. Shows the current timestamp
3. Lists files in the current directory

Also create a requirements.txt with any needed dependencies.
      `;

      results[provider] = await testAgent(
        provider,
        testPrompt,
        WORKSPACE
      );
    } catch (error) {
      console.error(`${provider} agent test failed:`, error);
      results[provider] = null;
    }
  }

  // Test process manager
  try {
    await testProcessManager();
  } catch (error) {
    console.error('Process manager test failed:', error);
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST SUMMARY`);
  console.log(`${'='.repeat(60)}\n`);

  for (const [provider, result] of Object.entries(results)) {
    const status = result?.success
      ? '✅ PASSED'
      : result === null
      ? '❌ FAILED (error)'
      : '⚠️ COMPLETED (with errors)';
    console.log(`  ${provider.padEnd(10)}: ${status}`);
  }

  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║  To run the full trading bot generation:                      ║
║                                                               ║
║  1. Start the infrastructure:                                 ║
║     cd infra && ./start.sh --infra                           ║
║                                                               ║
║  2. Run the API and Worker:                                   ║
║     cd infra && ./start.sh api worker                        ║
║                                                               ║
║  3. Trigger a Genesis workflow via API:                       ║
║     curl -X POST http://localhost:8000/api/v1/genesis/create ║
║       -H "Content-Type: application/json"                     ║
║       -d '{"prompt": "Create a trading bot..."}'             ║
╚═══════════════════════════════════════════════════════════════╝
`);
}

// Run
main().catch(console.error);
