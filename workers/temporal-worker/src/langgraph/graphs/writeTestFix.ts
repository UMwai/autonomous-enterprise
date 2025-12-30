/**
 * LangGraph implementation of the Write → Test → Diagnose → Fix cycle.
 *
 * This graph uses:
 * - CLI harness (Claude/Gemini/Codex) for code generation
 * - E2B sandbox for safe test execution
 * - Budget tracking for cost management
 */

import { StateGraph, END, START } from "@langchain/langgraph";
import {
  WriteTestFixState,
  WriteTestFixStateType,
  FileChange,
  TestResult,
  Diagnostic,
} from "../state.js";
import { runAgent, AgentProvider } from "../../temporal/activities/cli/harness.js";
import { safeExecuteCode, SafeExecuteResult } from "../../temporal/activities/sandbox/safeExecute.js";

/**
 * Configuration for the Write-Test-Fix cycle
 */
interface WriteTestFixConfig {
  provider: AgentProvider;
  workspace: string;
  runId: string;
}

/**
 * Base workspace path - uses persistent volume in Docker, /tmp locally
 */
const WORKSPACE_BASE = process.env.WORKSPACE_DIR || '/workspaces';

let currentConfig: WriteTestFixConfig = {
  provider: 'claude',
  workspace: `${WORKSPACE_BASE}/default`,
  runId: 'default',
};

/**
 * Set configuration for the graph execution
 */
export function setWriteTestFixConfig(config: Partial<WriteTestFixConfig>): void {
  currentConfig = { ...currentConfig, ...config };
}

/**
 * Plan node - Creates implementation plan from task description
 */
async function planNode(
  state: WriteTestFixStateType
): Promise<Partial<WriteTestFixStateType>> {
  console.log(`[Plan] Starting planning for task: ${state.taskId}`);

  // Use CLI agent to create an implementation plan
  const planPrompt = `
You are planning the implementation of a feature. Create a detailed plan.

Task: ${state.taskDescription}

Acceptance Criteria:
${state.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Create a step-by-step implementation plan. Be specific about:
1. Files to create/modify
2. Key functions/components needed
3. Test cases to write
4. Dependencies required

Output the plan in markdown format.
`;

  const result = await runAgent({
    provider: currentConfig.provider,
    workspace: currentConfig.workspace,
    spec: {
      prompt: planPrompt,
      currentPhase: 'planning',
    },
    timeout: 120000, // 2 minutes for planning
  });

  const planMessage = {
    role: "assistant",
    content: result.success
      ? result.output
      : `Planning failed: ${result.errors.map(e => e.message).join(', ')}`,
  };

  return {
    messages: [planMessage],
    iteration: 1,
    tokensUsed: result.tokensUsed.total,
    costIncurred: result.cost?.amount || 0,
  };
}

/**
 * Write node - Generates or modifies code based on plan/diagnostics
 */
async function writeNode(
  state: WriteTestFixStateType
): Promise<Partial<WriteTestFixStateType>> {
  console.log(`[Write] Iteration ${state.iteration}: Generating code`);

  // Build context from previous messages and diagnostics
  const context = state.messages
    .slice(-5) // Last 5 messages for context
    .map(m => m.content)
    .join('\n\n');

  const diagnosticsContext = state.diagnostics.length > 0
    ? `\n\nPrevious issues to fix:\n${state.diagnostics.map(d => `- ${d.message}`).join('\n')}`
    : '';

  const writePrompt = `
You are implementing a feature. Write the code now.

Task: ${state.taskDescription}

Acceptance Criteria:
${state.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Context from planning:
${context}
${diagnosticsContext}

Instructions:
1. Create all necessary files
2. Write clean, well-documented code
3. Include tests that verify the acceptance criteria
4. Ensure the code compiles and runs

Implement the feature now. Create all necessary files.
`;

  const result = await runAgent({
    provider: currentConfig.provider,
    workspace: currentConfig.workspace,
    spec: {
      prompt: writePrompt,
      missionLog: state.messages.map(m => m.content),
      errorRegistry: state.diagnostics.map(d => d.message),
      currentPhase: 'writing',
    },
    timeout: 300000, // 5 minutes for code generation
  });

  // Extract file changes from agent output
  const changes: FileChange[] = result.patches.map(patch => ({
    path: patch.path,
    operation: patch.type === 'delete' ? 'delete' : patch.type === 'create' ? 'create' : 'modify',
    content: patch.content,
    diff: patch.diff,
  }));

  // Update current files state
  const updatedFiles: Record<string, string> = {};
  for (const change of changes) {
    if (change.operation !== 'delete' && change.content) {
      updatedFiles[change.path] = change.content;
    }
  }

  return {
    pendingChanges: changes,
    currentFiles: updatedFiles,
    messages: [
      {
        role: "assistant",
        content: result.success
          ? `Generated ${changes.length} file changes:\n${changes.map(c => `- ${c.operation}: ${c.path}`).join('\n')}`
          : `Code generation had issues: ${result.errors.map(e => e.message).join(', ')}`,
      },
    ],
    tokensUsed: result.tokensUsed.total,
    costIncurred: result.cost?.amount || 0,
  };
}

/**
 * Test node - Runs tests in E2B sandbox and collects results
 */
async function testNode(
  state: WriteTestFixStateType
): Promise<Partial<WriteTestFixStateType>> {
  console.log(`[Test] Running tests for iteration ${state.iteration}`);

  // Prepare workspace files for sandbox
  const workspaceFiles = Object.entries(state.currentFiles).map(([path, content]) => ({
    path,
    content,
  }));

  // Execute tests in sandbox
  let testResult: SafeExecuteResult;
  try {
    // First, install dependencies
    await safeExecuteCode({
      runId: currentConfig.runId,
      command: 'npm install --silent 2>/dev/null || true',
      workspaceFiles,
      timeout: 120000,
    });

    // Then run tests
    testResult = await safeExecuteCode({
      runId: currentConfig.runId,
      command: 'npm test 2>&1 || echo "Tests completed with exit code: $?"',
      timeout: 60000,
    });
  } catch (error) {
    // Sandbox execution failed
    testResult = {
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: -1,
      timedOut: false,
      cost: 0,
      budgetRemaining: state.budgetLimit - state.costIncurred,
      policyChecked: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // Parse test results from output
  const testResults: TestResult[] = parseTestOutput(testResult.stdout, testResult.stderr);

  // Determine if all tests passed
  const allPassing = testResult.exitCode === 0 && testResults.every(r => r.passed);

  return {
    testResults,
    testsPassing: allPassing,
    costIncurred: testResult.cost,
    messages: [
      {
        role: "assistant",
        content: `Tests ${allPassing ? "PASSED" : "FAILED"}: ${testResults.filter(r => r.passed).length}/${testResults.length || 1}\n\nOutput:\n${testResult.stdout.slice(0, 500)}${testResult.stderr ? `\nErrors:\n${testResult.stderr.slice(0, 500)}` : ''}`,
      },
    ],
  };
}

/**
 * Parse test output to extract test results
 */
function parseTestOutput(stdout: string, stderr: string): TestResult[] {
  const results: TestResult[] = [];
  const output = stdout + '\n' + stderr;

  // Extract passing tests
  const passMatch = output.matchAll(/✓\s+(.+?)\s*\((\d+)\s*ms\)/g);
  for (const match of passMatch) {
    results.push({
      name: match[1].trim(),
      passed: true,
      duration: parseInt(match[2], 10),
    });
  }

  // Extract failing tests
  const failMatch = output.matchAll(/✕\s+(.+?)(?:\n|$)/g);
  for (const match of failMatch) {
    results.push({
      name: match[1].trim(),
      passed: false,
      duration: 0,
      error: extractErrorFromOutput(output, match[1]),
    });
  }

  // If no specific tests found, create a summary result
  if (results.length === 0) {
    const hasError = stderr.length > 0 || output.includes('Error') || output.includes('FAIL');
    results.push({
      name: 'test suite',
      passed: !hasError,
      duration: 0,
      error: hasError ? stderr || 'Tests failed' : undefined,
    });
  }

  return results;
}

/**
 * Extract error message for a specific test from output
 */
function extractErrorFromOutput(output: string, testName: string): string {
  // Try to find error message after test name
  const errorMatch = output.match(new RegExp(`${testName}[\\s\\S]*?(Error|Expected|Received)[^\\n]*`, 'i'));
  return errorMatch ? errorMatch[0].slice(0, 200) : 'Test failed';
}

/**
 * Diagnose node - Analyzes failures and generates diagnostics
 */
async function diagnoseNode(
  state: WriteTestFixStateType
): Promise<Partial<WriteTestFixStateType>> {
  console.log(`[Diagnose] Analyzing test failures`);

  const diagnostics: Diagnostic[] = [];

  // Analyze each failed test
  for (const result of state.testResults) {
    if (!result.passed && result.error) {
      diagnostics.push({
        type: "error",
        message: result.error,
        suggestion: `Fix failing test: ${result.name}`,
      });
    }
  }

  // If no specific diagnostics, add a general one
  if (diagnostics.length === 0 && !state.testsPassing) {
    diagnostics.push({
      type: "error",
      message: "Tests are not passing. Review the implementation and test output.",
      suggestion: "Check for syntax errors, missing dependencies, or logic issues.",
    });
  }

  return {
    diagnostics,
    messages: [
      {
        role: "assistant",
        content: `Diagnosed ${diagnostics.length} issues:\n${diagnostics.map(d => `- ${d.type}: ${d.message}`).join('\n')}`,
      },
    ],
  };
}

/**
 * Fix node - Applies fixes based on diagnostics using CLI agent
 */
async function fixNode(
  state: WriteTestFixStateType
): Promise<Partial<WriteTestFixStateType>> {
  console.log(`[Fix] Applying fixes based on diagnostics`);

  // Build fix prompt with diagnostics context
  const fixPrompt = `
You need to fix failing tests. Here's what's wrong:

Diagnostics:
${state.diagnostics.map(d => `- ${d.type}: ${d.message}\n  Suggestion: ${d.suggestion || 'Fix the issue'}`).join('\n')}

Test Output Summary:
${state.testResults.filter(t => !t.passed).map(t => `- ${t.name}: ${t.error || 'Failed'}`).join('\n')}

Current iteration: ${state.iteration} of ${state.maxIterations}

Instructions:
1. Analyze the errors carefully
2. Make minimal, targeted fixes
3. Ensure the fixes address the specific errors
4. Don't change unrelated code

Apply the fixes now.
`;

  const result = await runAgent({
    provider: currentConfig.provider,
    workspace: currentConfig.workspace,
    spec: {
      prompt: fixPrompt,
      missionLog: state.messages.slice(-3).map(m => m.content),
      errorRegistry: state.diagnostics.map(d => d.message),
      currentPhase: 'fixing',
    },
    timeout: 180000, // 3 minutes for fixes
  });

  // Extract fixes from agent output
  const fixes: FileChange[] = result.patches.map(patch => ({
    path: patch.path,
    operation: 'modify' as const,
    content: patch.content,
    diff: patch.diff,
  }));

  // Update current files with fixes
  const updatedFiles: Record<string, string> = {};
  for (const fix of fixes) {
    if (fix.content) {
      updatedFiles[fix.path] = fix.content;
    }
  }

  return {
    pendingChanges: fixes,
    currentFiles: updatedFiles,
    diagnostics: [], // Clear diagnostics after applying fixes
    iteration: state.iteration + 1,
    messages: [
      {
        role: "assistant",
        content: result.success
          ? `Applied ${fixes.length} fixes:\n${fixes.map(f => `- ${f.path}`).join('\n')}`
          : `Fix attempt had issues: ${result.errors.map(e => e.message).join(', ')}`,
      },
    ],
    tokensUsed: result.tokensUsed.total,
    costIncurred: result.cost?.amount || 0,
  };
}

/**
 * Decide node - Determines next action based on state
 */
function decideNext(state: WriteTestFixStateType): string {
  // Check completion conditions
  if (state.testsPassing) {
    return "complete";
  }

  if (state.iteration >= state.maxIterations) {
    return "max_iterations";
  }

  if (state.costIncurred >= state.budgetLimit) {
    return "budget_exceeded";
  }

  // Continue to diagnose and fix
  return "continue";
}

/**
 * Complete node - Marks task as successfully completed
 */
async function completeNode(
  state: WriteTestFixStateType
): Promise<Partial<WriteTestFixStateType>> {
  console.log(`[Complete] Task completed successfully after ${state.iteration} iteration(s)`);

  return {
    completed: true,
    completionReason: "All tests passing",
    messages: [
      {
        role: "assistant",
        content: `Task completed successfully!\n\nSummary:\n- Iterations: ${state.iteration}\n- Files changed: ${state.pendingChanges.length}\n- Tests passed: ${state.testResults.filter(t => t.passed).length}\n- Total cost: $${state.costIncurred.toFixed(4)}`,
      },
    ],
  };
}

/**
 * Fail node - Marks task as failed
 */
async function failNode(
  state: WriteTestFixStateType
): Promise<Partial<WriteTestFixStateType>> {
  const reason =
    state.iteration >= state.maxIterations
      ? `Max iterations (${state.maxIterations}) reached`
      : `Budget exceeded ($${state.budgetLimit})`;

  console.log(`[Fail] Task failed: ${reason}`);

  return {
    completed: true,
    completionReason: reason,
    messages: [
      {
        role: "assistant",
        content: `Task failed: ${reason}\n\nLast state:\n- Iterations: ${state.iteration}\n- Tests passing: ${state.testsPassing}\n- Failing tests: ${state.testResults.filter(t => !t.passed).map(t => t.name).join(', ')}\n- Total cost: $${state.costIncurred.toFixed(4)}`,
      },
    ],
  };
}

/**
 * Build the Write-Test-Fix graph
 */
export function buildWriteTestFixGraph() {
  const workflow = new StateGraph(WriteTestFixState)
    // Add nodes
    .addNode("plan", planNode)
    .addNode("write", writeNode)
    .addNode("test", testNode)
    .addNode("diagnose", diagnoseNode)
    .addNode("fix", fixNode)
    .addNode("complete", completeNode)
    .addNode("fail", failNode)

    // Entry point
    .addEdge(START, "plan")

    // Plan -> Write
    .addEdge("plan", "write")

    // Write -> Test
    .addEdge("write", "test")

    // Test -> Conditional routing
    .addConditionalEdges("test", decideNext, {
      complete: "complete",
      max_iterations: "fail",
      budget_exceeded: "fail",
      continue: "diagnose",
    })

    // Diagnose -> Fix
    .addEdge("diagnose", "fix")

    // Fix -> Write (loop back to test, not write)
    .addEdge("fix", "test")

    // Terminal nodes
    .addEdge("complete", END)
    .addEdge("fail", END);

  return workflow.compile();
}

/**
 * Execute the Write-Test-Fix cycle
 */
export async function executeWriteTestFix(
  taskId: string,
  taskDescription: string,
  acceptanceCriteria: string[],
  options: {
    maxIterations?: number;
    budgetLimit?: number;
    provider?: AgentProvider;
    workspace?: string;
    runId?: string;
  } = {}
): Promise<WriteTestFixStateType> {
  // Set configuration
  setWriteTestFixConfig({
    provider: options.provider || 'claude',
    workspace: options.workspace || `${WORKSPACE_BASE}/${taskId}`,
    runId: options.runId || taskId,
  });

  const graph = buildWriteTestFixGraph();

  const initialState: Partial<WriteTestFixStateType> = {
    taskId,
    taskDescription,
    acceptanceCriteria,
    maxIterations: options.maxIterations ?? 5,
    budgetLimit: options.budgetLimit ?? 10.0,
  };

  console.log(`[WriteTestFix] Starting execution for task: ${taskId}`);
  console.log(`[WriteTestFix] Config: provider=${currentConfig.provider}, maxIterations=${options.maxIterations ?? 5}, budget=$${options.budgetLimit ?? 10}`);

  const result = await graph.invoke(initialState);

  console.log(`[WriteTestFix] Execution complete: ${result.completed ? 'SUCCESS' : 'FAILED'} - ${result.completionReason}`);

  return result as WriteTestFixStateType;
}
