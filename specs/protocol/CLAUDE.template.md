# {{project_name}} - Living Specification

> Auto-generated specification for Claude Code execution context.
> Version: {{version}} | Last Updated: {{last_updated}}

## Project Overview

**Name:** {{project_name}}
**Tagline:** {{tagline}}
**Status:** {{status}}

## Directives

{{#each directives}}
- {{this}}
{{/each}}

## Technical Stack

- **Frontend:** {{tech_stack.frontend}}
- **Backend:** {{tech_stack.backend}}
- **Database:** {{tech_stack.database}}
- **Hosting:** {{tech_stack.hosting}}

## Architecture

{{architecture_overview}}

## Current Phase

**Phase:** {{current_phase}}
**Active Task:** {{active_task}}

## Mission Log

{{#each mission_log}}
### {{this.timestamp}}
{{this.entry}}

{{/each}}

## Error Registry

{{#if error_registry}}
{{#each error_registry}}
### Error {{@index}}
- **Time:** {{this.timestamp}}
- **Type:** {{this.type}}
- **Message:** {{this.message}}
- **Resolution:** {{this.resolution}}

{{/each}}
{{else}}
No errors recorded.
{{/if}}

## File Structure

```
{{directory_structure}}
```

## API Endpoints

{{#each api_endpoints}}
### {{this.method}} {{this.path}}
{{this.description}}

{{/each}}

## Environment Variables

{{#each environment_variables}}
- `{{this}}`
{{/each}}

## Testing

- Run tests: `{{test_command}}`
- Lint: `{{lint_command}}`
- Build: `{{build_command}}`

## Deployment

- Deploy command: `{{deploy_command}}`
- Production URL: {{deployment_url}}

---

*This specification is automatically updated by the Autonomous Enterprise system.*
