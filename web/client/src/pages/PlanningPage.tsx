import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSprintDetail, approveSprint } from '../hooks/use-sprint.js';
import { useWebSocket } from '../hooks/use-websocket.js';
import { SprintStatusBadge } from '../components/StatusBadge.js';
import { TaskList } from '../components/TaskList.js';
import { LogViewer } from '../components/LogViewer.js';
import type { ServerEvent, ImplementerIdentity } from '@shared/types.js';

export function PlanningPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { sprint, loading, refresh } = useSprintDetail(id);
  const { subscribe } = useWebSocket();
  const [logLines, setLogLines] = useState<string[]>([]);
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    return subscribe((event: ServerEvent) => {
      if ('sprintId' in event && event.sprintId !== id) return;

      switch (event.type) {
        case 'sprint:status':
          refresh();
          if (event.status === 'running') {
            navigate(`/sprint/${id}`);
          }
          break;
        case 'task:log':
          setLogLines((prev) => [...prev.slice(-500), event.line]);
          break;
      }
    });
  }, [id, subscribe, refresh, navigate]);

  const handleApprove = async () => {
    if (!id) return;
    setApproving(true);
    try {
      await approveSprint(id);
    } catch (err) {
      console.error('Approval failed:', err);
    } finally {
      setApproving(false);
    }
  };

  if (loading) {
    return <div className="text-gray-500">Loading...</div>;
  }

  if (!sprint) {
    return <div className="text-red-400">Sprint not found</div>;
  }

  const implementerColors: Record<string, string> = {};
  (sprint.implementers || []).forEach((impl: ImplementerIdentity) => {
    implementerColors[impl.id] = impl.color;
  });

  const isWaiting = sprint.status === 'researching' || sprint.status === 'planning';
  const isReady = sprint.status === 'awaiting-approval';

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <a href="/" className="text-gray-500 hover:text-gray-300 text-sm">&larr; Back</a>
        <h1 className="text-xl font-bold text-white">{id}</h1>
        <SprintStatusBadge status={sprint.status} />
      </div>

      {isWaiting && (
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-blue-300">
              {sprint.status === 'researching' ? 'Analyzing codebase...' : 'Creating task plan...'}
            </span>
          </div>
          <LogViewer lines={logLines} maxHeight="400px" />
        </div>
      )}

      {isReady && sprint.plan && (
        <div>
          <div className="mb-6">
            <h2 className="text-lg font-medium text-white mb-2">Sprint Plan</h2>
            <div className="text-sm text-gray-400 mb-4">
              {sprint.plan.tasks.length} tasks across {sprint.implementers?.length || 1} implementer(s)
            </div>

            {sprint.implementers && sprint.implementers.length > 1 && (
              <div className="flex gap-4 mb-4">
                {sprint.implementers.map((impl: ImplementerIdentity) => {
                  const taskCount = sprint.plan!.tasks.filter((t) => t.assigned_to === impl.id).length;
                  return (
                    <div key={impl.id} className="flex items-center gap-2 text-sm">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: impl.color }}
                      />
                      <span className="text-gray-300">{impl.name}</span>
                      <span className="text-gray-600">({taskCount} tasks)</span>
                    </div>
                  );
                })}
              </div>
            )}

            <TaskList
              tasks={sprint.plan.tasks}
              taskStates={sprint.tasks || []}
              implementerColors={implementerColors}
            />
          </div>

          <div className="flex gap-3 border-t border-gray-800 pt-4">
            <button
              onClick={handleApprove}
              disabled={approving}
              className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-500 text-sm disabled:opacity-50"
            >
              {approving ? 'Approving...' : 'Approve & Start'}
            </button>
            <button
              onClick={() => navigate('/')}
              className="px-4 py-2 bg-gray-800 text-gray-300 rounded hover:bg-gray-700 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
