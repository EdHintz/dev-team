import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSprintDetail, pauseSprint, resumeSprint, restartSprint, cancelSprint, retryTask } from '../hooks/use-sprint.js';
import { useWebSocket } from '../hooks/use-websocket.js';
import { SprintStatusBadge } from '../components/StatusBadge.js';
import { TaskList } from '../components/TaskList.js';
import { DeveloperPanel } from '../components/DeveloperPanel.js';
import { LogViewer } from '../components/LogViewer.js';

import { ApprovalDialog } from '../components/ApprovalDialog.js';
import { MonitorPanel } from '../components/MonitorPanel.js';
import { useMonitorChat, sendMonitorChat } from '../hooks/use-monitor.js';
import type { ServerEvent, DeveloperIdentity, TaskState, PlanEstimates, CostData } from '@shared/types.js';

interface PendingApproval {
  id: string;
  message: string;
  context?: unknown;
}

export function SprintPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { sprint, loading, refresh } = useSprintDetail(id);
  const { subscribe, send } = useWebSocket();

  const { messages: monitorMessages, typing: monitorTyping, addMessage: addMonitorMessage, setTyping: setMonitorTyping } = useMonitorChat(id);

  const [implLogs, setImplLogs] = useState<Record<string, string[]>>({});
  const [plannerLogs, setPlannerLogs] = useState<string[]>([]);
  const [testerLogs, setTesterLogs] = useState<string[]>([]);
  const [reviewerLogs, setReviewerLogs] = useState<string[]>([]);
  const [logsInitialized, setLogsInitialized] = useState(false);
  const [reviewCycle, setReviewCycle] = useState(0);
  const [reviewStatus, setReviewStatus] = useState('');
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [actionInProgress, setActionInProgress] = useState(false);

  const handleEvent = useCallback((event: ServerEvent) => {
    if ('sprintId' in event && event.sprintId !== id) return;

    switch (event.type) {
      case 'sprint:status':
        refresh();
        break;

      case 'task:status':
        refresh();
        break;

      case 'task:log':
        if (event.developerId === 'planner') {
          setPlannerLogs((prev) => {
            if (prev.length > 0 && prev[prev.length - 1] === event.line) return prev;
            return [...prev.slice(-300), event.line];
          });
        } else if (event.developerId === 'tester') {
          setTesterLogs((prev) => {
            if (prev.length > 0 && prev[prev.length - 1] === event.line) return prev;
            return [...prev.slice(-300), event.line];
          });
        } else if (event.developerId === 'reviewer') {
          setReviewerLogs((prev) => {
            if (prev.length > 0 && prev[prev.length - 1] === event.line) return prev;
            return [...prev.slice(-300), event.line];
          });
        } else {
          setImplLogs((prev) => {
            const existing = prev[event.developerId] || [];
            if (existing.length > 0 && existing[existing.length - 1] === event.line) return prev;
            return {
              ...prev,
              [event.developerId]: [...existing.slice(-300), event.line],
            };
          });
        }
        break;

      case 'wave:started':
      case 'wave:completed':
        refresh();
        break;

      case 'approval:required':
        setApproval({ id: event.id, message: event.message, context: event.context });
        break;

      case 'review:update':
        setReviewCycle(event.cycle);
        setReviewStatus(String(event.status));
        refresh();
        break;

      case 'cost:update':
        refresh();
        break;

      case 'monitor:message':
        addMonitorMessage(event.message);
        break;

      case 'monitor:typing':
        setMonitorTyping(event.active);
        break;
    }
  }, [id, refresh, addMonitorMessage, setMonitorTyping]);

  useEffect(() => {
    return subscribe(handleEvent);
  }, [subscribe, handleEvent]);

  // Load persisted role logs once when sprint data arrives
  useEffect(() => {
    if (!sprint?.roleLogs || logsInitialized) return;
    const logs = sprint.roleLogs;
    const newImplLogs: Record<string, string[]> = {};
    for (const [roleId, lines] of Object.entries(logs)) {
      if (roleId === 'planner') {
        setPlannerLogs(lines);
      } else if (roleId === 'tester') {
        setTesterLogs(lines);
      } else if (roleId === 'reviewer') {
        setReviewerLogs(lines);
      } else {
        newImplLogs[roleId] = lines;
      }
    }
    if (Object.keys(newImplLogs).length > 0) {
      setImplLogs(newImplLogs);
    }
    setLogsInitialized(true);
  }, [sprint?.roleLogs, logsInitialized]);

  // Sync review cycle from fetched sprint data (survives page refresh / reconnect)
  useEffect(() => {
    if (sprint?.reviewCycle && sprint.reviewCycle > reviewCycle) {
      setReviewCycle(sprint.reviewCycle);
    }
  }, [sprint?.reviewCycle]);

  const handlePause = async () => {
    if (!id) return;
    setActionInProgress(true);
    try {
      await pauseSprint(id);
      refresh();
    } catch (err) {
      console.error('Pause failed:', err);
    } finally {
      setActionInProgress(false);
    }
  };

  const handleResume = async () => {
    if (!id) return;
    setActionInProgress(true);
    try {
      await resumeSprint(id);
      refresh();
    } catch (err) {
      console.error('Resume failed:', err);
    } finally {
      setActionInProgress(false);
    }
  };

  const handleRestart = async () => {
    if (!id) return;
    setActionInProgress(true);
    try {
      await restartSprint(id);
      refresh();
    } catch (err) {
      console.error('Restart failed:', err);
    } finally {
      setActionInProgress(false);
    }
  };

  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const handleCancel = async () => {
    if (!id) return;
    setShowCancelConfirm(false);
    setActionInProgress(true);
    try {
      await cancelSprint(id);
      refresh();
    } catch (err) {
      console.error('Cancel failed:', err);
    } finally {
      setActionInProgress(false);
    }
  };

  const handleRetryTask = async (taskId: number) => {
    if (!id) return;
    try {
      await retryTask(id, taskId);
      refresh();
    } catch (err) {
      console.error('Retry failed:', err);
    }
  };

  const handleMonitorSend = useCallback(async (content: string) => {
    if (!id) return;
    await sendMonitorChat(id, content);
  }, [id]);

  if (loading) return <div className="text-gray-500">Loading...</div>;
  if (!sprint) return <div className="text-red-400">Sprint not found</div>;

  const developerColors: Record<string, string> = {};
  const developerNames: Record<string, string> = {};
  (sprint.developers || []).forEach((impl: DeveloperIdentity) => {
    developerColors[impl.id] = impl.color;
    developerNames[impl.id] = impl.name;
  });

  // Map task states for developers
  const taskStateMap = new Map((sprint.tasks || []).map((t: TaskState) => [t.taskId, t]));

  return (
    <div className="max-w-7xl mx-auto">
      {showCancelConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-gray-600 rounded-lg p-6 max-w-md mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-white mb-3">Cancel Sprint</h3>
            <p className="text-gray-300 mb-2">
              Are you sure you want to cancel this sprint?
              {isActiveStatus(sprint.status) && ' The sprint will be stopped.'}
            </p>
            <p className="text-amber-400 text-sm mb-5">
              Cancelled sprints cannot be restarted.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="px-4 py-2 text-sm text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 rounded transition-colors"
              >
                Keep Running
              </button>
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-500 rounded transition-colors"
              >
                Cancel Sprint
              </button>
            </div>
          </div>
        </div>
      )}

      {approval && (
        <ApprovalDialog
          message={approval.message}
          context={approval.context}
          onApprove={(comment, data) => {
            send({ type: 'approval:response', id: approval.id, approved: true, comment, data });
            setApproval(null);
          }}
          onReject={(comment) => {
            send({ type: 'approval:response', id: approval.id, approved: false, comment });
            setApproval(null);
          }}
        />
      )}

      <div className="mb-6">
        <div className="flex items-center gap-4 mb-2">
          <a href="/" className="text-gray-500 hover:text-gray-300 text-sm">&larr; Back</a>
          <h1 className="text-xl font-bold text-white">
            {sprint.name || id}
            {sprint.name && <span className="text-gray-500 font-normal text-base ml-2">({id})</span>}
          </h1>
          <SprintStatusBadge status={sprint.status} />
          {sprint.currentWave > 0 && (
            <span className="text-sm text-gray-500">Wave {sprint.currentWave}</span>
          )}
          {(sprint.taskCount ?? 0) > 0 && (
            <span className="text-sm text-gray-400">
              {sprint.completedCount ?? 0}/{sprint.taskCount}
              <span className="text-gray-500 ml-1">
                ({Math.round(((sprint.completedCount ?? 0) / (sprint.taskCount ?? 1)) * 100)}%)
              </span>
            </span>
          )}
          {isActiveStatus(sprint.status) && (
            <span className="flex items-center gap-1.5 text-xs text-green-400">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Working
            </span>
          )}
        {sprint.status === 'pr-created' && (
          <button
            onClick={() => navigate(`/sprint/${id}/review`)}
            className="px-3 py-1 bg-purple-600 text-white rounded text-sm hover:bg-purple-500"
            title="Review pull request and complete sprint"
          >
            Review & Complete
          </button>
        )}
        <div className="flex items-center gap-2 ml-auto">
        {(sprint.status === 'running' || sprint.status === 'researching' || sprint.status === 'planning' || sprint.status === 'reviewing') && (
          <button
            onClick={handlePause}
            disabled={actionInProgress}
            title="Pause sprint"
            className="p-1.5 text-gray-400 hover:text-amber-400 hover:bg-gray-700 rounded transition-colors disabled:opacity-50"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <rect x="3" y="2" width="4" height="12" rx="1" />
              <rect x="9" y="2" width="4" height="12" rx="1" />
            </svg>
          </button>
        )}
        {sprint.status === 'paused' && (
          <button
            onClick={handleResume}
            disabled={actionInProgress}
            title="Resume sprint"
            className="p-1.5 text-gray-400 hover:text-green-400 hover:bg-gray-700 rounded transition-colors disabled:opacity-50"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <polygon points="3,2 14,8 3,14" />
            </svg>
          </button>
        )}
        {(sprint.status === 'failed' || sprint.status === 'running' || sprint.status === 'paused' || sprint.status === 'reviewing') && (
          <button
            onClick={handleRestart}
            disabled={actionInProgress}
            title="Restart sprint from scratch"
            className="p-1.5 text-gray-400 hover:text-yellow-400 hover:bg-gray-700 rounded transition-colors disabled:opacity-50"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 3a5 5 0 1 0 5 5h-2a3 3 0 1 1-3-3V1l4 3-4 3V3z" />
            </svg>
          </button>
        )}
        {!['completed', 'pr-created', 'cancelled'].includes(sprint.status) && (
          <button
            onClick={() => setShowCancelConfirm(true)}
            disabled={actionInProgress}
            title="Cancel sprint"
            className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition-colors disabled:opacity-50 ml-2"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
            </svg>
          </button>
        )}
        </div>
        </div>
        {sprint.spec && (
          <div className="text-sm text-gray-400">
            <span className="text-gray-500">Spec:</span>{' '}
            <a
              href={`/api/sprints/${id}/spec`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline"
            >
              {sprint.spec}
            </a>
          </div>
        )}
        {sprint.plan?.estimates && (
          <EstimateLine estimates={sprint.plan.estimates} costs={sprint.costs} status={sprint.status} approvedAt={sprint.approvedAt} completedAt={sprint.completedAt} approvalWaitSeconds={sprint.approvalWaitSeconds} />
        )}
      </div>

      <MonitorPanel messages={monitorMessages} typing={monitorTyping} onSend={handleMonitorSend} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Task List */}
        <div className="lg:col-span-1">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">Tasks</h2>
          {sprint.plan && (
            <TaskList
              tasks={sprint.plan.tasks}
              taskStates={sprint.tasks || []}
              developerColors={developerColors}
              developerNames={developerNames}
              onRetryTask={handleRetryTask}
            />
          )}
        </div>

        {/* Right: Team Panels */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider">Team</h2>
          </div>

          <h3 className="text-xs font-medium text-gray-600 uppercase tracking-wider">Developers</h3>
          {(sprint.developers || []).map((impl: DeveloperIdentity) => {
            const implTasks = (sprint.plan?.tasks || []).filter((t) => t.assigned_to === impl.id);
            const currentTaskState = implTasks
              .map((t) => taskStateMap.get(t.id))
              .find((s) => s?.status === 'in-progress');
            const currentPlanTask = currentTaskState
              ? sprint.plan?.tasks.find((t) => t.id === currentTaskState.taskId)
              : undefined;
            const completedCount = implTasks.filter((t) => taskStateMap.get(t.id)?.status === 'completed').length;

            return (
              <DeveloperPanel
                key={impl.id}
                developer={impl}
                currentTask={currentTaskState ? { ...currentTaskState, title: currentPlanTask?.title } : undefined}
                logLines={implLogs[impl.id] || []}
                completedCount={completedCount}
                totalCount={implTasks.length}
              />
            );
          })}

          {/* Planner Section — visible if planner runs after approval (e.g. re-planning) */}
          {plannerLogs.length > 0 && sprint.status !== 'researching' && sprint.status !== 'planning' && (
            <>
              <h3 className="text-xs font-medium text-gray-600 uppercase tracking-wider mt-6">Planner</h3>
              <div className="border border-indigo-800 rounded-lg p-4 bg-gray-900">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-3 h-3 rounded-full bg-indigo-500" />
                  <h3 className="text-sm font-semibold text-indigo-400">Planner</h3>
                </div>
                <LogViewer lines={plannerLogs} maxHeight="200px" />
              </div>
            </>
          )}

          {/* Testers Section — visible during reviewing/pr-created/completed */}
          {(sprint.status === 'reviewing' || sprint.status === 'pr-created' || sprint.status === 'completed' || testerLogs.length > 0) && (
            <>
              <h3 className="text-xs font-medium text-gray-600 uppercase tracking-wider mt-6">Testers</h3>

              <div className="border border-teal-800 rounded-lg p-4 bg-gray-900">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-3 h-3 rounded-full bg-teal-500" />
                  <h3 className="text-sm font-semibold text-teal-400">Tester</h3>
                  {sprint.status === 'reviewing' && testerLogs.length > 0 && reviewerLogs.length === 0 && (
                    <span className="text-xs text-teal-600 animate-pulse">Running...</span>
                  )}
                </div>
                <LogViewer lines={testerLogs} maxHeight="200px" />
              </div>
            </>
          )}

          {/* Reviewer Panel — visible during review/pr-created/completed */}
          {(sprint.status === 'reviewing' || sprint.status === 'pr-created' || sprint.status === 'completed' || reviewerLogs.length > 0) && (
            <>
              <h3 className="text-xs font-medium text-gray-600 uppercase tracking-wider mt-6">Reviewer</h3>

              <div className="border border-purple-800 rounded-lg p-4 bg-gray-900">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-3 h-3 rounded-full bg-purple-500" />
                  <h3 className="text-sm font-semibold text-purple-400">Reviewer</h3>
                  {reviewCycle > 0 && (
                    <span className="text-xs text-gray-500">Cycle {reviewCycle}/3</span>
                  )}
                  {reviewStatus === 'needs-fixes' && (
                    <span className="text-xs text-yellow-500">Needs fixes</span>
                  )}
                  {reviewStatus === 'approved' && (
                    <span className="text-xs text-green-500">Approved</span>
                  )}
                  {reviewStatus === 'reviewing' && (
                    <span className="text-xs text-purple-600 animate-pulse">Running...</span>
                  )}
                </div>
                <LogViewer lines={reviewerLogs} maxHeight="200px" />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const ACTIVE_STATUSES = new Set(['running', 'researching', 'planning', 'reviewing']);
function isActiveStatus(status: string): boolean {
  return ACTIVE_STATUSES.has(status);
}

const AGENT_ORDER: Record<string, number> = { researcher: 0, planner: 1, developer: 2, implementer: 2, tester: 3, reviewer: 4 };
const AGENT_LABELS: Record<string, string> = { implementer: 'Developer' };

function EstimateLine({ estimates, costs, status, approvedAt, completedAt, approvalWaitSeconds = 0 }: { estimates: PlanEstimates; costs: CostData; status: string; approvedAt?: string; completedAt?: string; approvalWaitSeconds?: number }) {
  const agentEntries = Object.entries(costs.by_agent)
    .sort(([a], [b]) => (AGENT_ORDER[a] ?? 99) - (AGENT_ORDER[b] ?? 99));

  const active = isActiveStatus(status);

  // Wall clock elapsed time since sprint plan approval
  // For finished sprints, cap at completedAt so the time doesn't keep growing
  const [wallSeconds, setWallSeconds] = useState(() => {
    if (!approvedAt) return 0;
    const start = new Date(approvedAt).getTime();
    const end = completedAt ? new Date(completedAt).getTime() : Date.now();
    return Math.max(0, Math.floor((end - start) / 1000));
  });
  const [colonVisible, setColonVisible] = useState(true);
  useEffect(() => {
    if (!approvedAt) return;
    const start = new Date(approvedAt).getTime();
    const end = completedAt ? new Date(completedAt).getTime() : Date.now();
    setWallSeconds(Math.max(0, Math.floor((end - start) / 1000)));
    if (!active) return;
    const t = setInterval(() => {
      setWallSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
      setColonVisible((v) => !v);
    }, 1000);
    return () => clearInterval(t);
  }, [active, approvedAt, completedAt]);

  const actualSeconds = Math.max(0, wallSeconds - approvalWaitSeconds);

  const agentTotal = agentEntries.reduce((sum, [, s]) => sum + s, 0);

  // Agent breakdown dropdown
  const [showBreakdown, setShowBreakdown] = useState(false);

  return (
    <div className="flex flex-wrap items-center justify-between gap-y-1 text-sm text-gray-400">
      <div className="flex flex-wrap items-center gap-x-4">
        <span>
          <span className="text-gray-500">Estimate:</span>{' '}
          <span className="text-blue-300">&#x1F916; {estimates.ai_team}</span>
        </span>
        <span className="text-gray-600">|</span>
        <span>
          <span className="text-gray-500">&#x1F465;</span>{' '}
          <span className="text-gray-400">{estimates.human_team}</span>
        </span>
        {estimates.ai_team_minutes > 0 && estimates.human_team_minutes > 0 && (
          <>
            <span className="text-gray-600">|</span>
            <span className="text-blue-300 font-medium">
              {Math.round(estimates.human_team_minutes / estimates.ai_team_minutes)}x faster
            </span>
          </>
        )}
      </div>
      {(actualSeconds > 0 || agentTotal > 0 || active) && (
        <div className="relative flex items-center gap-x-2">
          {agentTotal > 0 && (
            <span>
              <span className="text-gray-500">Agents:</span>{' '}
              <span className="text-blue-300 tabular-nums">{formatDuration(agentTotal)}</span>
            </span>
          )}
          {agentTotal > 0 && (actualSeconds > 0 || active) && (
            <span className="text-gray-600">|</span>
          )}
          {(actualSeconds > 0 || active) && (
            <span>
              <span className="text-gray-500">Wall:</span>{' '}
              <span className={`text-gray-300${active ? ' tabular-nums' : ''}`}>{formatDuration(actualSeconds, active ? colonVisible : true)}</span>
            </span>
          )}
          {agentEntries.length > 0 && (
            <>
              <button
                onClick={() => setShowBreakdown(!showBreakdown)}
                className="text-xs text-gray-500 hover:text-gray-300 transition"
              >
                {showBreakdown ? '\u25B2' : '\u25BC'}
              </button>
              {showBreakdown && (
                <div className="absolute top-full right-0 mt-1 z-10 bg-gray-800 border border-gray-700 rounded-lg p-3 min-w-[180px] shadow-lg">
                  <div className="space-y-1.5">
                    {agentEntries.map(([agent, seconds], i) => {
                      const prevAgent = i > 0 ? agentEntries[i - 1][0] : '';
                      const prevGroup = AGENT_ORDER[prevAgent] ?? -1;
                      const curGroup = AGENT_ORDER[agent] ?? 99;
                      const showSep = i > 0 && curGroup > 2 && prevGroup <= 2;
                      const label = AGENT_LABELS[agent] || agent.charAt(0).toUpperCase() + agent.slice(1);
                      return (
                        <div key={agent}>
                          {showSep && <div className="border-t border-gray-700 my-1.5" />}
                          <div className="flex justify-between text-xs gap-4">
                            <span className="text-gray-400">{label}</span>
                            <span className="text-gray-500 tabular-nums">{formatDuration(seconds)}</span>
                          </div>
                        </div>
                      );
                    })}
                    <div className="border-t border-gray-700 pt-1.5 mt-1.5 flex justify-between text-xs font-medium">
                      <span className="text-gray-300">Agents total</span>
                      <span className="text-gray-300 tabular-nums">{formatDuration(agentTotal)}</span>
                    </div>
                    <div className="flex justify-between text-xs font-medium">
                      <span className="text-gray-300">Wall clock</span>
                      <span className="text-gray-300 tabular-nums">{formatDuration(actualSeconds)}</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function formatDuration(seconds: number, showColon = true): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  const sep = showColon ? ':' : '\u00A0';
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return `${hrs}h ${String(remainMins).padStart(2, '0')}${sep}${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}${sep}${String(secs).padStart(2, '0')}`;
}
