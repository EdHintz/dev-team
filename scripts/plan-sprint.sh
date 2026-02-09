#!/usr/bin/env bash
set -euo pipefail

# Phase 1: Spec → Sprint Plan
# Usage: ./scripts/plan-sprint.sh <spec-file> [--id <sprint-id>]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/config.sh"
source "${SCRIPT_DIR}/lib/agent.sh"
source "${SCRIPT_DIR}/lib/github.sh"

# Parse args
spec_file=""
sprint_id=""
target_dir=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --id)       sprint_id="$2"; shift 2 ;;
    --target)   target_dir="$2"; shift 2 ;;
    *)          spec_file="$1"; shift ;;
  esac
done

if [[ -z "$spec_file" ]]; then
  err "Usage: plan-sprint.sh <spec-file> [--id <sprint-id>] [--target <project-dir>]"
  exit 1
fi

# Resolve spec file
if [[ ! -f "$spec_file" ]]; then
  # Try relative to specs dir
  if [[ -f "${SPECS_DIR}/${spec_file}" ]]; then
    spec_file="${SPECS_DIR}/${spec_file}"
  else
    err "Spec file not found: ${spec_file}"
    exit 1
  fi
fi

spec_file="$(cd "$(dirname "$spec_file")" && pwd)/$(basename "$spec_file")"
target_dir="${target_dir:-$(pwd)}"

# Generate sprint ID if not provided
sprint_id="${sprint_id:-$(generate_sprint_id)}"
bold "Planning Sprint: ${sprint_id}"
info "Spec: ${spec_file}"
info "Target: ${target_dir}"
echo ""

# Initialize sprint directory
sprint_dir=$(init_sprint_dir "$sprint_id")

# Copy spec into sprint dir for reference
cp "$spec_file" "${sprint_dir}/spec.md"

# --- Phase 1a: Research ---
info "Phase 1a: Running researcher agent..."

research_prompt="$(cat <<EOF
Analyze the codebase at ${target_dir} for a new sprint.

The sprint will implement the following specification:

$(cat "$spec_file")

Write your analysis to ${sprint_dir}/research.md

Focus on:
1. Current project structure and tech stack
2. Existing patterns relevant to this spec
3. Files that will likely need modification
4. Any setup or configuration considerations
EOF
)"

run_agent "researcher" "$research_prompt" \
  --budget "$DEFAULT_RESEARCH_BUDGET" \
  --sprint "$sprint_id" \
  --cwd "$target_dir"

if [[ ! -f "${sprint_dir}/research.md" ]]; then
  warn "Researcher did not create research.md — creating stub"
  echo "# Codebase Research — ${sprint_id}" > "${sprint_dir}/research.md"
  echo "" >> "${sprint_dir}/research.md"
  echo "No existing codebase found. This appears to be a greenfield project." >> "${sprint_dir}/research.md"
fi

ok "Research complete: ${sprint_dir}/research.md"
echo ""

# --- Phase 1b: Planning ---
info "Phase 1b: Running planner agent..."

plan_prompt="$(cat <<EOF
You are planning sprint ${sprint_id}.

## Specification
$(cat "$spec_file")

## Codebase Research
$(cat "${sprint_dir}/research.md")

Create a detailed task breakdown and write it as JSON to ${sprint_dir}/plan.json

Follow the format specified in your agent definition. Ensure:
- Tasks are ordered by dependency
- Each task has clear acceptance criteria
- Agent assignments (implementer vs tester) are appropriate
- Task granularity allows single-session completion
EOF
)"

run_agent "planner" "$plan_prompt" \
  --budget "$DEFAULT_PLAN_BUDGET" \
  --sprint "$sprint_id" \
  --cwd "$target_dir"

if [[ ! -f "${sprint_dir}/plan.json" ]]; then
  err "Planner did not create plan.json"
  exit 1
fi

ok "Plan created: ${sprint_dir}/plan.json"
echo ""

# --- Phase 1c: Create GitHub Issues ---
info "Phase 1c: Creating GitHub issues..."

if gh repo view &>/dev/null; then
  ensure_labels

  milestone_number=$(create_milestone "$sprint_id" "Sprint planned from $(basename "$spec_file")")
  echo "$milestone_number" > "${sprint_dir}/.milestone"
  ok "Created milestone #${milestone_number}"

  # Create issues from plan — use sprint_id as milestone title
  milestone_title="$sprint_id"
  python3 -c "
import json, subprocess, sys

with open('${sprint_dir}/plan.json') as f:
    plan = json.load(f)

issue_map = {}

for task in plan['tasks']:
    labels = ','.join(task.get('labels', []) + ['sprint'])
    body = task['description'] + '\n\n'
    body += '**Agent:** ' + task['agent'] + '\n'
    body += '**Complexity:** ' + task.get('complexity', 'medium') + '\n\n'
    if task.get('acceptance_criteria'):
        body += '### Acceptance Criteria\n'
        for ac in task['acceptance_criteria']:
            body += f'- [ ] {ac}\n'
    if task.get('depends_on'):
        body += '\n**Depends on:** ' + ', '.join(f'Task {d}' for d in task['depends_on']) + '\n'

    result = subprocess.run(
        ['gh', 'issue', 'create',
         '--title', f\"[{plan['sprint_id']}] {task['title']}\",
         '--body', body,
         '--milestone', '${milestone_title}',
         '--label', labels],
        capture_output=True, text=True
    )

    if result.returncode == 0:
        # Extract issue number from URL
        url = result.stdout.strip()
        number = url.rstrip('/').split('/')[-1]
        issue_map[task['id']] = int(number)
        print(f\"  ✓ Task {task['id']}: {task['title']} → Issue #{number}\")
    else:
        print(f\"  ✗ Task {task['id']}: {task['title']} — {result.stderr.strip()}\", file=sys.stderr)

# Save issue mapping
with open('${sprint_dir}/issue-map.json', 'w') as f:
    json.dump(issue_map, f, indent=2)
"
  ok "GitHub issues created"
else
  warn "No GitHub repo configured — skipping issue creation"
  info "Issues can be created later after 'gh repo create'"
fi

# Save status
echo "planned" > "${sprint_dir}/.status"

echo ""
bold "Sprint ${sprint_id} planned successfully!"
echo ""
info "Sprint directory: ${sprint_dir}"
info "Next steps:"
echo "  1. Review the plan:    cat ${sprint_dir}/plan.json"
echo "  2. Review research:    cat ${sprint_dir}/research.md"
echo "  3. Approve the sprint: ./scripts/run-sprint.sh approve ${sprint_id}"
echo "  4. Execute the sprint: ./scripts/run-sprint.sh run ${sprint_id}"
