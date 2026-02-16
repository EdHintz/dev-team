#!/usr/bin/env bash
set -euo pipefail

# Main orchestrator entry point
# Usage: ./scripts/run-sprint.sh <command> [args...]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/config.sh"

usage() {
  cat <<EOF
${BOLD}dev-team sprint orchestrator${NC}

Usage: $(basename "$0") <command> [args...]

Commands:
  plan <spec.md>        Plan a sprint from a spec file
  approve <sprint-id>   Mark a sprint as approved and ready to run
  run <sprint-id>       Execute all tasks in the sprint
  status <sprint-id>    Show sprint status from GitHub
  fix-pr <pr-number>    Address PR review comments
  cost <sprint-id>      Show cost summary for a sprint

Options:
  --mode <mode>         Override autonomy mode (supervised|semi-auto|full-auto)
  --help                Show this help

Environment:
  AUTONOMY_MODE         Default autonomy mode (default: supervised)
  DEFAULT_TASK_BUDGET   Budget per task in USD (default: 2.00)
EOF
}

# Parse global options
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      AUTONOMY_MODE="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      break
      ;;
  esac
done

command="${1:-}"
shift || true

case "$command" in
  plan)
    if [[ $# -lt 1 ]]; then
      err "Usage: $(basename "$0") plan <spec-file>"
      exit 1
    fi
    exec "${SCRIPT_DIR}/plan-sprint.sh" "$@"
    ;;
  approve)
    if [[ $# -lt 1 ]]; then
      err "Usage: $(basename "$0") approve <sprint-id>"
      exit 1
    fi
    sprint_id="$1"
    sprint_dir="${SPRINTS_DIR}/${sprint_id}"
    if [[ ! -d "$sprint_dir" ]]; then
      err "Sprint not found: ${sprint_id}"
      exit 1
    fi
    echo "approved" > "${sprint_dir}/.status"
    ok "Sprint ${sprint_id} approved and ready to run."
    info "Run: ./scripts/run-sprint.sh run ${sprint_id}"
    ;;
  run)
    if [[ $# -lt 1 ]]; then
      err "Usage: $(basename "$0") run <sprint-id>"
      exit 1
    fi
    sprint_id="$1"
    sprint_dir="${SPRINTS_DIR}/${sprint_id}"
    if [[ ! -f "${sprint_dir}/.status" ]] || [[ "$(cat "${sprint_dir}/.status")" != "approved" ]]; then
      err "Sprint ${sprint_id} is not approved. Run 'approve' first."
      exit 1
    fi
    shift
    exec "${SCRIPT_DIR}/run-tasks.sh" "$sprint_id" "$@"
    ;;
  status)
    if [[ $# -lt 1 ]]; then
      err "Usage: $(basename "$0") status <sprint-id>"
      exit 1
    fi
    sprint_id="$1"
    sprint_dir="${SPRINTS_DIR}/${sprint_id}"

    bold "Sprint: ${sprint_id}"
    echo ""

    # Show local status
    if [[ -f "${sprint_dir}/.status" ]]; then
      info "Status: $(cat "${sprint_dir}/.status")"
    else
      info "Status: unknown"
    fi

    # Show plan summary
    if [[ -f "${sprint_dir}/plan.json" ]]; then
      info "Tasks:"
      python3 -c "
import json
with open('${sprint_dir}/plan.json') as f:
    plan = json.load(f)
for t in plan['tasks']:
    deps = ', '.join(str(d) for d in t.get('depends_on', []))
    dep_str = f' (depends on: {deps})' if deps else ''
    print(f\"  {t['id']}. [{t['agent']}] {t['title']}{dep_str}\")
"
    fi

    # Show GitHub issues if available
    if [[ -f "${sprint_dir}/.milestone" ]]; then
      milestone=$(cat "${sprint_dir}/.milestone")
      echo ""
      info "GitHub Issues (milestone #${milestone}):"
      gh api "repos/:owner/:repo/issues?milestone=${milestone}&state=all&per_page=100" \
        --jq '.[] | "  #\(.number) [\(.state)] \(.title)"' 2>/dev/null || \
        warn "Could not fetch GitHub issues"
    fi

    # Show cost summary
    if [[ -f "${sprint_dir}/cost.json" ]]; then
      echo ""
      "${SCRIPT_DIR}/cost-report.sh" "$sprint_id"
    fi
    ;;
  fix-pr)
    if [[ $# -lt 1 ]]; then
      err "Usage: $(basename "$0") fix-pr <pr-number>"
      exit 1
    fi
    pr_number="$1"
    info "Fetching PR #${pr_number} review comments..."

    comments=$(gh api "repos/:owner/:repo/pulls/${pr_number}/comments" \
      --jq '.[] | "**\(.path):\(.line // "general")** — \(.body)"' 2>/dev/null)

    review_comments=$(gh api "repos/:owner/:repo/pulls/${pr_number}/reviews" \
      --jq '.[] | select(.state == "CHANGES_REQUESTED") | .body' 2>/dev/null)

    if [[ -z "$comments" && -z "$review_comments" ]]; then
      ok "No review comments found on PR #${pr_number}"
      exit 0
    fi

    prompt="Fix the following PR review comments:\n\n${review_comments}\n\n${comments}\n\nRead the relevant files, apply the fixes, and stage the changes."

    source "${SCRIPT_DIR}/lib/agent.sh"
    run_agent "developer" "$prompt" --budget "$DEFAULT_TASK_BUDGET"

    if needs_approval "commit"; then
      confirm_or_exit "Commit the fixes?"
    fi

    git commit -m "$(cat <<EOF
fix(pr): address review comments from PR #${pr_number}

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
    git push
    ok "Fixes pushed. PR #${pr_number} updated."
    ;;
  cost)
    if [[ $# -lt 1 ]]; then
      err "Usage: $(basename "$0") cost <sprint-id>"
      exit 1
    fi
    exec "${SCRIPT_DIR}/cost-report.sh" "$1"
    ;;
  "")
    usage
    exit 1
    ;;
  *)
    err "Unknown command: ${command}"
    usage
    exit 1
    ;;
esac
