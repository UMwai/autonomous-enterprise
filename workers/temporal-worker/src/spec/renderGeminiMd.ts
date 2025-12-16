/**
 * GEMINI.md Renderer
 *
 * Generates GEMINI.md content from a living specification.
 * This file is injected into the project directory to provide
 * Gemini CLI with mission context, directives, and analysis focus.
 */

import type { LivingSpec, ExecutionPhase } from './protocol.js';

/**
 * Render GEMINI.md content from living specification
 */
export function renderGeminiMd(spec: LivingSpec): string {
  const sections: string[] = [];

  // Header
  sections.push(`# ${spec.project.name} - Gemini Analysis Context`);
  sections.push('');
  sections.push(`${spec.project.description}`);
  sections.push('');
  sections.push(`**Phase:** ${formatPhase(spec.currentPhase)} | **Updated:** ${new Date(spec.project.updatedAt).toLocaleDateString()}`);
  sections.push('');
  sections.push('---');
  sections.push('');

  // Analysis Focus
  sections.push('## Analysis Focus');
  sections.push('');
  sections.push(getAnalysisFocus(spec.currentPhase));
  sections.push('');
  sections.push('---');
  sections.push('');

  // Objectives
  sections.push('## Project Objectives');
  sections.push('');
  sections.push('### Active Goals');
  sections.push('');
  if (spec.goals.primary.length > 0) {
    for (const goal of spec.goals.primary) {
      sections.push(`1. ${goal}`);
    }
  } else {
    sections.push('*No active primary goals*');
  }
  sections.push('');

  if (spec.goals.secondary && spec.goals.secondary.length > 0) {
    sections.push('### Secondary Objectives');
    sections.push('');
    for (const goal of spec.goals.secondary) {
      sections.push(`- ${goal}`);
    }
    sections.push('');
  }

  if (spec.goals.completed && spec.goals.completed.length > 0) {
    sections.push('### Completed');
    sections.push('');
    for (const goal of spec.goals.completed) {
      sections.push(`- ✓ ${goal}`);
    }
    sections.push('');
  }

  sections.push('---');
  sections.push('');

  // Key Directives
  const activeDirectives = spec.directives.filter((d) => !d.appliedAt);
  if (activeDirectives.length > 0) {
    sections.push('## Key Directives');
    sections.push('');
    sections.push('Consider these constraints and preferences:');
    sections.push('');

    // Group by priority
    const critical = activeDirectives.filter((d) => d.priority === 'critical');
    const high = activeDirectives.filter((d) => d.priority === 'high');
    const others = activeDirectives.filter((d) => d.priority !== 'critical' && d.priority !== 'high');

    if (critical.length > 0) {
      sections.push('**Critical:**');
      for (const directive of critical) {
        sections.push(`- ${directive.content}`);
      }
      sections.push('');
    }

    if (high.length > 0) {
      sections.push('**High Priority:**');
      for (const directive of high) {
        sections.push(`- ${directive.content}`);
      }
      sections.push('');
    }

    if (others.length > 0) {
      sections.push('**Additional:**');
      for (const directive of others) {
        sections.push(`- ${directive.content}`);
      }
      sections.push('');
    }

    sections.push('---');
    sections.push('');
  }

  // Known Issues & Lessons
  if (spec.errorRegistry.length > 0) {
    sections.push('## Known Issues & Lessons Learned');
    sections.push('');
    sections.push('Be aware of these issues from previous iterations:');
    sections.push('');

    // Show last 3 errors with prevention strategies
    const recentErrors = spec.errorRegistry.slice(-3);
    for (const error of recentErrors) {
      sections.push(`**${formatPhase(error.phase)} Phase:**`);
      sections.push(`- Issue: ${error.error}`);
      if (error.preventionStrategy) {
        sections.push(`- Strategy: ${error.preventionStrategy}`);
      }
      sections.push('');
    }

    sections.push('---');
    sections.push('');
  }

  // Context Files
  sections.push('## Recommended Context Files');
  sections.push('');
  sections.push(getRecommendedFiles(spec.currentPhase));
  sections.push('');
  sections.push('Use `@filename` syntax to include these files in your analysis.');
  sections.push('');
  sections.push('---');
  sections.push('');

  // Analysis Guidelines
  sections.push('## Analysis Guidelines');
  sections.push('');
  sections.push('When analyzing this project:');
  sections.push('');
  sections.push('1. **Focus on Large Context:** Leverage your 1M+ token context window');
  sections.push('2. **Deep Analysis:** Provide comprehensive insights, not just surface-level observations');
  sections.push('3. **Code Quality:** Evaluate architecture, patterns, and maintainability');
  sections.push('4. **Recommendations:** Suggest improvements with clear rationale');
  sections.push('5. **Examples:** Provide concrete code examples when suggesting changes');
  sections.push('6. **Trade-offs:** Explain pros and cons of different approaches');
  sections.push('');
  sections.push('---');
  sections.push('');

  // Success Criteria
  if (spec.successCriteria && spec.successCriteria.length > 0) {
    sections.push('## Success Criteria');
    sections.push('');
    sections.push('Evaluate the project against these criteria:');
    sections.push('');

    for (const criterion of spec.successCriteria) {
      const status = criterion.met ? '✓' : '○';
      sections.push(`${status} ${criterion.criterion}`);
    }
    sections.push('');

    sections.push('---');
    sections.push('');
  }

  // Phase Roadmap
  sections.push('## Phase Roadmap');
  sections.push('');
  sections.push(getPhaseRoadmap(spec.currentPhase));
  sections.push('');
  sections.push('---');
  sections.push('');

  // Footer
  sections.push('## Notes');
  sections.push('');
  sections.push('- This file is auto-generated from the living specification');
  sections.push('- Gemini excels at large-scale codebase analysis and exploration');
  sections.push('- Use your strengths: deep analysis, pattern recognition, comprehensive reviews');
  sections.push('- Complement Claude Code implementation with strategic guidance');
  sections.push('');

  return sections.join('\n');
}

/**
 * Format execution phase
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
 * Get analysis focus based on phase
 */
function getAnalysisFocus(phase: ExecutionPhase): string {
  const focuses: Record<ExecutionPhase, string> = {
    planning: `**Strategic Architecture & Design Review**

Analyze the project requirements and provide:
- High-level architecture recommendations
- Technology stack evaluation
- Design pattern suggestions
- Scalability considerations
- Security architecture review
- Integration strategy analysis

Your large context window is ideal for understanding the full scope and dependencies.`,

    implementation: `**Code Quality & Pattern Analysis**

Review implementation and provide:
- Code quality assessment across the entire codebase
- Design pattern compliance
- Best practices adherence
- Potential refactoring opportunities
- Code organization suggestions
- Performance considerations

Analyze the big picture - how components interact and fit together.`,

    testing: `**Comprehensive Test Coverage Analysis**

Evaluate testing strategy and provide:
- Test coverage assessment
- Missing test scenarios
- Edge case identification
- Integration test recommendations
- Test quality and maintainability
- Performance test suggestions

Identify gaps that might be missed in isolated reviews.`,

    refinement: `**Deep Optimization & Quality Review**

Analyze for optimization opportunities:
- Performance bottlenecks
- Memory usage optimization
- Code complexity reduction
- Documentation improvements
- Technical debt assessment
- API design refinement

Use your analytical strength to find subtle issues.`,

    deployment: `**Production Readiness Assessment**

Evaluate deployment preparedness:
- Configuration management review
- Infrastructure requirements
- Deployment strategy analysis
- Rollback procedures
- Monitoring and observability setup
- Security hardening checklist

Ensure nothing is overlooked before production.`,

    monitoring: `**System Health & Metrics Analysis**

Analyze operational aspects:
- Monitoring coverage
- Alert strategy evaluation
- Log analysis patterns
- Performance metrics review
- Incident response procedures
- Continuous improvement opportunities

Help establish robust operational practices.`,

    complete: `**Final Comprehensive Review**

Provide a complete project assessment:
- Achievement of objectives
- Code quality summary
- Technical debt overview
- Recommended next steps
- Documentation completeness
- Knowledge transfer materials

Deliver a thorough project retrospective.`,
  };

  return focuses[phase];
}

/**
 * Get recommended context files based on phase
 */
function getRecommendedFiles(phase: ExecutionPhase): string {
  const recommendations: Record<ExecutionPhase, string> = {
    planning: `- README.md
- package.json / requirements.txt / go.mod (dependency files)
- Architecture diagrams or docs
- API specifications (OpenAPI, GraphQL schemas)
- Database schemas`,

    implementation: `- src/** (all source files)
- tests/** (test files)
- package.json / requirements.txt (dependencies)
- tsconfig.json / babel.config.js (build configs)
- Key component and service files`,

    testing: `- tests/** (all test files)
- src/** (source files being tested)
- jest.config.js / pytest.ini (test configs)
- Coverage reports
- CI/CD test configurations`,

    refinement: `- src/** (source code)
- Performance profiling results
- Documentation files
- Code review comments
- Technical debt tracking`,

    deployment: `- Dockerfile / docker-compose.yml
- kubernetes/*.yaml (k8s configs)
- .github/workflows/* (CI/CD)
- infrastructure/ (IaC files)
- deployment scripts`,

    monitoring: `- Observability configs (prometheus, grafana)
- Logging configurations
- Alert definitions
- Monitoring dashboards
- SLO/SLA definitions`,

    complete: `- All documentation
- Final architecture diagrams
- Deployment guides
- Runbooks
- Retrospective notes`,
  };

  return recommendations[phase];
}

/**
 * Get phase roadmap showing progress
 */
function getPhaseRoadmap(currentPhase: ExecutionPhase): string {
  const phases: ExecutionPhase[] = [
    'planning',
    'implementation',
    'testing',
    'refinement',
    'deployment',
    'monitoring',
    'complete',
  ];

  const currentIndex = phases.indexOf(currentPhase);
  const roadmap: string[] = [];

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    let marker = '○';

    if (i < currentIndex) {
      marker = '✓';
    } else if (i === currentIndex) {
      marker = '→';
    }

    roadmap.push(`${marker} ${formatPhase(phase)}`);
  }

  return roadmap.join('\n');
}

/**
 * Render a minimal GEMINI.md for projects without a spec
 */
export function renderMinimalGeminiMd(projectName: string, prompt: string): string {
  return `# ${projectName} - Gemini Analysis Context

## Analysis Task

${prompt}

## Your Strengths

Leverage your capabilities for:
- Large-scale codebase analysis (1M+ token context)
- Deep architectural insights
- Comprehensive pattern recognition
- Strategic recommendations
- Trade-off analysis

## Approach

1. Analyze the complete codebase context
2. Identify patterns and architectural decisions
3. Evaluate quality and maintainability
4. Provide actionable recommendations
5. Explain trade-offs clearly

---

*This is a minimal context file. For detailed guidance, create a full living specification.*
`;
}
