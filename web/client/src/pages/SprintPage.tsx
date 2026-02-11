import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useSprintDetail, pauseSprint, resumeSprint, restartSprint, retryTask } from '../hooks/use-sprint.js';
import { useWebSocket } from '../hooks/use-websocket.js';
import { SprintStatusBadge } from '../components/StatusBadge.js';
import { TaskList } from '../components/TaskList.js';
import { ImplementerPanel } from '../components/ImplementerPanel.js';
import { LogViewer } from '../components/LogViewer.js';
import { CostTracker } from '../components/CostTracker.js';
import { ApprovalDialog } from '../components/ApprovalDialog.js';
import type { ServerEvent, ImplementerIdentity, TaskState } from '@shared/types.js';

interface PendingApproval {
  id: string;
  message: string;
}

export function SprintPage() {
  const { id } = useParams<{ id: string }>();
  const { sprint, loading, refresh } = useSprintDetail(id);
  const { subscribe, send } = useWebSocket();

  const [implLogs, setImplLogs] = useState<Record<string, string[]>>({});
  const [testerLogs, setTesterLogs] = useState<string[]>([]);
  const [reviewerLogs, setReviewerLogs] = useState<string[]>([]);
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
        if (event.implementerId === 'tester') {
          setTesterLogs((prev) => [...prev.slice(-300), event.line]);
        } else if (event.implementerId === 'reviewer') {
          setReviewerLogs((prev) => [...prev.slice(-300), event.line]);
        } else {
          setImplLogs((prev) => ({
            ...prev,
            [event.implementerId]: [...(prev[event.implementerId] || []).slice(-300), event.line],
          }));
        }
        break;

      case 'wave:started':
      case 'wave:completed':
        refresh();
        break;

      case 'approval:required':
        setApproval({ id: event.id, message: event.message });
        break;

      case 'review:update':
        setReviewCycle(event.cycle);
        setReviewStatus(String(event.status));
        refresh();
        break;

      case 'cost:update':
        refresh();
        break;
    }
  }, [id, refresh]);

  useEffect(() => {
    return subscribe(handleEvent);
  }, [subscribe, handleEvent]);

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

  const handleRetryTask = async (taskId: number) => {
    if (!id) return;
    try {
      await retryTask(id, taskId);
      refresh();
    } catch (err) {
      console.error('Retry failed:', err);
    }
  };

  if (loading) return <div className="text-gray-500">Loading...</div>;
  if (!sprint) return <div className="text-red-400">Sprint not found</div>;

  const implementerColors: Record<string, string> = {};
  (sprint.implementers || []).forEach((impl: ImplementerIdentity) => {
    implementerColors[impl.id] = impl.color;
  });

  // Map task states for implementers
  const taskStateMap = new Map((sprint.tasks || []).map((t: TaskState) => [t.taskId, t]));

  return (
    <div className="max-w-7xl mx-auto">
      {approval && (
        <ApprovalDialog
          message={approval.message}
          onApprove={(comment) => {
            send({ type: 'approval:response', id: approval.id, approved: true, comment });
            setApproval(null);
          }}
          onReject={(comment) => {
            send({ type: 'approval:response', id: approval.id, approved: false, comment });
            setApproval(null);
          }}
        />
      )}

      <div className="flex items-center gap-4 mb-6">
        <a href="/" className="text-gray-500 hover:text-gray-300 text-sm">&larr; Back</a>
        <h1 className="text-xl font-bold text-white">{id}</h1>
        <SprintStatusBadge status={sprint.status} />
        {sprint.currentWave > 0 && (
          <span className="text-sm text-gray-500">Wave {sprint.currentWave}</span>
        )}
        {(sprint.status === 'running' || sprint.status === 'researching' || sprint.status === 'planning') && (
          <button
            onClick={handlePause}
            disabled={actionInProgress}
            className="px-3 py-1 bg-amber-600 text-white rounded text-sm hover:bg-amber-500 disabled:opacity-50"
          >
            {actionInProgress ? 'Pausing...' : 'Pause'}
          </button>
        )}
        {sprint.status === 'paused' && (
          <button
            onClick={handleResume}
            disabled={actionInProgress}
            className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-500 disabled:opacity-50"
          >
            {actionInProgress ? 'Resuming...' : 'Resume'}
          </button>
        )}
        {(sprint.status === 'failed' || sprint.status === 'cancelled' || sprint.status === 'running' || sprint.status === 'paused' || sprint.status === 'reviewing') && (
          <button
            onClick={handleRestart}
            disabled={actionInProgress}
            className="px-3 py-1 bg-yellow-600 text-white rounded text-sm hover:bg-yellow-500 disabled:opacity-50"
          >
            {actionInProgress ? 'Restarting...' : 'Restart'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Task List */}
        <div className="lg:col-span-1">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">Tasks</h2>
          {sprint.plan && (
            <TaskList
              tasks={sprint.plan.tasks}
              taskStates={sprint.tasks || []}
              implementerColors={implementerColors}
              onRetryTask={handleRetryTask}
            />
          )}

          <div className="mt-6">
            <CostTracker costs={sprint.costs} />
          </div>
        </div>

        {/* Right: Implementer Panels */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">Implementers</h2>

          {(sprint.implementers || []).map((impl: ImplementerIdentity) => {
            const implTasks = (sprint.plan?.tasks || []).filter((t) => t.assigned_to === impl.id);
            const currentTaskState = implTasks
              .map((t) => taskStateMap.get(t.id))
              .find((s) => s?.status === 'in-progress');
            const currentPlanTask = currentTaskState
              ? sprint.plan?.tasks.find((t) => t.id === currentTaskState.taskId)
              : undefined;
            const completedCount = implTasks.filter((t) => taskStateMap.get(t.id)?.status === 'completed').length;

            return (
              <ImplementerPanel
                key={impl.id}
                implementer={impl}
                currentTask={currentTaskState ? { ...currentTaskState, title: currentPlanTask?.title } : undefined}
                logLines={implLogs[impl.id] || []}
                completedCount={completedCount}
                totalCount={implTasks.length}
              />
            );
          })}

          {/* Testers Section — visible during reviewing/pr-created/completed */}
          {(sprint.status === 'reviewing' || sprint.status === 'pr-created' || sprint.status === 'completed' || testerLogs.length > 0) && (
            <>
              <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3 mt-6">Testers</h2>

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
              <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3 mt-6">Reviewer</h2>

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
