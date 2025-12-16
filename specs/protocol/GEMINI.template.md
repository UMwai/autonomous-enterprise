# {{project_name}} - Gemini Context

> Auto-generated context file for Gemini CLI execution.
> Version: {{version}} | Generated: {{last_updated}}

## Quick Reference

| Key | Value |
|-----|-------|
| Project | {{project_name}} |
| Phase | {{current_phase}} |
| Stack | {{tech_stack.frontend}} / {{tech_stack.backend}} |

## Active Directives

{{#each directives}}
1. {{this}}
{{/each}}

## Current Objective

{{active_task}}

## Context Summary

{{context_summary}}

## Recent Changes

{{#each recent_changes}}
- `{{this.file}}`: {{this.description}}
{{/each}}

## Known Issues

{{#each error_registry}}
- [{{this.type}}] {{this.message}}
{{/each}}

## Commands

```bash
# Development
{{dev_command}}

# Testing
{{test_command}}

# Build
{{build_command}}
```

## Important Files

{{#each important_files}}
- `{{this.path}}` - {{this.description}}
{{/each}}

---
*Auto-managed by Autonomous Enterprise*
