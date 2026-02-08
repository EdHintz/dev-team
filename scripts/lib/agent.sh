#!/usr/bin/env bash
# Claude CLI wrappers for agent invocation

_AGENT_SH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=config.sh
[[ -z "$PROJECT_ROOT" ]] && source "${_AGENT_SH_DIR}/config.sh"

# Get the model flag for an agent type
get_model_for_agent() {
  local agent="$1"
  case "$agent" in
    planner)     echo "$PLANNER_MODEL" ;;
    researcher)  echo "$RESEARCHER_MODEL" ;;
    implementer) echo "$IMPLEMENTER_MODEL" ;;
    reviewer)    echo "$REVIEWER_MODEL" ;;
    tester)      echo "$TESTER_MODEL" ;;
    *)           echo "sonnet" ;;
  esac
}

# Run a claude agent with logging and cost tracking
#
# Usage: run_agent <agent-name> <prompt> [--budget <amount>] [--max-turns <n>] [--sprint <id>] [--task <id>]
run_agent() {
  local agent_name="$1"
  local prompt="$2"
  shift 2

  local budget=""
  local max_turns=""
  local sprint_id=""
  local task_id=""
  local cwd=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --budget)     budget="$2"; shift 2 ;;
      --max-turns)  max_turns="$2"; shift 2 ;;
      --sprint)     sprint_id="$2"; shift 2 ;;
      --task)       task_id="$2"; shift 2 ;;
      --cwd)        cwd="$2"; shift 2 ;;
      *)            shift ;;
    esac
  done

  local model
  model=$(get_model_for_agent "$agent_name")

  local agent_file="${AGENTS_DIR}/${agent_name}.md"
  if [[ ! -f "$agent_file" ]]; then
    err "Agent definition not found: ${agent_file}"
    return 1
  fi

  # Set up logging
  local log_file="/dev/null"
  if [[ -n "$sprint_id" ]]; then
    local log_dir="${SPRINTS_DIR}/${sprint_id}/logs"
    mkdir -p "$log_dir"
    local timestamp
    timestamp=$(date +%Y%m%d-%H%M%S)
    log_file="${log_dir}/${agent_name}-${task_id:-general}-${timestamp}.log"
  fi

  # Build claude command
  # --dangerously-skip-permissions is needed for --print mode since agents
  # can't prompt for tool approval. The orchestrator provides human oversight.
  local cmd=(claude --print --model "$model" --agent "$agent_name" --dangerously-skip-permissions)

  if [[ -n "$budget" ]]; then
    cmd+=(--max-budget-usd "$budget")
  fi

  info "Running ${BOLD}${agent_name}${NC} agent (model: ${model})..."

  local start_time
  start_time=$(date +%s)

  # Execute agent
  local output
  local exit_code
  if [[ -n "$cwd" ]]; then
    output=$(cd "$cwd" && "${cmd[@]}" "$prompt" 2>&1) || exit_code=$?
  else
    output=$("${cmd[@]}" "$prompt" 2>&1) || exit_code=$?
  fi
  exit_code=${exit_code:-0}

  local end_time
  end_time=$(date +%s)
  local duration=$(( end_time - start_time ))

  # Log output
  {
    echo "=== Agent: ${agent_name} ==="
    echo "=== Model: ${model} ==="
    echo "=== Sprint: ${sprint_id:-none} ==="
    echo "=== Task: ${task_id:-none} ==="
    echo "=== Duration: ${duration}s ==="
    echo "=== Exit Code: ${exit_code} ==="
    echo "=== Output ==="
    echo "$output"
  } > "$log_file"

  # Track cost if in a sprint
  if [[ -n "$sprint_id" ]]; then
    track_cost "$sprint_id" "$agent_name" "$task_id" "$duration"
  fi

  if [[ $exit_code -ne 0 ]]; then
    err "Agent ${agent_name} exited with code ${exit_code}"
    err "Log: ${log_file}"
  else
    ok "Agent ${agent_name} completed in ${duration}s"
  fi

  echo "$output"
  return $exit_code
}

# Track cost (duration-based estimate since we can't get exact API costs)
track_cost() {
  local sprint_id="$1"
  local agent_name="$2"
  local task_id="$3"
  local duration="$4"

  local cost_file="${SPRINTS_DIR}/${sprint_id}/cost.json"
  [[ ! -f "$cost_file" ]] && echo '{"total": 0, "by_agent": {}, "by_task": {}}' > "$cost_file"

  python3 -c "
import json

with open('${cost_file}') as f:
    costs = json.load(f)

# Record the session duration (actual cost comes from claude CLI output if available)
entry = {
    'agent': '${agent_name}',
    'task': '${task_id}',
    'duration_seconds': ${duration}
}

costs.setdefault('sessions', []).append(entry)
costs['by_agent'].setdefault('${agent_name}', 0)
costs['by_agent']['${agent_name}'] += ${duration}
if '${task_id}':
    costs['by_task'].setdefault('${task_id}', 0)
    costs['by_task']['${task_id}'] += ${duration}

with open('${cost_file}', 'w') as f:
    json.dump(costs, f, indent=2)
" 2>/dev/null || warn "Could not update cost tracker"
}

# Run an agent and capture only its structured output (last JSON block or specific markers)
run_agent_json() {
  local output
  output=$(run_agent "$@")
  local exit_code=$?

  # Extract the last JSON block from output
  echo "$output" | python3 -c "
import sys, json, re

text = sys.stdin.read()
# Find all JSON blocks (between { } or [ ])
blocks = re.findall(r'(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|\[[^\[\]]*(?:\[[^\[\]]*\][^\[\]]*)*\])', text, re.DOTALL)

if blocks:
    # Try to parse from last to first, return first valid JSON
    for block in reversed(blocks):
        try:
            parsed = json.loads(block)
            print(json.dumps(parsed, indent=2))
            sys.exit(0)
        except json.JSONDecodeError:
            continue

# If no valid JSON found, output as-is
print(text, file=sys.stderr)
sys.exit(1)
" 2>/dev/null

  return $exit_code
}
