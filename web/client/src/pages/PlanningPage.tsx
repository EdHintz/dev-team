import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSprintDetail, approveSprint } from '../hooks/use-sprint.js';
import { useWebSocket } from '../hooks/use-websocket.js';
import { SprintStatusBadge } from '../components/StatusBadge.js';
import { TaskList } from '../components/TaskList.js';
import { LogViewer } from '../components/LogViewer.js';
import type { ServerEvent, DeveloperIdentity } from '@shared/types.js';

export function PlanningPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { sprint, loading, refresh } = useSprintDetail(id);
  const { subscribe } = useWebSocket();
  const [researcherLogs, setResearcherLogs] = useState<string[]>([]);
  const [plannerLogs, setPlannerLogs] = useState<string[]>([]);
  const [logsInitialized, setLogsInitialized] = useState(false);
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    return subscribe((event: ServerEvent) => {
      if ('sprintId' in event && event.sprintId !== id) return;

      switch (event.type) {
        case 'sprint:status':
          refresh();
          if (event.status === 'running' || event.status === 'approved') {
            navigate(`/sprint/${id}`);
          }
          break;
        case 'task:log':
          if (event.developerId === 'researcher') {
            setResearcherLogs((prev) => {
              if (prev.length > 0 && prev[prev.length - 1] === event.line) return prev;
              return [...prev.slice(-500), event.line];
            });
          } else if (event.developerId === 'planner') {
            setPlannerLogs((prev) => {
              if (prev.length > 0 && prev[prev.length - 1] === event.line) return prev;
              return [...prev.slice(-500), event.line];
            });
          }
          break;
      }
    });
  }, [id, subscribe, refresh, navigate]);

  // Load persisted role logs once when sprint data arrives
  useEffect(() => {
    if (!sprint?.roleLogs || logsInitialized) return;
    const logs = sprint.roleLogs;
    if (logs.researcher) setResearcherLogs(logs.researcher);
    if (logs.planner) setPlannerLogs(logs.planner);
    setLogsInitialized(true);
  }, [sprint?.roleLogs, logsInitialized]);

  const [approveError, setApproveError] = useState<string | null>(null);

  const handleApprove = async () => {
    if (!id) return;
    setApproving(true);
    setApproveError(null);
    try {
      await approveSprint(id);
      // Navigate immediately — don't wait for WebSocket
      navigate(`/sprint/${id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Approval failed';
      console.error('Approval failed:', msg);
      setApproveError(msg);
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

  const developerColors: Record<string, string> = {};
  const developerNames: Record<string, string> = {};
  (sprint.developers || []).forEach((impl: DeveloperIdentity) => {
    developerColors[impl.id] = impl.color;
    developerNames[impl.id] = impl.name;
  });

  const isWaiting = sprint.status === 'researching' || sprint.status === 'planning';
  const isReady = sprint.status === 'awaiting-approval';

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <a href="/" className="text-gray-500 hover:text-gray-300 text-sm">&larr; Back</a>
        <h1 className="text-xl font-bold text-white">
          {sprint.name || id}
          {sprint.name && <span className="text-gray-500 font-normal text-base ml-2">({id})</span>}
        </h1>
        <SprintStatusBadge status={sprint.status} />
      </div>

      {(isWaiting || researcherLogs.length > 0 || plannerLogs.length > 0) && (
        <div className="mb-6 space-y-4">
          {(sprint.status === 'researching' || researcherLogs.length > 0) && (
            <div className="border border-cyan-800 rounded-lg p-4 bg-gray-900">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 rounded-full bg-cyan-500" />
                <h3 className="text-sm font-semibold text-cyan-400">Researcher</h3>
                {sprint.status === 'researching' && (
                  <span className="text-xs text-cyan-600 animate-pulse">Analyzing codebase...</span>
                )}
              </div>
              <LogViewer lines={researcherLogs} maxHeight={sprint.status === 'researching' ? '500px' : '200px'} />
            </div>
          )}

          {(sprint.status === 'planning' || plannerLogs.length > 0) && (
            <div className="border border-indigo-800 rounded-lg p-4 bg-gray-900">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 rounded-full bg-indigo-500" />
                <h3 className="text-sm font-semibold text-indigo-400">Planner</h3>
                {sprint.status === 'planning' && (
                  <span className="text-xs text-indigo-600 animate-pulse">Creating task plan...</span>
                )}
              </div>
              <LogViewer lines={plannerLogs} maxHeight={sprint.status === 'planning' ? '500px' : '200px'} />
            </div>
          )}
        </div>
      )}

      {isReady && sprint.plan && (
        <div>
          <div className="mb-6">
            <h2 className="text-lg font-medium text-white mb-2">Sprint Plan</h2>
            <div className="text-sm text-gray-400 mb-4">
              {sprint.plan.tasks.length} tasks across {sprint.developers?.length || 1} developer(s)
            </div>

            {sprint.plan.estimates && (() => {
              const est = sprint.plan.estimates;
              return (
                <div className="flex gap-6 mb-4 p-3 bg-gray-800 rounded-lg border border-gray-700">
                  <div className="flex items-center gap-2">
                    <span className="text-lg" role="img" aria-label="AI team">&#x1F916;</span>
                    <div>
                      <div className="text-xs text-gray-500">AI Dev Team</div>
                      <div className="text-sm font-medium text-blue-300">
                        {est.ai_team}
                      </div>
                    </div>
                  </div>
                  <div className="border-l border-gray-700" />
                  <div className="flex items-center gap-2">
                    <span className="text-lg" role="img" aria-label="Human team">&#x1F465;</span>
                    <div>
                      <div className="text-xs text-gray-500">Human Team ({sprint.developers?.length || 1} dev{(sprint.developers?.length || 1) > 1 ? 's' : ''})</div>
                      <div className="text-sm font-medium text-gray-300">{est.human_team}</div>
                    </div>
                  </div>
                  {est.ai_team_minutes > 0 && est.human_team_minutes > 0 && (
                    <>
                      <div className="border-l border-gray-700" />
                      <div className="flex items-center gap-2">
                        <span className="text-lg">&#x26A1;</span>
                        <div>
                          <div className="text-xs text-gray-500">Speedup</div>
                          <div className="text-sm font-medium text-blue-300">{Math.round(est.human_team_minutes / est.ai_team_minutes)}x faster</div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })()}

            {sprint.developers && sprint.developers.length > 1 && (
              <div className="flex gap-4 mb-4">
                {sprint.developers.map((impl: DeveloperIdentity) => {
                  const taskCount = sprint.plan!.tasks.filter((t) => t.assigned_to === impl.id).length;
                  return (
                    <div key={impl.id} className="flex items-center gap-2 text-sm">
                      <img
                        src={impl.avatar}
                        alt={impl.name}
                        className="w-6 h-6 rounded-full"
                        style={{ backgroundColor: impl.color + '15' }}
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
              developerColors={developerColors}
              developerNames={developerNames}
            />
          </div>

          {approveError && (
            <div className="text-red-400 text-sm mb-3 p-3 bg-red-900/20 border border-red-800 rounded">
              {approveError}
            </div>
          )}

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
