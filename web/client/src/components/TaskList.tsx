import type { Task, TaskState } from '@shared/types.js';
import { TaskStatusBadge } from './StatusBadge.js';

interface TaskListProps {
  tasks: Task[];
  taskStates: TaskState[];
  developerColors?: Record<string, string>;
  developerNames?: Record<string, string>;
  onRetryTask?: (taskId: number) => void;
}

export function TaskList({ tasks, taskStates, developerColors = {}, developerNames = {}, onRetryTask }: TaskListProps) {
  const stateMap = new Map(taskStates.map((s) => [s.taskId, s]));

  return (
    <div className="space-y-2">
      {tasks.map((task) => {
        const state = stateMap.get(task.id);
        const status = state?.status || 'pending';
        const color = task.assigned_to ? developerColors[task.assigned_to] : undefined;

        return (
          <div
            key={task.id}
            className="border border-gray-800 rounded p-3 hover:border-gray-700 transition"
            style={color ? { borderLeftColor: color, borderLeftWidth: 3 } : undefined}
          >
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs text-gray-600 shrink-0">#{task.id}</span>
              <TaskStatusBadge status={status} />
              {task.wave && (
                <span className="text-xs text-gray-600">Wave {task.wave}</span>
              )}
              {task.assigned_to && (
                <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: (color || '#666') + '20', color: color || '#999' }}>
                  {developerNames[task.assigned_to] || task.assigned_to}
                </span>
              )}
            </div>
            <div className="text-sm text-gray-200">{task.title}</div>
            {task.files_touched && task.files_touched.length > 0 && (
              <div className="mt-1 text-xs text-gray-600">
                Files: {task.files_touched.join(', ')}
              </div>
            )}
            {status === 'failed' && onRetryTask && (
              <button
                onClick={(e) => { e.stopPropagation(); onRetryTask(task.id); }}
                className="mt-2 px-2 py-1 bg-yellow-600 text-white rounded text-xs hover:bg-yellow-500"
              >
                Retry
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
