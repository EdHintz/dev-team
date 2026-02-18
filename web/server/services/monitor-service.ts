// Sprint health monitor — polls active sprints, detects issues, invokes monitor agent

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createLogger } from '../utils/logger.js';
import { BUDGETS, MONITOR_POLL_INTERVAL_MS, MONITOR_STUCK_THRESHOLD_MINUTES } from '../config.js';
import {
  listSprints,
  getSprint,
  getSprintDir,
  setSprintStatus,
  resetTaskStatus,
  resetSprintForRestart,
  setWorktreePath,
} from './state-service.js';
import { broadcast } from '../websocket/ws-server.js';
import { runAgent } from './agent-service.js';
import type { MonitorMessage, MonitorAction, SprintStatus, TaskState } from '../../shared/types.js';
import type { SprintState } from './state-service.js';

const log = createLogger('monitor');
const execFileAsync = promisify(execFile);

// --- Chat Persistence ---

export function loadChatHistory(sprintId: string): MonitorMessage[] {
  const file = path.join(getSprintDir(sprintId), 'monitor-chat.json');
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return [];
  }
}

function saveChatHistory(sprintId: string, messages: MonitorMessage[]): void {
  const file = path.join(getSprintDir(sprintId), 'monitor-chat.json');
  try {
    fs.writeFileSync(file, JSON.stringify(messages, null, 2));
  } catch {
    log.warn('Could not save monitor chat', { sprintId });
  }
}

function appendMessage(sprintId: string, msg: MonitorMessage): void {
  const history = loadChatHistory(sprintId);
  history.push(msg);
  saveChatHistory(sprintId, history);
}

// --- Health Diagnostics ---

export interface HealthIssue {
  type: 'stuck_task' | 'failed_task' | 'merge_conflict' | 'sprint_failed' | 'sprint_stalled';
  message: string;
  taskId?: number;
}

export function diagnoseSprintHealth(sprint: SprintState): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const now = Date.now();
  const stuckThresholdMs = MONITOR_STUCK_THRESHOLD_MINUTES * 60 * 1000;

  for (const [, task] of sprint.tasks) {
    // Stuck in-progress tasks
    if (task.status === 'in-progress' && task.startedAt) {
      const elapsed = now - new Date(task.startedAt).getTime();
      if (elapsed > stuckThresholdMs) {
        const minutes = Math.round(elapsed / 60000);
        issues.push({
          type: 'stuck_task',
          message: `Task ${task.taskId} has been in-progress for ${minutes} minutes`,
          taskId: task.taskId,
        });
      }
    }

    // Failed tasks
    if (task.status === 'failed') {
      issues.push({
        type: 'failed_task',
        message: `Task ${task.taskId} failed${task.error ? `: ${task.error}` : ''}`,
        taskId: task.taskId,
      });
    }
  }

  // Check for mid-merge state
  const mergeHead = path.join(sprint.targetDir, '.git', 'MERGE_HEAD');
  if (fs.existsSync(mergeHead)) {
    issues.push({
      type: 'merge_conflict',
      message: 'Git merge in progress — possible merge conflict',
    });
  }

  // Sprint failed
  if (sprint.status === 'failed') {
    issues.push({
      type: 'sprint_failed',
      message: 'Sprint is in failed status',
    });
  }

  // Sprint stalled — running but nothing in-progress or queued
  if (sprint.status === 'running') {
    const tasks = Array.from(sprint.tasks.values());
    const hasActive = tasks.some((t) => t.status === 'in-progress' || t.status === 'queued');
    const hasPending = tasks.some((t) => t.status === 'pending');
    const allDone = tasks.length > 0 && tasks.every((t) => t.status === 'completed');
    if (!hasActive && hasPending) {
      issues.push({
        type: 'sprint_stalled',
        message: 'Sprint is running but no tasks are in-progress or queued (stalled)',
      });
    } else if (allDone) {
      // All tasks completed but sprint never advanced — likely a post-task failure (merge, review trigger, etc.)
      issues.push({
        type: 'sprint_stalled',
        message: 'All tasks completed but sprint is still running — post-task step may have failed (e.g., merge or review trigger)',
      });
    }
  }

  return issues;
}

// --- Action Executor ---

export async function executeAction(sprintId: string, action: MonitorAction): Promise<{ success: boolean; message: string }> {
  const sprint = getSprint(sprintId);
  if (!sprint) return { success: false, message: 'Sprint not found' };

  try {
    switch (action.type) {
      case 'retry_task': {
        resetTaskStatus(sprintId, action.taskId);
        const { reEnqueueTask } = await import('../queues/queue-manager.js');
        await reEnqueueTask(sprintId, action.taskId);
        broadcast({ type: 'task:status', sprintId, taskId: action.taskId, status: 'queued' });
        return { success: true, message: `Task ${action.taskId} reset and re-enqueued` };
      }

      case 'restart_sprint': {
        const { pendingTaskIds } = resetSprintForRestart(sprintId);
        if (pendingTaskIds.length > 0) {
          const { setupSprintGit } = await import('./git-service.js');
          const developers = sprint.developers.map((d) => ({ id: d.id, name: d.name }));
          const worktreePaths = await setupSprintGit(sprint.targetDir, sprintId, developers);
          for (const [devId, wtPath] of worktreePaths) {
            setWorktreePath(sprintId, devId, wtPath);
          }
          const { restartSprint: restartQueue } = await import('../queues/queue-manager.js');
          await restartQueue(sprintId, pendingTaskIds);
        }
        broadcast({ type: 'sprint:status', sprintId, status: 'running' });
        return { success: true, message: `Sprint restarted with ${pendingTaskIds.length} tasks` };
      }

      case 'git_merge_abort': {
        await execFileAsync('git', ['merge', '--abort'], { cwd: sprint.targetDir });
        return { success: true, message: 'Git merge aborted' };
      }

      case 'clear_stuck_tasks': {
        let cleared = 0;
        for (const [, task] of sprint.tasks) {
          if (task.status === 'in-progress') {
            resetTaskStatus(sprintId, task.taskId);
            broadcast({ type: 'task:status', sprintId, taskId: task.taskId, status: 'pending' });
            cleared++;
          }
        }
        return { success: true, message: `Cleared ${cleared} stuck task(s) to pending` };
      }

      case 'pause_sprint': {
        setSprintStatus(sprintId, 'paused');
        broadcast({ type: 'sprint:status', sprintId, status: 'paused' });
        return { success: true, message: 'Sprint paused' };
      }

      case 'resume_sprint': {
        setSprintStatus(sprintId, 'running');
        broadcast({ type: 'sprint:status', sprintId, status: 'running' });
        const pendingTasks = Array.from(sprint.tasks.values())
          .filter((t) => t.status === 'queued')
          .map((t) => t.taskId);
        if (pendingTasks.length > 0) {
          const { restartSprint: restartQueue } = await import('../queues/queue-manager.js');
          await restartQueue(sprintId, pendingTasks);
        }
        return { success: true, message: 'Sprint resumed' };
      }

      default:
        return { success: false, message: `Unknown action type` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('Monitor action failed', { sprintId, action, error: message });
    return { success: false, message };
  }
}

// --- Agent Invocation ---

function buildPrompt(sprint: SprintState, issues: HealthIssue[], recentChat: MonitorMessage[], trigger?: string): string {
  const taskStates: TaskState[] = Array.from(sprint.tasks.values());

  const parts = [
    `Sprint: ${sprint.id}`,
    `Status: ${sprint.status}`,
    `Target directory: ${sprint.targetDir}`,
    '',
    '## Task States',
    '```json',
    JSON.stringify(taskStates, null, 2),
    '```',
  ];

  if (issues.length > 0) {
    parts.push('', '## Detected Issues');
    for (const issue of issues) {
      parts.push(`- [${issue.type}] ${issue.message}`);
    }
  }

  if (recentChat.length > 0) {
    parts.push('', '## Recent Chat');
    for (const msg of recentChat.slice(-20)) {
      const prefix = msg.role === 'user' ? 'User' : msg.role === 'system' ? 'System' : 'Monitor';
      parts.push(`**${prefix}:** ${msg.content}`);
    }
  }

  if (trigger) {
    parts.push('', `## User Message`, trigger);
  }

  return parts.join('\n');
}

function parseAction(output: string): MonitorAction | undefined {
  // Look for a JSON block containing an "action" key
  const jsonMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (!jsonMatch) return undefined;

  try {
    const parsed = JSON.parse(jsonMatch[1]);
    if (parsed?.action?.type) return parsed.action as MonitorAction;
  } catch {
    // not valid JSON
  }
  return undefined;
}

async function invokeMonitorAgent(sprintId: string, trigger?: string): Promise<void> {
  const sprint = getSprint(sprintId);
  if (!sprint) return;

  const issues = diagnoseSprintHealth(sprint);
  const recentChat = loadChatHistory(sprintId);
  const prompt = buildPrompt(sprint, issues, recentChat, trigger);

  // Signal typing
  broadcast({ type: 'monitor:typing', sprintId, active: true });

  try {
    const result = await runAgent({
      agentName: 'monitor',
      prompt,
      budget: String(BUDGETS.monitor),
      maxTurns: 3,
      sprintId,
      taskId: 'monitor',
    });

    const content = result.output.trim();
    if (!content) return;

    // Parse action from output
    const action = parseAction(content);

    // Strip the JSON block from the displayed content
    const displayContent = content.replace(/```(?:json)?\s*\n?[\s\S]*?\n?```/g, '').trim();

    const monitorMsg: MonitorMessage = {
      id: `mon-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'monitor',
      content: displayContent || content,
      timestamp: new Date().toISOString(),
      action,
    };

    // Execute action if present
    if (action) {
      const actionResult = await executeAction(sprintId, action);
      monitorMsg.actionResult = actionResult;
    }

    appendMessage(sprintId, monitorMsg);
    broadcast({ type: 'monitor:message', sprintId, message: monitorMsg });
  } catch (err) {
    log.error('Monitor agent invocation failed', { sprintId, error: String(err) });
  } finally {
    broadcast({ type: 'monitor:typing', sprintId, active: false });
  }
}

// --- User Chat Handler ---

export async function handleUserMessage(sprintId: string, content: string): Promise<void> {
  const userMsg: MonitorMessage = {
    id: `usr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role: 'user',
    content,
    timestamp: new Date().toISOString(),
  };

  appendMessage(sprintId, userMsg);
  broadcast({ type: 'monitor:message', sprintId, message: userMsg });

  await invokeMonitorAgent(sprintId, content);
}

// --- Polling Loop ---

let pollTimer: ReturnType<typeof setInterval> | null = null;
const activePolls = new Set<string>();

const ACTIVE_STATUSES: SprintStatus[] = ['running', 'reviewing', 'researching', 'planning'];

async function pollTick(): Promise<void> {
  const sprints = listSprints();
  const activeSprints = sprints.filter((s) => ACTIVE_STATUSES.includes(s.status));

  for (const summary of activeSprints) {
    if (activePolls.has(summary.id)) continue;

    const sprint = getSprint(summary.id);
    if (!sprint) continue;

    const issues = diagnoseSprintHealth(sprint);
    if (issues.length === 0) continue;

    activePolls.add(summary.id);

    try {
      // Post system message about detected issues
      const systemMsg: MonitorMessage = {
        id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'system',
        content: `Detected ${issues.length} issue(s): ${issues.map((i) => i.message).join('; ')}`,
        timestamp: new Date().toISOString(),
      };
      appendMessage(summary.id, systemMsg);
      broadcast({ type: 'monitor:message', sprintId: summary.id, message: systemMsg });

      await invokeMonitorAgent(summary.id);
    } catch (err) {
      log.error('Monitor poll failed for sprint', { sprintId: summary.id, error: String(err) });
    } finally {
      activePolls.delete(summary.id);
    }
  }
}

export function startMonitorLoop(): void {
  if (pollTimer) return;
  log.info(`Starting monitor loop (interval: ${MONITOR_POLL_INTERVAL_MS}ms)`);
  pollTimer = setInterval(() => {
    pollTick().catch((err) => log.error('Monitor poll tick error', { error: String(err) }));
  }, MONITOR_POLL_INTERVAL_MS);
}

export function stopMonitorLoop(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    log.info('Monitor loop stopped');
  }
}
