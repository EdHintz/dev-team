import { useState } from 'react';
import type { CostData } from '@shared/types.js';

interface CostTrackerProps {
  costs: CostData;
}

export function CostTracker({ costs }: CostTrackerProps) {
  const agents = Object.entries(costs.by_agent);
  const [expanded, setExpanded] = useState(false);

  if (agents.length === 0) return null;

  const total = agents.reduce((sum, [, s]) => sum + s, 0);

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition"
      >
        <span className="text-gray-600">&#9201;</span>
        <span>{formatDuration(total)}</span>
        <span className="text-[10px]">{expanded ? '\u25B2' : '\u25BC'}</span>
      </button>

      {expanded && (
        <div className="absolute top-full right-0 mt-1 z-10 bg-gray-800 border border-gray-700 rounded-lg p-3 min-w-[160px] shadow-lg">
          <div className="space-y-1.5">
            {agents.map(([agent, seconds]) => (
              <div key={agent} className="flex justify-between text-xs gap-4">
                <span className="text-gray-400">{agent}</span>
                <span className="text-gray-500 tabular-nums">{formatDuration(seconds)}</span>
              </div>
            ))}
            <div className="border-t border-gray-700 pt-1.5 mt-1.5 flex justify-between text-xs font-medium">
              <span className="text-gray-300">Total</span>
              <span className="text-gray-300 tabular-nums">{formatDuration(total)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}
