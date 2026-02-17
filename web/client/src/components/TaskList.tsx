import { useState } from 'react';
import type { Task, TaskState } from '@shared/types.js';
import { TaskStatusBadge } from './StatusBadge.js';

interface TaskListProps {
  tasks: Task[];
  taskStates: TaskState[];
  developerColors?: Record<string, string>;
  developerNames?: Record<string, string>;
  onRetryTask?: (taskId: number) => void;
}

const complexityColors: Record<string, string> = {
  small: 'bg-green-900 text-green-300',
  medium: 'bg-yellow-900 text-yellow-300',
  large: 'bg-red-900 text-red-300',
};

export function TaskList({ tasks, taskStates, developerColors = {}, developerNames = {}, onRetryTask }: TaskListProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const stateMap = new Map(taskStates.map((s) => [s.taskId, s]));

  return (
    <div className="space-y-2">
      {tasks.map((task) => {
        const state = stateMap.get(task.id);
        const status = state?.status || 'pending';
        const isBug = task.type === 'bug';
        const color = isBug ? '#EF4444' : (task.assigned_to ? developerColors[task.assigned_to] : undefined);
        const isExpanded = expandedId === task.id;

        return (
          <div
            key={task.id}
            className="border border-gray-800 rounded p-3 hover:border-gray-700 transition cursor-pointer"
            style={color ? { borderLeftColor: color, borderLeftWidth: 3 } : undefined}
            onClick={() => setExpandedId(isExpanded ? null : task.id)}
          >
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <svg
                className={`w-3 h-3 text-gray-500 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
              </svg>
              <span className="text-xs text-gray-600 shrink-0">#{task.id}</span>
              {isBug && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-red-900 text-red-300 font-medium">bug</span>
              )}
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
            {isExpanded && (
              <div className="mt-3 pt-3 border-t border-gray-800 space-y-2 text-sm">
                {task.description && (
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Description</div>
                    <div className="text-gray-300 whitespace-pre-wrap">{task.description}</div>
                  </div>
                )}
                {task.acceptance_criteria && task.acceptance_criteria.length > 0 && (
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Acceptance Criteria</div>
                    <ul className="space-y-1">
                      {task.acceptance_criteria.map((criterion, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-gray-300">
                          <span className="text-gray-600 shrink-0 mt-0.5">&#9744;</span>
                          <span>{criterion}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {task.depends_on && task.depends_on.length > 0 && (
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Dependencies</div>
                    <div className="text-gray-300">
                      Depends on: {task.depends_on.map((id) => `#${id}`).join(', ')}
                    </div>
                  </div>
                )}
                {isBug && task.reviewCycle !== undefined && (
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Review Cycle</div>
                    <div className="text-gray-300">From review cycle {task.reviewCycle}</div>
                  </div>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  {task.complexity && (
                    <span className={`text-xs px-1.5 py-0.5 rounded ${complexityColors[task.complexity]}`}>
                      {task.complexity}
                    </span>
                  )}
                  {task.labels && task.labels.map((label) => (
                    <span key={label} className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
                      {label}
                    </span>
                  ))}
                </div>
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
