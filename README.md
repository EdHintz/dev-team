# dev-team

An agentic development team powered by Claude Code. Give it a feature spec, get back a PR.

Specialized AI agents coordinate through a web-based orchestrator to research, plan, implement, test, and review code changes. Multiple implementers work in parallel using git worktrees, with real-time progress visible in a browser UI.

## How It Works

```
Spec → Researcher → Planner → [Approve] → Implementers (parallel) → Tester → Reviewer → PR
```

1. **You write a spec** describing a feature (see `specs/_template.md`)
2. **Researcher** analyzes your codebase for patterns, conventions, and context
3. **Planner** breaks the spec into ordered tasks with dependencies, assigns them to implementers in waves
4. **You approve** the plan in the web UI
5. **Multiple Implementers** (default 2) work in parallel on their assigned tasks using git worktrees
6. **Tester** writes and runs tests against the completed implementation
7. **Reviewer** reviews the full diff — if MUST-FIX issues are found, an implementer fixes them and the reviewer runs again (up to 3 cycles)
8. **A PR is created** on the sprint branch against main

## Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude`) — authenticated
- [GitHub CLI](https://cli.github.com/) (`gh`) — authenticated
- [Redis](https://redis.io/) — running locally on port 6379
- [Node.js](https://nodejs.org/) 18+ and npm
- Git

### Installing Redis

```bash
# macOS
brew install redis
brew services start redis

# Linux
sudo apt install redis-server
sudo systemctl start redis

# Verify
redis-cli ping    # Should return PONG
```

## Quick Start

```bash
# 1. Install dependencies
cd web
npm install

# 2. Start Redis (if not already running)
redis-cli ping || redis-server --daemonize yes

# 3. Start the backend server (port 4000)
npm run dev

# 4. In a second terminal, start the frontend dev server (port 4001)
npm run dev:client

# 5. Open the UI
open http://localhost:4001
```

Or start both together:

```bash
npm run dev:all
```

### Running a Sprint

1. Open `http://localhost:4001` in your browser
2. Click **New Sprint** on the dashboard
3. Enter the path to your spec file and target project directory
4. Choose the number of implementers (default: 2)
5. Watch research and planning progress in real time
6. **Approve** the generated plan
7. Watch implementers work in parallel with live log streaming
8. Review the tester and reviewer output
9. PR is created automatically on approval

## Sprint Controls

| Action | Description |
|--------|-------------|
| **Pause** | Finishes the current in-progress task but does not start new ones |
| **Resume** | Re-enqueues queued tasks and continues execution |
| **Restart** | Smart restart — detects the failure phase and resumes from there |

- Sprints that fail during research restart from research
- Sprints that fail during planning restart from planning (reusing research)
- Sprints that fail during implementation restart only the incomplete tasks
- Sprints stuck in review trigger a new fix/review cycle

## Agents

| Agent | Model | Role |
|-------|-------|------|
| Researcher | Haiku | Explores codebase, gathers patterns and context |
| Planner | Opus | Decomposes specs into task DAGs with wave ordering and implementer assignments |
| Implementer | Sonnet | Writes production code (multiple run in parallel) |
| Tester | Haiku | Writes and runs tests |
| Reviewer | Sonnet | Reviews diffs, categorizes findings as MUST-FIX / SHOULD-FIX / NITPICK |

### Implementer Identities

Up to 5 implementers can work in parallel, each with their own identity:

| Name | Color |
|------|-------|
| Atlas | Blue |
| Nova | Purple |
| Bolt | Amber |
| Sage | Green |
| Flux | Red |

## Architecture

```
Browser (React SPA)  ←─ WebSocket ─→  Express Server  ←─ BullMQ ─→  Workers
     :4001                                  :4000                       │
                                              │                    Claude CLI
                                         Sprint state              Git worktrees
                                         Redis/BullMQ
```

- **Backend**: Express + WebSocket + BullMQ workers in `web/server/`
- **Frontend**: React + Vite + Tailwind SPA in `web/client/`
- **Workers**: BullMQ workers spawn `claude` CLI as child processes
- **Queue per agent**: One BullMQ queue per implementer for clean isolation
- **Git worktrees**: Each implementer works in its own worktree; branches are merged between waves

### Git Branch Strategy

1. On plan approval: `sprint/<sprint-id>` branch is created from main
2. Per implementer: worktree on `sprint/<sprint-id>/implementer-N` sub-branch
3. After each wave: implementer branches merged back to sprint branch, worktrees reset
4. After implementation: worktrees cleaned up, testing/review run on sprint branch
5. On approval: sprint branch is pushed and a PR is created against main

### Sprint Pipeline

```
research → planning → [approval] → wave 1 → merge → wave 2 → ... → testing → review ─┐
                                                                                        │
                                                                        ┌── approve → PR creation
                                                                        │
                                                                  review result
                                                                        │
                                                                        └── needs fixes → implementer fix → re-review (up to 3 cycles)
```

## Configuration

Set via environment variables or a `.env` file in `web/`:

```bash
# Server
WEB_PORT=4000
REDIS_URL=redis://localhost:6379

# Models
PLANNER_MODEL=opus
IMPLEMENTER_MODEL=sonnet
REVIEWER_MODEL=sonnet
RESEARCHER_MODEL=haiku
TESTER_MODEL=haiku

# Budgets (USD per agent session)
DEFAULT_PLAN_BUDGET=3.00
DEFAULT_RESEARCH_BUDGET=1.50
DEFAULT_TASK_BUDGET=6.00
DEFAULT_REVIEW_BUDGET=1.50
DEFAULT_TEST_BUDGET=3.00

# Limits
MAX_FIX_CYCLES=3
IMPLEMENTER_COUNT=2

# Autonomy
AUTONOMY_MODE=supervised   # supervised | semi-auto | full-auto
```

## Writing Specs

Copy `specs/_template.md` and fill in the sections:

- **Overview** -- what and why
- **Requirements** -- functional and non-functional
- **Constraints** -- technical limitations
- **Out of Scope** -- explicit exclusions
- **Acceptance Criteria** -- testable checkboxes

See `specs/examples/` for complete examples.

## Project Structure

```
dev-team/
├── .claude/agents/        # Agent prompt definitions
├── scripts/               # CLI fallback scripts (original v1 interface)
├── specs/                 # Feature specifications
├── sprints/               # Sprint working directories (auto-created)
│   └── sprint-<id>/
│       ├── spec.md        # Copy of the input spec
│       ├── research.md    # Codebase analysis from researcher
│       ├── plan.json      # Task breakdown from planner
│       ├── review-N.md    # Review findings per cycle
│       ├── cost.json      # Running cost tracker
│       ├── .status        # Current sprint status
│       ├── .meta.json     # Sprint metadata (target dir, spec path)
│       └── logs/          # Agent output logs
├── web/                   # Web orchestrator (v2)
│   ├── package.json
│   ├── vite.config.ts
│   ├── server/
│   │   ├── index.ts       # Entry point: Express + WS + workers
│   │   ├── config.ts      # All configuration
│   │   ├── routes/        # REST API endpoints
│   │   ├── queues/        # BullMQ queue setup
│   │   ├── workers/       # Agent workers (research, planning, implementation, testing, review, PR)
│   │   ├── services/      # Git, GitHub, state management, agent CLI wrapper
│   │   ├── websocket/     # Real-time event broadcasting
│   │   └── utils/         # Logger, Redis connection
│   ├── client/
│   │   └── src/
│   │       ├── pages/     # Dashboard, Planning, Sprint, Review
│   │       ├── components/# ImplementerPanel, TaskList, LogViewer, etc.
│   │       └── hooks/     # WebSocket, sprint data
│   └── shared/
│       └── types.ts       # Types shared between server and client
├── CLAUDE.md              # Shared coding conventions for all agents
└── README.md
```

## CLI Fallback

The original shell-script interface is preserved in `scripts/` for use without the web UI:

```bash
./scripts/run-sprint.sh plan specs/my-feature.md
./scripts/run-sprint.sh approve <sprint-id>
./scripts/run-sprint.sh run <sprint-id>
./scripts/review-sprint.sh <sprint-id>
./scripts/create-pr.sh <sprint-id>
```

## Target Stack

Built for JS/TS web app development (React, Next.js, Express, Fastify, etc.) but the agent definitions in `.claude/agents/` can be adapted for other stacks.
