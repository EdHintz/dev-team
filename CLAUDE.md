# Dev Team — Project Instructions

All agents in this project inherit these conventions.

## Target Stack
- JavaScript / TypeScript web applications
- Node.js ecosystem (npm/pnpm)
- Common frameworks: React, Next.js, Express, Fastify

## Coding Style
- TypeScript preferred over plain JS
- Use ES modules (`import`/`export`), not CommonJS
- Prefer `const` over `let`; never use `var`
- Use async/await over raw Promises
- Naming: camelCase for variables/functions, PascalCase for types/classes/components
- Files: kebab-case (e.g., `user-service.ts`)

## Commit Format
```
<type>(<scope>): <short summary>

<optional body>

Sprint: <sprint-id>
Task: <task-number>
```
Types: feat, fix, refactor, test, docs, chore

## Testing
- Run existing tests before and after changes: `npm test`
- Write tests for new functionality
- Co-locate test files: `foo.ts` → `foo.test.ts`
- Use the project's existing test framework (jest, vitest, etc.)

## Sprint Context
Each sprint creates a working directory at `sprints/<sprint-id>/`. Agents should read:
- `sprints/<sprint-id>/research.md` — codebase analysis from the researcher agent
- `sprints/<sprint-id>/plan.json` — task breakdown from the planner agent
- `sprints/<sprint-id>/cost.json` — running cost tracker

## Agent Coordination
- Agents are invoked by orchestrator scripts in `scripts/`
- Each agent operates on its own task; do not modify files outside your assigned scope
- Always check `research.md` for existing patterns before introducing new ones
- Prefer editing existing files over creating new ones
