import type { SprintStatus, TaskStatus } from '@shared/types.js';

const SPRINT_COLORS: Record<SprintStatus, string> = {
  created: 'bg-gray-700 text-gray-300',
  researching: 'bg-blue-900 text-blue-300',
  planning: 'bg-blue-900 text-blue-300',
  'awaiting-approval': 'bg-yellow-900 text-yellow-300',
  approved: 'bg-green-900 text-green-300',
  running: 'bg-purple-900 text-purple-300',
  paused: 'bg-amber-900 text-amber-300',
  reviewing: 'bg-orange-900 text-orange-300',
  'pr-created': 'bg-green-900 text-green-300',
  completed: 'bg-green-800 text-green-200',
  failed: 'bg-red-900 text-red-300',
  cancelled: 'bg-gray-800 text-gray-400',
};

const TASK_COLORS: Record<TaskStatus, string> = {
  pending: 'bg-gray-700 text-gray-300',
  queued: 'bg-blue-900 text-blue-300',
  'in-progress': 'bg-purple-900 text-purple-300',
  completed: 'bg-green-900 text-green-300',
  failed: 'bg-red-900 text-red-300',
  blocked: 'bg-yellow-900 text-yellow-300',
};

export function SprintStatusBadge({ status }: { status: SprintStatus }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${SPRINT_COLORS[status] || 'bg-gray-700 text-gray-300'}`}>
      {status}
    </span>
  );
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${TASK_COLORS[status] || 'bg-gray-700 text-gray-300'}`}>
      {status}
    </span>
  );
}
