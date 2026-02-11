import type { CostData } from '@shared/types.js';

interface CostTrackerProps {
  costs: CostData;
}

export function CostTracker({ costs }: CostTrackerProps) {
  const agents = Object.entries(costs.by_agent);

  if (agents.length === 0) {
    return (
      <div className="text-xs text-gray-600">No cost data yet</div>
    );
  }

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider">Duration by Agent</h4>
      {agents.map(([agent, seconds]) => (
        <div key={agent} className="flex justify-between text-xs">
          <span className="text-gray-400">{agent}</span>
          <span className="text-gray-500">{formatDuration(seconds)}</span>
        </div>
      ))}
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}
