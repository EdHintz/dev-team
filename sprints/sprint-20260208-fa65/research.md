# Codebase Research — Sprint sprint-20260208-fa65

## Project Structure

```
dev-team/
├── .claude/
│   ├── agents/                    # Agent definitions (researcher, planner, implementer, etc.)
│   │   ├── planner.md
│   │   ├── researcher.md
│   │   ├── implementer.md
│   │   ├── reviewer.md
│   │   └── tester.md
│   └── settings.json              # Claude Code permissions & config
├── scripts/
│   ├── lib/
│   │   ├── agent.sh              # Agent invocation wrapper
│   │   ├── config.sh             # Shared configuration & environment
│   │   └── github.sh             # GitHub API helpers
│   ├── plan-sprint.sh            # Invokes planner agent
│   ├── run-sprint.sh             # Main orchestrator entry point
│   ├── run-tasks.sh              # Executes tasks sequentially/parallel
│   ├── review-sprint.sh          # Invokes reviewer + tester agents
│   └── create-pr.sh              # Creates GitHub PR from sprint branch
├── specs/
│   ├── _template.md              # Spec template
│   └── examples/
│       └── sample-auth.md        # Reference auth spec (identical to provided spec)
├── sprints/
│   └── sprint-20260208-fa65/      # Current sprint working directory
│       ├── spec.md               # Copy of the input spec
│       ├── research.md           # THIS FILE - researcher agent output
│       ├── plan.json             # Planner agent output (task breakdown)
│       ├── cost.json             # Cost tracking
│       └── logs/                 # Agent execution logs
├── CLAUDE.md                      # Shared coding conventions & rules
└── README.md                      # Framework documentation
```

## Tech Stack

**Current State:** This is an **agentic development framework**, not a working application yet. No application code exists in this repository.

### Framework Components
- **Language:** Bash (orchestrator scripts), Markdown (specs & documentation)
- **Agent Communication:** Claude Code CLI invocation via shell scripts
- **VCS:** Git with GitHub integration
- **Build/Test:** npm (referenced but no actual app yet)

### Target Stack (for applications built with this framework)
The framework is designed for:
- **Language:** TypeScript (preferred) / JavaScript
- **Runtime:** Node.js
- **Frameworks:** Express, Fastify (backend); React, Next.js (frontend)
- **Package Manager:** npm or pnpm
- **Test Framework:** Jest or Vitest (inferred from CLAUDE.md)
- **Database:** No existing database - spec allows SQLite or project's existing DB

## Coding Patterns

Based on `CLAUDE.md` (shared conventions for all agents):

### Module & File Style
- **Module system:** ES modules (`import`/`export`), NOT CommonJS
- **File naming:** kebab-case (e.g., `user-service.ts`, `auth-middleware.ts`)
- **Class/Type naming:** PascalCase
- **Variable/Function naming:** camelCase

### Language Preferences
- TypeScript over plain JavaScript
- `const` over `let`; never `var`
- async/await over raw Promises

### API Patterns (inferred for auth endpoints)
- RESTful endpoints under `/api/auth/*`
- HTTP-only cookies for session storage
- JWT tokens for authentication

### Testing
- Test files co-located with source: `foo.ts` → `foo.test.ts`
- Run tests with `npm test`
- Write tests for all new functionality

### Version Control
- Commit format:
  ```
  <type>(<scope>): <short summary>

  <optional body>

  Sprint: <sprint-id>
  Task: <task-number>
  ```
- Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`

## Relevant Existing Code

**No existing application code in this repository.** This is a framework for coordinating agent-based development, not a working app.

### What exists:
- **Agent definitions** (`.claude/agents/*.md`) - instructions for each agent role
- **Orchestrator scripts** (`scripts/*.sh`) - shell scripts that invoke agents via Claude Code CLI
- **Configuration** (`scripts/lib/config.sh`) - shared environment variables and defaults
- **Sample spec** (`specs/examples/sample-auth.md`) - authentication example matching this sprint's spec

### What doesn't exist yet:
- No `src/` directory or application structure
- No `package.json` or installed dependencies
- No database schema or ORM
- No server (Express/Fastify) configured
- No HTTP routes or middleware

## Configuration & Environment

### Framework Configuration (`scripts/lib/config.sh`)
The orchestrator sets these defaults (can be overridden):

```bash
PLANNER_MODEL=claude-opus-4-6          # Plan decomposition
IMPLEMENTER_MODEL=claude-sonnet-4-5    # Code writing
REVIEWER_MODEL=claude-sonnet-4-5       # Code review
RESEARCHER_MODEL=claude-haiku-4-5      # Codebase analysis
TESTER_MODEL=claude-haiku-4-5          # Test writing

SPRINTS_DIR=sprints
DEFAULT_PLAN_BUDGET=1.00               # USD per plan session
DEFAULT_TASK_BUDGET=2.00               # USD per task
DEFAULT_REVIEW_BUDGET=0.50             # USD per review
DEFAULT_TEST_BUDGET=1.00               # USD per test
```

### Claude Code Permissions (`~/.claude/settings.json` or `.claude/settings.json`)
Current permissions allow:
- `Bash(npm test)`, `Bash(npm run lint)` - run tests and linting
- `Bash(git *)` - git operations
- `Bash(ls *)`, `Bash(cat *)`, `Bash(find *)` - file inspection

**Note:** Implementer/Tester agents will need permissions for:
- `Bash(npm install)` or `Bash(npm ci)` - dependency installation
- `Bash(mkdir)`, file write operations - creating new directories/files
- Likely more permissive file/directory operations

### Sprint Workflow
1. **Researcher** (Haiku) - Analyzes codebase → `research.md`
2. **Planner** (Opus) - Reads research + spec → `plan.json` with task breakdown
3. **Implementer** (Sonnet) - Executes implementation tasks in dependency order
4. **Tester** (Haiku) - Writes and runs tests
5. **Reviewer** (Sonnet) - Reviews full diff, requests fixes if needed
6. **PR Creation** - Creates GitHub PR with summary

## Recommendations for Implementer

### 1. **Bootstrap the Application**
Since no app exists yet, the first task should create initial structure:
- Create `package.json` with dependencies (express/fastify, bcrypt, jsonwebtoken, sqlite3 or equivalent)
- Create `tsconfig.json` for TypeScript configuration
- Create base directory structure: `src/{models,routes,middleware,utils,types}`
- Create `src/server.ts` with basic Express/Fastify setup

### 2. **Database Setup**
The spec says "use project's existing database or add SQLite if none exists." Since none exists:
- Recommend SQLite for simplicity (no external dependency)
- Create `src/db.ts` for database initialization
- Create `src/models/user.ts` for User table schema (id, email, password_hash, created_at)

### 3. **Authentication Module Organization**
Create a dedicated auth module to keep concerns separated:
- `src/services/auth-service.ts` - Business logic (register, login, verify)
- `src/middleware/auth-middleware.ts` - JWT verification middleware
- `src/routes/auth-routes.ts` - HTTP endpoints
- `src/types/auth-types.ts` - TypeScript types (User, AuthPayload, etc.)
- `src/utils/password.ts` - bcrypt hashing utilities
- `src/utils/jwt.ts` - JWT token generation/validation

### 4. **Key Considerations for Implementer**

**Bcrypt:**
- Install `bcrypt` package (not `bcryptjs`)
- Minimum 10 rounds as per spec
- Hash on register, compare on login

**JWT Token Strategy:**
- Use `jsonwebtoken` package
- Store token in HTTP-only cookie with SameSite=Strict
- Also return in response body (common pattern)
- 24-hour expiration as per spec

**Password Validation:**
- Minimum 8 characters (enforced client and server-side)
- Could add regex for complexity if desired (not in spec)

**Rate Limiting:**
- Spec requires: "5 login attempts per minute per IP"
- Use package like `express-rate-limit` or `fastify-rate-limit`
- Consider: rate limit by IP only (simpler) vs IP+email (more accurate)

**Error Handling:**
- 401 for invalid credentials (don't reveal if email exists)
- 409 for duplicate email on register
- 400 for validation errors
- Consistent error response format

**Session Invalidation (Logout):**
- JWT-based: tokens can't be revoked server-side without blacklist
- Simple approach: client deletes cookie, token expires naturally
- Alternative: maintain token blacklist/revocation list if needed

### 5. **Testing Strategy**
- Unit tests for `auth-service.ts` (register, login, validation logic)
- Integration tests for routes (test actual HTTP endpoints)
- Test fixtures for test users
- Test password hashing and verification
- Test JWT token generation and validation

### 6. **Files to Create** (estimated)
```
src/
  ├── db.ts
  ├── server.ts
  ├── middleware/
  │   └── auth-middleware.ts
  ├── models/
  │   └── user.ts
  ├── routes/
  │   └── auth-routes.ts
  ├── services/
  │   └── auth-service.ts
  ├── types/
  │   └── auth-types.ts
  └── utils/
      ├── jwt.ts
      ├── password.ts
      └── errors.ts

Test files:
src/
  ├── services/auth-service.test.ts
  ├── routes/auth-routes.test.ts
  └── utils/password.test.ts
```

### 7. **Performance Considerations**
Spec requires: "Login response time under 500ms"
- Bcrypt with 10 rounds is the bottleneck (~100-200ms on modern hardware)
- Database query should be fast (index on email)
- JWT generation is negligible (~1-5ms)
- No external API calls, so achievable target

### 8. **Deployment Readiness**
- Environment variables needed: `JWT_SECRET`, `JWT_EXPIRY`, `BCRYPT_ROUNDS`, `DB_PATH`
- Consider `.env.example` file documenting all variables
- SQLite database file path configurable via env var

## Sprint Context Notes

- This is the **initial sprint** in this framework - no prior code to build on
- The framework is designed for iterative sprints; this auth feature is self-contained
- Once auth is working, future sprints can add password reset, OAuth, etc.
- Agent role clarification: This researcher is analyzing the **framework** structure, not target app code (which doesn't exist yet)
