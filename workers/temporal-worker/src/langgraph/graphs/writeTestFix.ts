/**
 * LangGraph implementation of the Write → Test → Diagnose → Fix cycle.
 */

import { StateGraph, END, START } from "@langchain/langgraph";
import {
  WriteTestFixState,
  WriteTestFixStateType,
  FileChange,
  TestResult,
  Diagnostic,
} from "../state.js";

/**
 * Plan node - Creates implementation plan from task description
 */
async function planNode(
  state: WriteTestFixStateType
): Promise<Partial<WriteTestFixStateType>> {
  console.log(`[Plan] Starting planning for task: ${state.taskId}`);

  // This would call the model router to get an appropriate model
  // and generate an implementation plan
  const planMessage = {
    role: "assistant",
    content: `Planning implementation for: ${state.taskDescription}`,
  };

  return {
    messages: [planMessage],
    iteration: state.iteration + 1,
  };
}

/**
 * Write node - Generates or modifies code based on plan/diagnostics
 */
async function writeNode(
  state: WriteTestFixStateType
): Promise<Partial<WriteTestFixStateType>> {
  console.log(`[Write] Iteration ${state.iteration}: Generating code`);

  // In real implementation, this would:
  // 1. Call model router for appropriate model
  // 2. Generate code changes based on task and any diagnostics
  // 3. Apply changes to workspace

  const changes: FileChange[] = [
    {
      path: "src/index.ts",
      operation: "create",
      content: "// Generated code placeholder",
    },
  ];

  return {
    pendingChanges: changes,
    messages: [
      {
        role: "assistant",
        content: `Generated ${changes.length} file changes`,
      },
    ],
  };
}

/**
 * Test node - Runs tests and collects results
 */
async function testNode(
  state: WriteTestFixStateType
): Promise<Partial<WriteTestFixStateType>> {
  console.log(`[Test] Running tests for iteration ${state.iteration}`);

  // In real implementation, this would:
  // 1. Run tests in sandbox (E2B)
  // 2. Collect test results
  // 3. Parse output for failures

  const testResults: TestResult[] = [
    {
      name: "example.test.ts",
      passed: state.iteration >= 2, // Simulate passing after fixes
      duration: 150,
      error: state.iteration < 2 ? "Expected true but got false" : undefined,
    },
  ];

  const allPassing = testResults.every((r) => r.passed);

  return {
    testResults,
    testsPassing: allPassing,
    messages: [
      {
        role: "assistant",
        content: `Tests ${allPassing ? "PASSED" : "FAILED"}: ${testResults.filter((r) => r.passed).length}/${testResults.length}`,
      },
    ],
  };
}

/**
 * Diagnose node - Analyzes failures and generates diagnostics
 */
async function diagnoseNode(
  state: WriteTestFixStateType
): Promise<Partial<WriteTestFixStateType>> {
  console.log(`[Diagnose] Analyzing test failures`);

  const diagnostics: Diagnostic[] = [];

  for (const result of state.testResults) {
    if (!result.passed && result.error) {
      diagnostics.push({
        type: "error",
        message: result.error,
        suggestion: "Review the test expectations and implementation",
      });
    }
  }

  return {
    diagnostics,
    messages: [
      {
        role: "assistant",
        content: `Generated ${diagnostics.length} diagnostics`,
      },
    ],
  };
}

/**
 * Fix node - Applies fixes based on diagnostics
 */
async function fixNode(
  state: WriteTestFixStateType
): Promise<Partial<WriteTestFixStateType>> {
  console.log(`[Fix] Applying fixes based on diagnostics`);

  // In real implementation, this would:
  // 1. Analyze diagnostics
  // 2. Generate targeted fixes
  // 3. Apply fixes to code

  const fixes: FileChange[] = state.diagnostics
    .filter((d) => d.type === "error")
    .map((d, i) => ({
      path: d.file || `src/fix_${i}.ts`,
      operation: "modify" as const,
      content: `// Fix for: ${d.message}`,
    }));

  return {
    pendingChanges: fixes,
    diagnostics: [], // Clear diagnostics after applying fixes
    messages: [
      {
        role: "assistant",
        content: `Applied ${fixes.length} fixes`,
      },
    ],
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
  console.log(`[Complete] Task completed successfully`);

  return {
    completed: true,
    completionReason: "All tests passing",
    messages: [
      {
        role: "assistant",
        content: "Task completed successfully - all tests passing",
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
      ? "Max iterations reached"
      : "Budget exceeded";

  console.log(`[Fail] Task failed: ${reason}`);

  return {
    completed: true,
    completionReason: reason,
    messages: [
      {
        role: "assistant",
        content: `Task failed: ${reason}`,
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

    // Fix -> Write (loop back)
    .addEdge("fix", "write")

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
  } = {}
): Promise<WriteTestFixStateType> {
  const graph = buildWriteTestFixGraph();

  const initialState: Partial<WriteTestFixStateType> = {
    taskId,
    taskDescription,
    acceptanceCriteria,
    maxIterations: options.maxIterations ?? 5,
    budgetLimit: options.budgetLimit ?? 10.0,
  };

  const result = await graph.invoke(initialState);
  return result as WriteTestFixStateType;
}
