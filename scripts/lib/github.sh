#!/usr/bin/env bash
# GitHub CLI helpers for sprint management

# Source config if not already loaded
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=config.sh
[[ -z "$PROJECT_ROOT" ]] && source "${SCRIPT_DIR}/config.sh"

# --- Repo Helpers ---

get_repo_name() {
  gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null
}

ensure_repo() {
  if ! gh repo view &>/dev/null; then
    err "No GitHub repo found. Run 'gh repo create' first."
    return 1
  fi
}

# --- Milestone (Sprint) Management ---

create_milestone() {
  local sprint_id="$1"
  local description="${2:-Sprint ${sprint_id}}"

  ensure_repo || return 1

  # Check if milestone already exists
  local existing
  existing=$(gh api repos/:owner/:repo/milestones --jq ".[] | select(.title == \"${sprint_id}\") | .number" 2>/dev/null)
  if [[ -n "$existing" ]]; then
    echo "$existing"
    return 0
  fi

  gh api repos/:owner/:repo/milestones \
    -f title="$sprint_id" \
    -f description="$description" \
    -f state="open" \
    --jq '.number'
}

close_milestone() {
  local milestone_number="$1"
  gh api repos/:owner/:repo/milestones/"$milestone_number" \
    -X PATCH -f state="closed" --silent
}

# --- Issue Management ---

create_issue() {
  local title="$1"
  local body="$2"
  local milestone_number="$3"
  local labels="$4"  # comma-separated

  local args=(
    --title "$title"
    --body "$body"
  )

  if [[ -n "$milestone_number" ]]; then
    args+=(--milestone "$milestone_number")
  fi

  if [[ -n "$labels" ]]; then
    IFS=',' read -ra label_array <<< "$labels"
    for label in "${label_array[@]}"; do
      # Ensure label exists (create if not)
      gh label create "$label" --force 2>/dev/null || true
      args+=(--label "$label")
    done
  fi

  gh issue create "${args[@]}" --json number -q '.number' 2>/dev/null || \
    gh issue create "${args[@]}" 2>/dev/null | grep -oE '[0-9]+$'
}

update_issue_status() {
  local issue_number="$1"
  local status="$2"  # open, closed

  case "$status" in
    closed|done)
      gh issue close "$issue_number" --comment "Completed by dev-team agent." ;;
    in-progress)
      gh issue edit "$issue_number" --add-label "in-progress" ;;
    *)
      info "Unknown status: $status" ;;
  esac
}

add_issue_comment() {
  local issue_number="$1"
  local comment="$2"
  gh issue comment "$issue_number" --body "$comment"
}

# --- Sprint Task Queries ---

get_sprint_tasks() {
  local milestone_number="$1"
  local state="${2:-open}" # open, closed, all

  gh api "repos/:owner/:repo/issues?milestone=${milestone_number}&state=${state}&per_page=100" \
    --jq '.[] | {number: .number, title: .title, labels: [.labels[].name], state: .state}'
}

get_sprint_tasks_ordered() {
  local sprint_id="$1"
  local sprint_dir="${SPRINTS_DIR}/${sprint_id}"
  local plan_file="${sprint_dir}/plan.json"

  if [[ ! -f "$plan_file" ]]; then
    err "No plan.json found for sprint ${sprint_id}"
    return 1
  fi

  # Return tasks ordered by dependency (tasks with no deps first)
  python3 -c "
import json, sys
with open('${plan_file}') as f:
    plan = json.load(f)
tasks = plan['tasks']

# Topological sort
resolved = set()
ordered = []
remaining = list(tasks)
while remaining:
    progress = False
    for task in remaining[:]:
        deps = set(task.get('depends_on', []))
        if deps.issubset(resolved):
            ordered.append(task)
            resolved.add(task['id'])
            remaining.remove(task)
            progress = True
    if not progress:
        print('ERROR: Circular dependency detected', file=sys.stderr)
        sys.exit(1)

print(json.dumps(ordered))
"
}

# --- Label Helpers ---

ensure_labels() {
  local labels=("feat" "fix" "refactor" "test" "docs" "chore"
                "backend" "frontend" "fullstack"
                "in-progress" "blocked" "sprint")

  for label in "${labels[@]}"; do
    gh label create "$label" --force 2>/dev/null || true
  done
}

# --- PR Helpers ---

create_sprint_pr() {
  local sprint_id="$1"
  local branch="$2"
  local base="${3:-main}"
  local body="$4"

  gh pr create \
    --base "$base" \
    --head "$branch" \
    --title "Sprint: ${sprint_id}" \
    --body "$body"
}

get_pr_review_comments() {
  local pr_number="$1"
  gh api "repos/:owner/:repo/pulls/${pr_number}/comments" \
    --jq '.[] | {path: .path, line: .line, body: .body, author: .user.login}'
}
