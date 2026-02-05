#!/usr/bin/env bash
# Central configuration for the dev-team orchestrator

# --- Autonomy Mode ---
# supervised  — pause for human approval at every major step
# semi-auto   — pause only before commits and PR creation
# full-auto   — run everything without pausing
AUTONOMY_MODE="${AUTONOMY_MODE:-supervised}"

# --- Budget Defaults (USD) ---
DEFAULT_PLAN_BUDGET="${DEFAULT_PLAN_BUDGET:-1.00}"
DEFAULT_RESEARCH_BUDGET="${DEFAULT_RESEARCH_BUDGET:-0.50}"
DEFAULT_TASK_BUDGET="${DEFAULT_TASK_BUDGET:-2.00}"
DEFAULT_REVIEW_BUDGET="${DEFAULT_REVIEW_BUDGET:-0.50}"
DEFAULT_TEST_BUDGET="${DEFAULT_TEST_BUDGET:-1.00}"

# --- Model Selection ---
PLANNER_MODEL="${PLANNER_MODEL:-opus}"
IMPLEMENTER_MODEL="${IMPLEMENTER_MODEL:-sonnet}"
REVIEWER_MODEL="${REVIEWER_MODEL:-sonnet}"
RESEARCHER_MODEL="${RESEARCHER_MODEL:-haiku}"
TESTER_MODEL="${TESTER_MODEL:-haiku}"

# --- Limits ---
MAX_FIX_CYCLES="${MAX_FIX_CYCLES:-3}"
MAX_PARALLEL_TASKS="${MAX_PARALLEL_TASKS:-2}"

# --- Paths ---
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPTS_DIR="${PROJECT_ROOT}/scripts"
AGENTS_DIR="${PROJECT_ROOT}/.claude/agents"
SPRINTS_DIR="${PROJECT_ROOT}/sprints"
SPECS_DIR="${PROJECT_ROOT}/specs"

# --- GitHub ---
GH_ORG="${GH_ORG:-}"  # set to org name if using org repos
PROJECT_BOARD_NAME="${PROJECT_BOARD_NAME:-Dev Team Sprints}"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# --- Helpers ---
info()  { echo -e "${BLUE}ℹ${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
err()   { echo -e "${RED}✗${NC} $*" >&2; }
bold()  { echo -e "${BOLD}$*${NC}"; }

confirm() {
  local msg="${1:-Continue?}"
  if [[ "$AUTONOMY_MODE" == "full-auto" ]]; then
    return 0
  fi
  echo -en "${CYAN}?${NC} ${msg} [y/N] "
  read -r answer
  [[ "$answer" =~ ^[Yy]$ ]]
}

confirm_or_exit() {
  if ! confirm "$1"; then
    err "Aborted by user."
    exit 1
  fi
}

# Should we pause for approval at this step?
needs_approval() {
  local step_type="$1" # plan, task, commit, pr
  case "$AUTONOMY_MODE" in
    supervised) return 0 ;;
    semi-auto)
      [[ "$step_type" == "commit" || "$step_type" == "pr" ]]
      ;;
    full-auto) return 1 ;;
    *) return 0 ;;
  esac
}

# Generate a sprint ID from date + random suffix
generate_sprint_id() {
  echo "sprint-$(date +%Y%m%d)-$(head -c 4 /dev/urandom | xxd -p | head -c 4)"
}

# Ensure a sprint directory exists with required subdirs
init_sprint_dir() {
  local sprint_id="$1"
  local sprint_dir="${SPRINTS_DIR}/${sprint_id}"
  mkdir -p "${sprint_dir}/logs"
  # Initialize cost tracker
  if [[ ! -f "${sprint_dir}/cost.json" ]]; then
    echo '{"total": 0, "by_agent": {}, "by_task": {}}' > "${sprint_dir}/cost.json"
  fi
  echo "$sprint_dir"
}
