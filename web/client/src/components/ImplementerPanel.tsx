import type { ImplementerIdentity, TaskState } from '@shared/types.js';
import { TaskStatusBadge } from './StatusBadge.js';
import { LogViewer } from './LogViewer.js';

interface ImplementerPanelProps {
  implementer: ImplementerIdentity;
  currentTask?: TaskState & { title?: string };
  logLines: string[];
  completedCount: number;
  totalCount: number;
}

export function ImplementerPanel({
  implementer,
  currentTask,
  logLines,
  completedCount,
  totalCount,
}: ImplementerPanelProps) {
  return (
    <div className="border border-gray-800 rounded-lg p-4" style={{ borderLeftColor: implementer.color, borderLeftWidth: 3 }}>
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
          style={{ backgroundColor: implementer.color + '30', color: implementer.color }}
        >
          {implementer.name[0]}
        </div>
        <div>
          <div className="font-medium text-white">{implementer.name}</div>
          <div className="text-xs text-gray-500">
            {completedCount}/{totalCount} tasks
          </div>
        </div>
      </div>

      {currentTask && (
        <div className="mb-3">
          <div className="flex items-center gap-2 text-sm">
            <TaskStatusBadge status={currentTask.status} />
            <span className="text-gray-300">{currentTask.title || `Task ${currentTask.taskId}`}</span>
          </div>
        </div>
      )}

      <LogViewer lines={logLines} maxHeight="200px" />
    </div>
  );
}
