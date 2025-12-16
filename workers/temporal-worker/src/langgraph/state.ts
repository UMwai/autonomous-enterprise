/**
 * LangGraph state management for the Write-Test-Fix cycle.
 */

import { Annotation } from "@langchain/langgraph";

/**
 * File change representation
 */
export interface FileChange {
  path: string;
  operation: "create" | "modify" | "delete";
  content?: string;
  diff?: string;
}

/**
 * Test result representation
 */
export interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  output?: string;
}

/**
 * Build result representation
 */
export interface BuildResult {
  success: boolean;
  output: string;
  errors: string[];
  warnings: string[];
}

/**
 * Diagnostic information
 */
export interface Diagnostic {
  type: "error" | "warning" | "info";
  message: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

/**
 * Shared state for the Write-Test-Fix graph
 */
export const WriteTestFixState = Annotation.Root({
  // Task information
  taskId: Annotation<string>(),
  taskDescription: Annotation<string>(),
  acceptanceCriteria: Annotation<string[]>({
    reducer: (current, update) => update ?? current,
    default: () => [],
  }),

  // Iteration tracking
  iteration: Annotation<number>({
    reducer: (current, update) => update ?? current + 1,
    default: () => 0,
  }),
  maxIterations: Annotation<number>({
    reducer: (current, update) => update ?? current,
    default: () => 5,
  }),

  // Code state
  currentFiles: Annotation<Record<string, string>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({}),
  }),
  pendingChanges: Annotation<FileChange[]>({
    reducer: (current, update) => update ?? current,
    default: () => [],
  }),

  // Test state
  testResults: Annotation<TestResult[]>({
    reducer: (current, update) => update ?? current,
    default: () => [],
  }),
  testsPassing: Annotation<boolean>({
    reducer: (current, update) => update ?? current,
    default: () => false,
  }),

  // Build state
  buildResult: Annotation<BuildResult | null>({
    reducer: (current, update) => update ?? current,
    default: () => null,
  }),

  // Diagnostics
  diagnostics: Annotation<Diagnostic[]>({
    reducer: (current, update) => [...current, ...(update ?? [])],
    default: () => [],
  }),

  // Messages/History
  messages: Annotation<Array<{ role: string; content: string }>>({
    reducer: (current, update) => [...current, ...(update ?? [])],
    default: () => [],
  }),

  // Completion state
  completed: Annotation<boolean>({
    reducer: (current, update) => update ?? current,
    default: () => false,
  }),
  completionReason: Annotation<string>({
    reducer: (current, update) => update ?? current,
    default: () => "",
  }),

  // Budget tracking
  tokensUsed: Annotation<number>({
    reducer: (current, update) => current + (update ?? 0),
    default: () => 0,
  }),
  costIncurred: Annotation<number>({
    reducer: (current, update) => current + (update ?? 0),
    default: () => 0,
  }),
  budgetLimit: Annotation<number>({
    reducer: (current, update) => update ?? current,
    default: () => 10.0,
  }),
});

export type WriteTestFixStateType = typeof WriteTestFixState.State;
