/**
 * Sandbox (E2B) Temporal activities
 *
 * This module provides secure code execution through E2B sandboxes
 * and the LangGraph write-test-fix loop.
 */

// E2B Sandbox exports
export { E2BSandbox } from './e2b.js';
export type {
  SandboxSession,
  ExecutionResult,
  FileUpload,
  DownloadedFile,
  ResourceLimits,
} from './e2b.js';

// Safe execution exports
export { safeExecuteCode, safeExecuteBatch } from './safeExecute.js';
export type { SafeExecuteInput, SafeExecuteResult } from './safeExecute.js';

/**
 * LangGraph loop input
 */
export interface LangGraphLoopInput {
  specification: any;
  task_graph?: any;
  repository_path: string;
  max_iterations: number;
}

/**
 * LangGraph loop result
 */
export interface LangGraphLoopResult {
  files_generated: number;
  lines_of_code: number;
  iterations: number;
  success: boolean;
}

/**
 * Run LangGraph write-test-fix loop
 *
 * This activity orchestrates the iterative code generation process:
 * 1. Plan - Analyze the task and create implementation plan
 * 2. Write - Generate code using CLI agent
 * 3. Test - Run tests in E2B sandbox
 * 4. Diagnose - Analyze failures if any
 * 5. Fix - Apply fixes and repeat
 */
export async function runLangGraphLoop(input: LangGraphLoopInput): Promise<LangGraphLoopResult> {
  const { executeWriteTestFix } = await import('../../../langgraph/graphs/writeTestFix.js');

  // Extract task description from specification
  const taskDescription = typeof input.specification === 'string'
    ? input.specification
    : input.specification?.description || input.specification?.name || 'Implement the product';

  // Extract acceptance criteria from task graph or specification
  const acceptanceCriteria = input.task_graph?.tasks?.map((t: { title?: string; description?: string }) =>
    t.title || t.description || 'Complete task'
  ) || input.specification?.features?.map((f: string | { name?: string }) =>
    typeof f === 'string' ? f : f.name || 'Implement feature'
  ) || ['Code compiles', 'Tests pass', 'Linting passes'];

  // Execute the LangGraph workflow
  const result = await executeWriteTestFix(
    `task-${Date.now()}`,
    taskDescription,
    acceptanceCriteria,
    {
      maxIterations: input.max_iterations,
      workspace: input.repository_path,
      provider: 'claude',
      budgetLimit: 10.0,
    }
  );

  // Count files and lines from the result
  const filesGenerated = Object.keys(result.currentFiles || {}).length;
  const linesOfCode = Object.values(result.currentFiles || {})
    .reduce((sum, content) => sum + (content?.split('\n').length || 0), 0);

  return {
    files_generated: filesGenerated,
    lines_of_code: linesOfCode,
    iterations: result.iteration || 1,
    success: result.testsPassing || false,
  };
}
