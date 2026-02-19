import type { DeveloperIdentity, TaskState } from '@shared/types.js';
import { TaskStatusBadge } from './StatusBadge.js';
import { LogViewer } from './LogViewer.js';

interface DeveloperPanelProps {
  developer: DeveloperIdentity;
  currentTask?: TaskState & { title?: string };
  logLines: string[];
  completedCount: number;
  totalCount: number;
}

export function DeveloperPanel({
  developer,
  currentTask,
  logLines,
  completedCount,
  totalCount,
}: DeveloperPanelProps) {
  return (
    <div className="border border-gray-800 rounded-lg p-4" style={{ borderLeftColor: developer.color, borderLeftWidth: 3 }}>
      <div className="flex items-center gap-3 mb-3">
        <img
          src={developer.avatar}
          alt={developer.name}
          className="w-8 h-8 rounded-full"
          style={{ backgroundColor: developer.color + '15' }}
        />
        <div>
          <div className="font-medium text-white">{developer.name}</div>
          <div className="text-xs text-gray-500">
            {completedCount}/{totalCount} tasks
          </div>
        </div>
      </div>

      {currentTask && (
        <div className="mb-3">
          <div className="flex items-center gap-2 text-sm">
            <TaskStatusBadge status={currentTask.status} />
            <span className="text-gray-500 font-mono text-xs">#{currentTask.taskId}</span>
            <span className="text-gray-300">{currentTask.title || `Task ${currentTask.taskId}`}</span>
          </div>
        </div>
      )}

      <LogViewer lines={logLines} maxHeight="200px" />
    </div>
  );
}
