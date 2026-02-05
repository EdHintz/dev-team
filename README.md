# dev-team

An agentic development team powered by Claude Code. Give it a feature spec, get back a PR.

Five specialized agents coordinate through shell scripts and GitHub Projects to plan, implement, review, and test code changes across sprint cycles.

## How It Works

```
Spec → Researcher → Planner → Implementer → Tester → Reviewer → PR
```

1. **You write a spec** describing a feature (see `specs/_template.md`)
2. **Researcher** analyzes your codebase for patterns and context
3. **Planner** breaks the spec into ordered tasks with dependencies
4. **Implementer** writes code for each task
5. **Tester** writes and runs tests
6. **Reviewer** reviews the full diff, requests fixes if needed
7. **A PR is created** with a summary of everything that was done

## Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude`)
- [GitHub CLI](https://cli.github.com/) (`gh`) — authenticated
- Git, Python 3, Bash

## Quick Start

```bash
# 1. Plan a sprint from a spec
./scripts/run-sprint.sh plan specs/examples/sample-auth.md

# 2. Review the generated plan
cat sprints/<sprint-id>/plan.json

# 3. Approve the sprint
./scripts/run-sprint.sh approve <sprint-id>

# 4. Execute all tasks
./scripts/run-sprint.sh run <sprint-id>

# 5. Review + test cycle
./scripts/review-sprint.sh <sprint-id>

# 6. Create PR
./scripts/create-pr.sh <sprint-id>
```

## Commands

| Command | Description |
|---------|-------------|
| `run-sprint.sh plan <spec>` | Plan a sprint from a spec file |
| `run-sprint.sh approve <id>` | Approve a planned sprint |
| `run-sprint.sh run <id>` | Execute sprint tasks |
| `run-sprint.sh status <id>` | Show sprint status |
| `run-sprint.sh fix-pr <pr#>` | Fix PR review comments |
| `run-sprint.sh cost <id>` | Show cost breakdown |
| `review-sprint.sh <id>` | Run review + test cycle |
| `create-pr.sh <id>` | Create PR from sprint branch |

## Autonomy Modes

Control how much human oversight the agents need:

| Mode | Behavior |
|------|----------|
| `supervised` (default) | Pause for approval at every step |
| `semi-auto` | Pause only before commits and PR creation |
| `full-auto` | Run everything without pausing |

Set via environment variable or `--mode` flag:

```bash
AUTONOMY_MODE=semi-auto ./scripts/run-sprint.sh run <sprint-id>
./scripts/run-sprint.sh --mode full-auto run <sprint-id>
```

## Agents

| Agent | Model | Role |
|-------|-------|------|
| Planner | Opus | Decomposes specs into task DAGs |
| Researcher | Haiku | Explores codebase, gathers context |
| Implementer | Sonnet | Writes production code |
| Reviewer | Sonnet | Reviews diffs, categorizes findings |
| Tester | Haiku | Writes and runs tests |

## Writing Specs

Copy `specs/_template.md` and fill in the sections:

- **Overview** — what and why
- **Requirements** — functional and non-functional
- **Constraints** — technical limitations
- **Out of Scope** — explicit exclusions
- **Acceptance Criteria** — testable checkboxes

See `specs/examples/sample-auth.md` for a complete example.

## Configuration

Edit `scripts/lib/config.sh` or set environment variables:

```bash
# Models
PLANNER_MODEL=opus
IMPLEMENTER_MODEL=sonnet
REVIEWER_MODEL=sonnet
RESEARCHER_MODEL=haiku
TESTER_MODEL=haiku

# Budgets (USD per session)
DEFAULT_PLAN_BUDGET=1.00
DEFAULT_TASK_BUDGET=2.00
DEFAULT_REVIEW_BUDGET=0.50
DEFAULT_TEST_BUDGET=1.00

# Limits
MAX_FIX_CYCLES=3
MAX_PARALLEL_TASKS=2
```

## Project Structure

```
dev-team/
├── .claude/agents/     # Agent definitions (planner, researcher, implementer, reviewer, tester)
├── scripts/            # Orchestrator scripts
│   ├── lib/            # Shared config, GitHub helpers, agent wrappers
│   ├── run-sprint.sh   # Main entry point
│   └── ...
├── specs/              # Feature specifications
├── sprints/            # Sprint working directories (auto-created)
├── CLAUDE.md           # Shared conventions for all agents
└── README.md           # This file
```

## Target Stack

Built for JS/TS web app development (React, Next.js, Express, Fastify, etc.) but the agent definitions can be adapted for other stacks.
