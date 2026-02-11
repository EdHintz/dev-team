import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSprintDetail } from '../hooks/use-sprint.js';
import { useWebSocket } from '../hooks/use-websocket.js';
import { SprintStatusBadge } from '../components/StatusBadge.js';
import { LogViewer } from '../components/LogViewer.js';
import { CostTracker } from '../components/CostTracker.js';
import type { ServerEvent } from '@shared/types.js';

export function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { sprint, loading, refresh } = useSprintDetail(id);
  const { subscribe } = useWebSocket();
  const [logLines, setLogLines] = useState<string[]>([]);
  const [reviewStatus, setReviewStatus] = useState<string>('');
  const [cycle, setCycle] = useState(1);

  useEffect(() => {
    return subscribe((event: ServerEvent) => {
      if ('sprintId' in event && event.sprintId !== id) return;

      switch (event.type) {
        case 'sprint:status':
          refresh();
          if (event.status === 'pr-created') {
            // Stay on review page to show the PR link
          }
          break;
        case 'review:update':
          setCycle(event.cycle);
          setReviewStatus(String(event.status));
          break;
        case 'task:log':
          setLogLines((prev) => [...prev.slice(-500), event.line]);
          break;
      }
    });
  }, [id, subscribe, refresh]);

  if (loading) return <div className="text-gray-500">Loading...</div>;
  if (!sprint) return <div className="text-red-400">Sprint not found</div>;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <a href="/" className="text-gray-500 hover:text-gray-300 text-sm">&larr; Back</a>
        <h1 className="text-xl font-bold text-white">{id}</h1>
        <SprintStatusBadge status={sprint.status} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="border border-gray-800 rounded-lg p-4 mb-4">
            <h2 className="text-lg font-medium text-white mb-3">Review</h2>

            <div className="flex items-center gap-4 mb-4">
              <div className="text-sm text-gray-400">
                Cycle: <span className="text-white">{cycle}/3</span>
              </div>
              {reviewStatus && (
                <span className={`text-sm ${reviewStatus === 'approved' ? 'text-green-400' : 'text-yellow-400'}`}>
                  {reviewStatus}
                </span>
              )}
            </div>

            {sprint.status === 'reviewing' && (
              <div className="flex items-center gap-3 mb-4">
                <div className="w-4 h-4 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-orange-300">Review in progress...</span>
              </div>
            )}

            {sprint.status === 'pr-created' && (
              <div className="bg-green-900/30 border border-green-800 rounded p-3 text-green-300 text-sm">
                PR created successfully. Check your GitHub repository.
              </div>
            )}

            <LogViewer lines={logLines} maxHeight="400px" />
          </div>
        </div>

        <div>
          <CostTracker costs={sprint.costs} />

          <div className="mt-6">
            <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Actions</h3>
            <div className="space-y-2">
              <button
                onClick={() => navigate(`/sprint/${id}`)}
                className="w-full px-4 py-2 bg-gray-800 text-gray-300 rounded hover:bg-gray-700 text-sm"
              >
                View Tasks
              </button>
              <button
                onClick={() => navigate('/')}
                className="w-full px-4 py-2 bg-gray-800 text-gray-300 rounded hover:bg-gray-700 text-sm"
              >
                Dashboard
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
