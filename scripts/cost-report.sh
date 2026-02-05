#!/usr/bin/env bash
set -euo pipefail

# Cost report for a sprint
# Usage: ./scripts/cost-report.sh <sprint-id>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/config.sh"

sprint_id="$1"
sprint_dir="${SPRINTS_DIR}/${sprint_id}"
cost_file="${sprint_dir}/cost.json"

if [[ ! -f "$cost_file" ]]; then
  err "No cost data found for sprint ${sprint_id}"
  exit 1
fi

bold "Cost Report — Sprint ${sprint_id}"
echo ""

python3 -c "
import json

with open('${cost_file}') as f:
    costs = json.load(f)

# By agent
by_agent = costs.get('by_agent', {})
if by_agent:
    print('By Agent:')
    for agent, seconds in sorted(by_agent.items()):
        mins = seconds / 60
        print(f'  {agent:15s}  {seconds:6d}s  ({mins:.1f} min)')
    print()

# By task
by_task = costs.get('by_task', {})
if by_task:
    print('By Task:')
    for task, seconds in sorted(by_task.items(), key=lambda x: int(x[0]) if x[0].isdigit() else 0):
        mins = seconds / 60
        print(f'  Task {task:10s}  {seconds:6d}s  ({mins:.1f} min)')
    print()

# Sessions
sessions = costs.get('sessions', [])
if sessions:
    total_seconds = sum(s.get('duration_seconds', 0) for s in sessions)
    total_mins = total_seconds / 60
    print(f'Total Sessions: {len(sessions)}')
    print(f'Total Time:     {total_seconds}s ({total_mins:.1f} min)')
else:
    print('No sessions recorded yet.')
"
