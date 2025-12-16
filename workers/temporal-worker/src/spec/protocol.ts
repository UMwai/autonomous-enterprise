/**
 * Living Specification Protocol
 *
 * Defines the structure and management of living specifications that evolve
 * throughout the autonomous coding process. The spec tracks mission context,
 * error registry, directives, and execution phases.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Phase of execution in the autonomous coding lifecycle
 */
export type ExecutionPhase =
  | 'planning'
  | 'implementation'
  | 'testing'
  | 'refinement'
  | 'deployment'
  | 'monitoring'
  | 'complete';

/**
 * Directive priority levels
 */
export type DirectivePriority = 'critical' | 'high' | 'medium' | 'low';

/**
 * Individual directive
 */
export interface Directive {
  id: string;
  content: string;
  priority: DirectivePriority;
  addedAt: string;
  appliedAt?: string;
  source?: string; // Where the directive came from (user, agent, system)
}

/**
 * Mission log entry
 */
export interface MissionLogEntry {
  timestamp: string;
  phase: ExecutionPhase;
  action: string;
  agent?: string; // Which agent performed the action
  outcome?: 'success' | 'failure' | 'partial';
  details?: string;
}

/**
 * Error registry entry
 */
export interface ErrorEntry {
  id: string;
  timestamp: string;
  phase: ExecutionPhase;
  error: string;
  context?: string;
  resolution?: string;
  preventionStrategy?: string;
}

/**
 * Living Specification
 *
 * A dynamic specification that evolves throughout the development process,
 * tracking context, errors, and progress.
 */
export interface LivingSpec {
  /** Specification version for migration support */
  version: string;

  /** Project metadata */
  project: {
    name: string;
    description: string;
    repository?: string;
    createdAt: string;
    updatedAt: string;
  };

  /** Core directives that guide agent behavior */
  directives: Directive[];

  /** Mission log tracking all significant actions */
  missionLog: MissionLogEntry[];

  /** Error registry for learning from mistakes */
  errorRegistry: ErrorEntry[];

  /** Current execution phase */
  currentPhase: ExecutionPhase;

  /** Phase history */
  phaseHistory: Array<{
    phase: ExecutionPhase;
    startedAt: string;
    completedAt?: string;
  }>;

  /** Goals and objectives */
  goals: {
    primary: string[];
    secondary?: string[];
    completed?: string[];
  };

  /** Success criteria */
  successCriteria?: {
    criterion: string;
    met: boolean;
    verifiedAt?: string;
  }[];

  /** Agent preferences and configuration */
  agentConfig?: {
    preferredAgent?: 'claude' | 'gemini' | 'opencode';
    tokenBudget?: number;
    maxCostPerRun?: number;
    timeout?: number;
  };

  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Specification Manager
 *
 * Handles loading, saving, and updating living specifications.
 */
export class SpecManager {
  private static readonly SPEC_FILENAME = 'spec.json';
  private static readonly CURRENT_VERSION = '1.0.0';

  /**
   * Load specification from project directory
   */
  async load(projectPath: string): Promise<LivingSpec> {
    const specPath = join(projectPath, SpecManager.SPEC_FILENAME);

    if (!existsSync(specPath)) {
      throw new Error(`Specification not found at ${specPath}`);
    }

    try {
      const content = await readFile(specPath, 'utf-8');
      const spec = JSON.parse(content) as LivingSpec;

      // Validate spec version
      if (spec.version !== SpecManager.CURRENT_VERSION) {
        // Could implement migration logic here
        console.warn(
          `Spec version ${spec.version} differs from current ${SpecManager.CURRENT_VERSION}`
        );
      }

      return spec;
    } catch (error) {
      throw new Error(
        `Failed to load specification: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Save specification to project directory
   */
  async save(projectPath: string, spec: LivingSpec): Promise<void> {
    const specPath = join(projectPath, SpecManager.SPEC_FILENAME);

    try {
      // Ensure directory exists
      const dir = dirname(specPath);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }

      // Update timestamp
      spec.project.updatedAt = new Date().toISOString();

      // Write spec
      const content = JSON.stringify(spec, null, 2);
      await writeFile(specPath, content, 'utf-8');
    } catch (error) {
      throw new Error(
        `Failed to save specification: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Create a new specification
   */
  async create(projectPath: string, config: {
    name: string;
    description: string;
    repository?: string;
    goals: string[];
    directives?: string[];
  }): Promise<LivingSpec> {
    const now = new Date().toISOString();

    const spec: LivingSpec = {
      version: SpecManager.CURRENT_VERSION,
      project: {
        name: config.name,
        description: config.description,
        repository: config.repository,
        createdAt: now,
        updatedAt: now,
      },
      directives: (config.directives || []).map((content, index) => ({
        id: `dir-${index + 1}`,
        content,
        priority: 'medium',
        addedAt: now,
        source: 'user',
      })),
      missionLog: [],
      errorRegistry: [],
      currentPhase: 'planning',
      phaseHistory: [
        {
          phase: 'planning',
          startedAt: now,
        },
      ],
      goals: {
        primary: config.goals,
      },
    };

    await this.save(projectPath, spec);
    return spec;
  }

  /**
   * Append entry to mission log
   */
  async appendMissionLog(
    projectPath: string,
    entry: Omit<MissionLogEntry, 'timestamp'>
  ): Promise<void> {
    const spec = await this.load(projectPath);

    spec.missionLog.push({
      ...entry,
      timestamp: new Date().toISOString(),
    });

    await this.save(projectPath, spec);
  }

  /**
   * Append error to registry
   */
  async appendError(
    projectPath: string,
    error: Omit<ErrorEntry, 'id' | 'timestamp'>
  ): Promise<void> {
    const spec = await this.load(projectPath);

    const errorId = `err-${spec.errorRegistry.length + 1}`;
    spec.errorRegistry.push({
      id: errorId,
      timestamp: new Date().toISOString(),
      ...error,
    });

    await this.save(projectPath, spec);
  }

  /**
   * Add directive
   */
  async addDirective(
    projectPath: string,
    directive: Omit<Directive, 'id' | 'addedAt'>
  ): Promise<void> {
    const spec = await this.load(projectPath);

    const directiveId = `dir-${spec.directives.length + 1}`;
    spec.directives.push({
      id: directiveId,
      addedAt: new Date().toISOString(),
      ...directive,
    });

    await this.save(projectPath, spec);
  }

  /**
   * Mark directive as applied
   */
  async markDirectiveApplied(projectPath: string, directiveId: string): Promise<void> {
    const spec = await this.load(projectPath);

    const directive = spec.directives.find((d) => d.id === directiveId);
    if (directive) {
      directive.appliedAt = new Date().toISOString();
      await this.save(projectPath, spec);
    }
  }

  /**
   * Update current phase
   */
  async updatePhase(projectPath: string, newPhase: ExecutionPhase): Promise<void> {
    const spec = await this.load(projectPath);

    if (spec.currentPhase !== newPhase) {
      // Mark current phase as completed
      const currentPhaseEntry = spec.phaseHistory.find(
        (p) => p.phase === spec.currentPhase && !p.completedAt
      );
      if (currentPhaseEntry) {
        currentPhaseEntry.completedAt = new Date().toISOString();
      }

      // Start new phase
      spec.currentPhase = newPhase;
      spec.phaseHistory.push({
        phase: newPhase,
        startedAt: new Date().toISOString(),
      });

      await this.save(projectPath, spec);
    }
  }

  /**
   * Mark goal as completed
   */
  async completeGoal(projectPath: string, goal: string): Promise<void> {
    const spec = await this.load(projectPath);

    // Find goal in primary or secondary
    const primaryIndex = spec.goals.primary.indexOf(goal);
    const secondaryIndex = spec.goals.secondary?.indexOf(goal) ?? -1;

    if (primaryIndex !== -1) {
      spec.goals.primary.splice(primaryIndex, 1);
    } else if (secondaryIndex !== -1) {
      spec.goals.secondary?.splice(secondaryIndex, 1);
    }

    // Add to completed
    if (!spec.goals.completed) {
      spec.goals.completed = [];
    }
    if (!spec.goals.completed.includes(goal)) {
      spec.goals.completed.push(goal);
    }

    await this.save(projectPath, spec);
  }

  /**
   * Update success criteria
   */
  async updateSuccessCriteria(
    projectPath: string,
    criterion: string,
    met: boolean
  ): Promise<void> {
    const spec = await this.load(projectPath);

    if (!spec.successCriteria) {
      spec.successCriteria = [];
    }

    const existing = spec.successCriteria.find((c) => c.criterion === criterion);
    if (existing) {
      existing.met = met;
      if (met) {
        existing.verifiedAt = new Date().toISOString();
      }
    } else {
      spec.successCriteria.push({
        criterion,
        met,
        verifiedAt: met ? new Date().toISOString() : undefined,
      });
    }

    await this.save(projectPath, spec);
  }

  /**
   * Get recent mission log entries
   */
  async getRecentMissionLog(projectPath: string, count = 10): Promise<MissionLogEntry[]> {
    const spec = await this.load(projectPath);
    return spec.missionLog.slice(-count);
  }

  /**
   * Get recent errors
   */
  async getRecentErrors(projectPath: string, count = 5): Promise<ErrorEntry[]> {
    const spec = await this.load(projectPath);
    return spec.errorRegistry.slice(-count);
  }

  /**
   * Get active directives (not yet applied)
   */
  async getActiveDirectives(projectPath: string): Promise<Directive[]> {
    const spec = await this.load(projectPath);
    return spec.directives
      .filter((d) => !d.appliedAt)
      .sort((a, b) => {
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });
  }
}
