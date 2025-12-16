/**
 * CLAUDE.md Renderer
 *
 * Generates CLAUDE.md content from a living specification.
 * This file is injected into the project directory to provide
 * Claude Code with mission context, directives, and error history.
 */

import type { LivingSpec, ExecutionPhase } from './protocol.js';

/**
 * Render CLAUDE.md content from living specification
 */
export function renderClaudeMd(spec: LivingSpec): string {
  const sections: string[] = [];

  // Header
  sections.push(`# ${spec.project.name} - Claude Code Instructions`);
  sections.push('');
  sections.push(`> ${spec.project.description}`);
  sections.push('');
  sections.push(`**Current Phase:** ${formatPhase(spec.currentPhase)}`);
  sections.push(`**Last Updated:** ${new Date(spec.project.updatedAt).toLocaleString()}`);
  sections.push('');
  sections.push('---');
  sections.push('');

  // Mission Overview
  sections.push('## Mission Overview');
  sections.push('');
  sections.push('### Primary Goals');
  sections.push('');
  for (const goal of spec.goals.primary) {
    sections.push(`- [ ] ${goal}`);
  }
  sections.push('');

  if (spec.goals.secondary && spec.goals.secondary.length > 0) {
    sections.push('### Secondary Goals');
    sections.push('');
    for (const goal of spec.goals.secondary) {
      sections.push(`- [ ] ${goal}`);
    }
    sections.push('');
  }

  if (spec.goals.completed && spec.goals.completed.length > 0) {
    sections.push('### Completed Goals');
    sections.push('');
    for (const goal of spec.goals.completed) {
      sections.push(`- [x] ${goal}`);
    }
    sections.push('');
  }

  sections.push('---');
  sections.push('');

  // Core Directives
  sections.push('## Core Directives');
  sections.push('');
  sections.push('Follow these directives in order of priority:');
  sections.push('');

  // Group directives by priority
  const directivesByPriority = {
    critical: spec.directives.filter((d) => d.priority === 'critical' && !d.appliedAt),
    high: spec.directives.filter((d) => d.priority === 'high' && !d.appliedAt),
    medium: spec.directives.filter((d) => d.priority === 'medium' && !d.appliedAt),
    low: spec.directives.filter((d) => d.priority === 'low' && !d.appliedAt),
  };

  for (const [priority, directives] of Object.entries(directivesByPriority)) {
    if (directives.length > 0) {
      sections.push(`### ${capitalize(priority)} Priority`);
      sections.push('');
      for (const directive of directives) {
        sections.push(`- **[${directive.id}]** ${directive.content}`);
      }
      sections.push('');
    }
  }

  sections.push('---');
  sections.push('');

  // Error Registry (Learning from Mistakes)
  if (spec.errorRegistry.length > 0) {
    sections.push('## Error Registry - Learn from These Mistakes');
    sections.push('');
    sections.push('Avoid these errors encountered in previous runs:');
    sections.push('');

    // Show last 5 errors
    const recentErrors = spec.errorRegistry.slice(-5);
    for (const error of recentErrors) {
      sections.push(`### ${error.id} - ${formatPhase(error.phase)}`);
      sections.push('');
      sections.push(`**Error:** ${error.error}`);
      if (error.context) {
        sections.push(`**Context:** ${error.context}`);
      }
      if (error.resolution) {
        sections.push(`**Resolution:** ${error.resolution}`);
      }
      if (error.preventionStrategy) {
        sections.push(`**Prevention:** ${error.preventionStrategy}`);
      }
      sections.push('');
    }

    sections.push('---');
    sections.push('');
  }

  // Recent Mission Log
  if (spec.missionLog.length > 0) {
    sections.push('## Recent Mission Log');
    sections.push('');
    sections.push('Recent actions and outcomes:');
    sections.push('');

    // Show last 10 entries
    const recentLog = spec.missionLog.slice(-10);
    for (const entry of recentLog) {
      const timestamp = new Date(entry.timestamp).toLocaleString();
      const outcome = entry.outcome ? ` [${entry.outcome.toUpperCase()}]` : '';
      const agent = entry.agent ? ` (${entry.agent})` : '';

      sections.push(`- **${timestamp}** [${formatPhase(entry.phase)}]${agent}: ${entry.action}${outcome}`);
      if (entry.details) {
        sections.push(`  ${entry.details}`);
      }
    }
    sections.push('');

    sections.push('---');
    sections.push('');
  }

  // Phase Context
  sections.push('## Current Phase Context');
  sections.push('');
  sections.push(getPhaseContext(spec.currentPhase));
  sections.push('');

  sections.push('---');
  sections.push('');

  // Success Criteria
  if (spec.successCriteria && spec.successCriteria.length > 0) {
    sections.push('## Success Criteria');
    sections.push('');
    sections.push('Verify these criteria before marking work as complete:');
    sections.push('');

    for (const criterion of spec.successCriteria) {
      const checkbox = criterion.met ? '[x]' : '[ ]';
      const verified = criterion.verifiedAt
        ? ` (verified ${new Date(criterion.verifiedAt).toLocaleString()})`
        : '';
      sections.push(`${checkbox} ${criterion.criterion}${verified}`);
    }
    sections.push('');

    sections.push('---');
    sections.push('');
  }

  // Agent Configuration
  if (spec.agentConfig) {
    sections.push('## Agent Configuration');
    sections.push('');
    if (spec.agentConfig.tokenBudget) {
      sections.push(`**Token Budget:** ${spec.agentConfig.tokenBudget.toLocaleString()} tokens per run`);
    }
    if (spec.agentConfig.maxCostPerRun) {
      sections.push(`**Max Cost:** $${spec.agentConfig.maxCostPerRun} per run`);
    }
    if (spec.agentConfig.timeout) {
      sections.push(`**Timeout:** ${spec.agentConfig.timeout / 1000}s`);
    }
    sections.push('');

    sections.push('---');
    sections.push('');
  }

  // Footer
  sections.push('## Important Notes');
  sections.push('');
  sections.push('- This file is auto-generated from spec.json - DO NOT EDIT MANUALLY');
  sections.push('- All changes to mission context should be made through the SpecManager');
  sections.push('- Update mission log after completing significant actions');
  sections.push('- Add to error registry when encountering issues');
  sections.push('');

  return sections.join('\n');
}

/**
 * Format execution phase for display
 */
function formatPhase(phase: ExecutionPhase): string {
  const phaseNames: Record<ExecutionPhase, string> = {
    planning: 'Planning',
    implementation: 'Implementation',
    testing: 'Testing',
    refinement: 'Refinement',
    deployment: 'Deployment',
    monitoring: 'Monitoring',
    complete: 'Complete',
  };
  return phaseNames[phase];
}

/**
 * Capitalize first letter
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Get phase-specific context and guidance
 */
function getPhaseContext(phase: ExecutionPhase): string {
  const contexts: Record<ExecutionPhase, string> = {
    planning: `**Focus:** Design and architecture

You are in the planning phase. Focus on:
- Understanding requirements thoroughly
- Designing system architecture
- Identifying dependencies and integration points
- Creating clear specifications
- Planning implementation phases
- Setting up project structure

Avoid premature implementation. Get the design right first.`,

    implementation: `**Focus:** Building and coding

You are in the implementation phase. Focus on:
- Writing clean, maintainable code
- Following established patterns and conventions
- Implementing features incrementally
- Writing tests alongside code
- Documenting complex logic
- Committing changes frequently with clear messages

Ensure each feature is complete before moving to the next.`,

    testing: `**Focus:** Validation and quality assurance

You are in the testing phase. Focus on:
- Running all test suites
- Testing edge cases and error conditions
- Performing integration testing
- Validating against success criteria
- Fixing bugs and issues
- Ensuring code coverage

Do not skip tests. Quality is critical.`,

    refinement: `**Focus:** Optimization and polish

You are in the refinement phase. Focus on:
- Code review and refactoring
- Performance optimization
- Improving error handling
- Enhancing documentation
- Addressing technical debt
- Final quality checks

Make the code production-ready.`,

    deployment: `**Focus:** Release and delivery

You are in the deployment phase. Focus on:
- Preparing deployment artifacts
- Setting up CI/CD pipelines
- Configuring production environment
- Running pre-deployment checks
- Executing deployment procedures
- Verifying successful deployment

Follow deployment checklists carefully.`,

    monitoring: `**Focus:** Observability and maintenance

You are in the monitoring phase. Focus on:
- Setting up monitoring and alerting
- Tracking key metrics
- Analyzing logs and errors
- Responding to issues
- Planning improvements
- Documenting lessons learned

Ensure system health and stability.`,

    complete: `**Status:** Mission Complete

This phase is complete. All goals have been achieved and success criteria met.
- Verify all deliverables
- Ensure documentation is complete
- Confirm deployment is stable
- Prepare handoff materials`,
  };

  return contexts[phase];
}

/**
 * Render a minimal CLAUDE.md for projects without a spec
 */
export function renderMinimalClaudeMd(projectName: string, prompt: string): string {
  return `# ${projectName} - Claude Code Instructions

## Task

${prompt}

## Guidelines

- Write clean, maintainable code
- Follow best practices and conventions
- Include error handling
- Write tests where appropriate
- Document complex logic
- Commit changes with clear messages

---

*This is a minimal instruction file. For better results, create a full living specification.*
`;
}
