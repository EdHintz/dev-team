#!/usr/bin/env bash
set -euo pipefail

# Phase 2: Execute sprint tasks via agents
# Usage: ./scripts/run-tasks.sh <sprint-id> [--task <task-id>]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/config.sh"
source "${SCRIPT_DIR}/lib/agent.sh"
source "${SCRIPT_DIR}/lib/github.sh"

sprint_id="$1"
shift || true

single_task=""
target_dir=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --task)   single_task="$2"; shift 2 ;;
    --target) target_dir="$2"; shift 2 ;;
    *)        shift ;;
  esac
done

sprint_dir="${SPRINTS_DIR}/${sprint_id}"
plan_file="${sprint_dir}/plan.json"
target_dir="${target_dir:-$(pwd)}"

if [[ ! -f "$plan_file" ]]; then
  err "No plan found for sprint ${sprint_id}"
  exit 1
fi

# Create sprint branch
sprint_branch="sprint/${sprint_id}"

if ! git -C "$target_dir" rev-parse --verify "$sprint_branch" &>/dev/null; then
  info "Creating sprint branch: ${sprint_branch}"
  git -C "$target_dir" checkout -b "$sprint_branch" 2>/dev/null || \
    git -C "$target_dir" switch -c "$sprint_branch" 2>/dev/null
else
  info "Switching to sprint branch: ${sprint_branch}"
  git -C "$target_dir" checkout "$sprint_branch" 2>/dev/null || \
    git -C "$target_dir" switch "$sprint_branch" 2>/dev/null
fi

# Get ordered tasks into a temp file
ordered_tasks=$(get_sprint_tasks_ordered "$sprint_id")
if [[ -z "$ordered_tasks" ]]; then
  err "No tasks found in plan"
  exit 1
fi

task_list_file=$(mktemp)
trap 'rm -f "$task_list_file"' EXIT
echo "$ordered_tasks" | python3 -c "
import json, sys
tasks = json.loads(sys.stdin.read())
for t in tasks:
    print(t['id'], t['agent'], t['title'], sep='|')
" > "$task_list_file"

# Load issue mapping if available
issue_map_file="${sprint_dir}/issue-map.json"
has_issues=false
[[ -f "$issue_map_file" ]] && has_issues=true

# Track completed tasks
completed_file="${sprint_dir}/.completed"
touch "$completed_file"

bold "Executing Sprint: ${sprint_id}"
echo ""

# Process tasks (read from file to avoid subshell issues with heredocs)
while IFS='|' read -r task_id agent title; do

  # Skip if already completed
  if grep -q "^${task_id}$" "$completed_file" 2>/dev/null; then
    ok "Task ${task_id} already completed: ${title}"
    continue
  fi

  # Skip if not the requested single task
  if [[ -n "$single_task" && "$task_id" != "$single_task" ]]; then
    continue
  fi

  echo ""
  bold "Task ${task_id}: ${title}"
  info "Agent: ${agent}"

  # Update GitHub issue status
  issue_number=""
  if [[ "$has_issues" == "true" ]]; then
    issue_number=$(python3 -c "
import json
with open('${issue_map_file}') as f:
    m = json.load(f)
print(m.get('${task_id}', m.get(${task_id}, '')))" 2>/dev/null || echo "")
    if [[ -n "$issue_number" ]]; then
      update_issue_status "$issue_number" "in-progress" 2>/dev/null || true
    fi
  fi

  # Build task prompt with full context
  task_details=$(python3 -c "
import json
with open('${plan_file}') as f:
    plan = json.load(f)
for t in plan['tasks']:
    if str(t['id']) == '${task_id}':
        print(json.dumps(t, indent=2))
        break
")

  research_context=""
  [[ -f "${sprint_dir}/research.md" ]] && research_context=$(cat "${sprint_dir}/research.md")

  prompt="You are working on Sprint ${sprint_id}, Task ${task_id}: ${title}

## Task Details
${task_details}

## Codebase Research
${research_context}

## Instructions
1. Read any files you need to understand before making changes
2. Implement the task according to the description and acceptance criteria
3. Run tests if available (npm test or the test command for this project)
4. Stage your changes with git add (do NOT commit)
5. Print a brief summary of what you did"

  # Select budget based on agent type
  local_budget="$DEFAULT_TASK_BUDGET"
  [[ "$agent" == "tester" ]] && local_budget="$DEFAULT_TEST_BUDGET"

  # Run the agent
  output=$(run_agent "$agent" "$prompt" \
    --budget "$local_budget" \
    --sprint "$sprint_id" \
    --task "$task_id" \
    --cwd "$target_dir") || {
    err "Task ${task_id} failed"
    warn "Check log at: ${sprint_dir}/logs/"
    continue
  }

  # Show diff in supervised mode
  if needs_approval "task"; then
    echo ""
    info "Changes for Task ${task_id}:"
    git -C "$target_dir" diff --cached --stat 2>/dev/null || true
    git -C "$target_dir" diff --stat 2>/dev/null || true
    echo ""
    confirm_or_exit "Accept changes for Task ${task_id}?"
  fi

  # Stage any unstaged changes and commit
  git -C "$target_dir" add -A

  commit_msg="feat(${sprint_id}): task ${task_id} - ${title}

Sprint: ${sprint_id}
Task: ${task_id}

Co-Authored-By: Claude <noreply@anthropic.com>"

  git -C "$target_dir" commit -m "$commit_msg" 2>/dev/null || warn "Nothing to commit for task ${task_id}"

  # Mark task complete
  echo "$task_id" >> "$completed_file"

  # Close GitHub issue
  if [[ "$has_issues" == "true" && -n "${issue_number:-}" ]]; then
    update_issue_status "$issue_number" "closed" 2>/dev/null || true
  fi

  ok "Task ${task_id} complete: ${title}"
done < "$task_list_file"

echo ""
bold "Task execution complete for sprint ${sprint_id}"
info "Next: ./scripts/review-sprint.sh ${sprint_id}"
