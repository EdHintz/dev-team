#!/usr/bin/env bash
set -euo pipefail

# Phase 3: Review + Test cycle
# Usage: ./scripts/review-sprint.sh <sprint-id> [--target <project-dir>]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/config.sh"
source "${SCRIPT_DIR}/lib/agent.sh"

sprint_id="$1"
shift || true

target_dir=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) target_dir="$2"; shift 2 ;;
    *)        shift ;;
  esac
done

sprint_dir="${SPRINTS_DIR}/${sprint_id}"
target_dir="${target_dir:-$(pwd)}"

if [[ ! -d "$sprint_dir" ]]; then
  err "Sprint not found: ${sprint_id}"
  exit 1
fi

sprint_branch="sprint/${sprint_id}"
base_branch="main"

# Ensure we're on the sprint branch
git -C "$target_dir" checkout "$sprint_branch" 2>/dev/null || true

bold "Review Cycle — Sprint ${sprint_id}"
echo ""

fix_cycle=0

while [[ $fix_cycle -lt $MAX_FIX_CYCLES ]]; do
  fix_cycle=$((fix_cycle + 1))
  info "Review cycle ${fix_cycle}/${MAX_FIX_CYCLES}"
  echo ""

  # --- Run Tests ---
  info "Running tester agent..."

  test_prompt="$(cat <<EOF
Run the test suite for the project at ${target_dir}.

Sprint: ${sprint_id}

1. Read the research at ${sprint_dir}/research.md to understand the test setup
2. Run the existing tests (npm test, or equivalent)
3. If there are implemented features without tests, write tests for them
4. Stage any new test files with git add
5. Report the test results
EOF
)"

  test_output=$(run_agent "tester" "$test_prompt" \
    --budget "$DEFAULT_TEST_BUDGET" \
    --sprint "$sprint_id" \
    --task "review-tests-${fix_cycle}" \
    --cwd "$target_dir") || true

  # Commit any new test files
  if git -C "$target_dir" diff --cached --quiet 2>/dev/null; then
    : # nothing staged
  else
    git -C "$target_dir" commit -m "$(cat <<EOF
test(${sprint_id}): add tests from review cycle ${fix_cycle}

Sprint: ${sprint_id}

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)" 2>/dev/null || true
  fi

  # --- Run Review ---
  info "Running reviewer agent..."

  # Get the diff for review
  diff_content=$(git -C "$target_dir" diff "${base_branch}...${sprint_branch}" 2>/dev/null || \
    git -C "$target_dir" log --oneline -20 2>/dev/null || echo "No diff available")

  review_prompt="$(cat <<EOF
Review the sprint ${sprint_id} changes.

## Sprint Plan
$(cat "${sprint_dir}/plan.json" 2>/dev/null || echo "No plan available")

## Research Context
$(cat "${sprint_dir}/research.md" 2>/dev/null || echo "No research available")

## Diff
${diff_content}

Provide your review following the format in your agent definition.
Run tests and linters if available.
EOF
)"

  review_output=$(run_agent "reviewer" "$review_prompt" \
    --budget "$DEFAULT_REVIEW_BUDGET" \
    --sprint "$sprint_id" \
    --task "review-${fix_cycle}" \
    --cwd "$target_dir") || true

  # Save review output
  echo "$review_output" > "${sprint_dir}/review-${fix_cycle}.md"
  ok "Review saved: ${sprint_dir}/review-${fix_cycle}.md"

  # Check if review passed
  if echo "$review_output" | grep -qi "APPROVE"; then
    echo ""
    ok "Review APPROVED (cycle ${fix_cycle})"
    echo "approved" > "${sprint_dir}/.review-status"
    break
  fi

  # Check for MUST-FIX items
  if echo "$review_output" | grep -qi "MUST-FIX\|REQUEST_CHANGES"; then
    warn "Review found issues that need fixing"

    if [[ $fix_cycle -ge $MAX_FIX_CYCLES ]]; then
      err "Max fix cycles (${MAX_FIX_CYCLES}) reached. Manual intervention needed."
      echo "needs-manual-review" > "${sprint_dir}/.review-status"
      break
    fi

    echo ""
    info "Running developer to fix review issues..."

    fix_prompt="$(cat <<EOF
The code reviewer found issues in sprint ${sprint_id}. Fix them.

## Review Feedback
${review_output}

## Instructions
1. Read the files mentioned in the review
2. Fix all MUST-FIX items
3. Fix SHOULD-FIX items where reasonable
4. Run tests after fixing
5. Stage your changes with git add
EOF
)"

    run_agent "developer" "$fix_prompt" \
      --budget "$DEFAULT_TASK_BUDGET" \
      --sprint "$sprint_id" \
      --task "fix-${fix_cycle}" \
      --cwd "$target_dir" || true

    # Commit fixes
    git -C "$target_dir" add -A
    git -C "$target_dir" commit -m "$(cat <<EOF
fix(${sprint_id}): address review feedback (cycle ${fix_cycle})

Sprint: ${sprint_id}

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)" 2>/dev/null || warn "Nothing to commit after fix cycle"

  else
    # No MUST-FIX items but also no explicit APPROVE — treat as approved
    ok "Review complete (no must-fix items)"
    echo "approved" > "${sprint_dir}/.review-status"
    break
  fi
done

echo ""
bold "Review cycle complete for sprint ${sprint_id}"

review_status=$(cat "${sprint_dir}/.review-status" 2>/dev/null || echo "unknown")
if [[ "$review_status" == "approved" ]]; then
  info "Next: ./scripts/create-pr.sh ${sprint_id}"
else
  warn "Sprint needs manual review before PR creation"
  info "Review output: ${sprint_dir}/review-${fix_cycle}.md"
fi
