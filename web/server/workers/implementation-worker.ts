// Implementation worker: runs implementer agents on assigned tasks
// One worker instance per implementer, consuming from their dedicated queue

import { Worker, Job } from 'bullmq';
import fs from 'node:fs';
import path from 'node:path';
import { getRedisConnection } from '../utils/redis.js';
import { SPRINTS_DIR, BUDGETS } from '../config.js';
import { runAgentJob } from './base-worker.js';
import { setTaskStatus, getSprintOrThrow, getSprint } from '../services/state-service.js';
import { commitInWorktree } from '../services/git-service.js';
import { broadcast } from '../websocket/ws-server.js';
import { createLogger } from '../utils/logger.js';
import type { Task } from '../../shared/types.js';

const log = createLogger('impl-worker');

interface ImplementationJobData {
  sprintId: string;
  taskId: number;
  taskDetails: Task;
  implementerId: string;
  targetDir: string;
  fixCycle?: number;
  reviewFindings?: string;
}

export function startImplementationWorker(implementerId: string): Worker {
  const connection = getRedisConnection();
  const queueName = `implementation-${implementerId}`;

  const worker = new Worker(queueName, async (job: Job<ImplementationJobData>) => {
    const { sprintId, taskId, taskDetails, targetDir, fixCycle, reviewFindings } = job.data;
    const isFixJob = job.name === 'fix' && fixCycle !== undefined;

    // Check if sprint is paused before starting a new task
    const sprintState = getSprint(sprintId);
    if (sprintState?.status === 'paused') {
      log.info(`Sprint ${sprintId} is paused, delaying task ${taskId}`);
      if (taskId > 0) setTaskStatus(sprintId, taskId, 'queued', implementerId);
      throw new Error('SPRINT_PAUSED');
    }

    const sprint = getSprintOrThrow(sprintId);
    const worktreePath = sprint.worktreePaths.get(implementerId);
    const cwd = worktreePath || targetDir;

    // Build shared context
    const researchFile = path.join(SPRINTS_DIR, sprintId, 'research.md');
    const research = fs.existsSync(researchFile) ? fs.readFileSync(researchFile, 'utf-8') : '';

    if (isFixJob) {
      // --- Fix job: address review findings ---
      log.info(`${implementerId} starting fix cycle ${fixCycle} for ${sprintId}`);
      broadcast({ type: 'task:status', sprintId, taskId: 0, status: 'in-progress', implementerId });

      const reviewFile = path.join(SPRINTS_DIR, sprintId, `review-${fixCycle}.md`);
      const reviewContent = fs.existsSync(reviewFile) ? fs.readFileSync(reviewFile, 'utf-8') : (reviewFindings || '');

      const prompt = `You are fixing issues found during review cycle ${fixCycle} of sprint ${sprintId}.

Review Findings:
${reviewContent}

Codebase Research:
${research}

Working directory: ${cwd}

Instructions:
1. Read the review findings above carefully
2. Fix all MUST-FIX items
3. Address SHOULD-FIX items if straightforward
4. Run tests to verify your fixes (npm test)
5. Stage your changes with git add (but do NOT commit)
6. Print a summary of what you fixed`;

      const result = await runAgentJob(job, 'implementer', prompt, {
        budget: String(BUDGETS.task),
        taskId: `fix-${fixCycle}`,
        cwd,
      });

      const commitMessage = `fix(${sprintId}): address review cycle ${fixCycle} findings\n\nSprint: ${sprintId}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`;
      await commitInWorktree(cwd, commitMessage);

      log.info(`${implementerId} completed fix cycle ${fixCycle} for ${sprintId}`);
      broadcast({ type: 'task:status', sprintId, taskId: 0, status: 'completed', implementerId });

      // Enqueue next review cycle
      const { enqueueReview } = await import('../queues/queue-manager.js');
      await enqueueReview(sprintId, fixCycle + 1);

      return { success: true, duration: result.durationSeconds };
    }

    // --- Normal implementation job ---
    log.info(`${implementerId} starting task ${taskId}: ${taskDetails.title}`);

    setTaskStatus(sprintId, taskId, 'in-progress', implementerId);
    broadcast({ type: 'task:status', sprintId, taskId, status: 'in-progress', implementerId });

    const planFile = path.join(SPRINTS_DIR, sprintId, 'plan.json');
    const planContent = fs.existsSync(planFile) ? fs.readFileSync(planFile, 'utf-8') : '';

    const prompt = `You are implementing task ${taskId} of sprint ${sprintId}.

Task: ${taskDetails.title}
Description: ${taskDetails.description}

Acceptance Criteria:
${(taskDetails.acceptance_criteria || []).map((c: string) => `- ${c}`).join('\n')}

Codebase Research:
${research}

Full Sprint Plan:
${planContent}

Working directory: ${cwd}

Instructions:
1. Read research.md for existing patterns and conventions
2. Implement the changes described in this task
3. Run tests if applicable (npm test)
4. Stage your changes with git add (but do NOT commit)
5. Print a summary of what you implemented`;

    const result = await runAgentJob(job, 'implementer', prompt, {
      budget: String(BUDGETS.task),
      taskId: String(taskId),
      cwd,
    });

    const commitMessage = `feat(${sprintId}): task ${taskId} - ${taskDetails.title}\n\nSprint: ${sprintId}\nTask: ${taskId}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`;
    await commitInWorktree(cwd, commitMessage);

    setTaskStatus(sprintId, taskId, 'completed', implementerId);
    broadcast({ type: 'task:status', sprintId, taskId, status: 'completed', implementerId });

    log.info(`${implementerId} completed task ${taskId}`);

    await checkWaveCompletion(sprintId, taskDetails.wave || 1);

    return { success: true, duration: result.durationSeconds };
  }, {
    connection,
    concurrency: 1,
  });

  worker.on('failed', (job, err) => {
    if (err.message === 'SPRINT_PAUSED') {
      // Not a real failure — task will be re-enqueued on resume
      return;
    }
    log.error(`Implementation job failed: ${err.message}`, { jobId: job?.id });
    if (job) {
      const { sprintId, taskId } = job.data as ImplementationJobData;
      setTaskStatus(sprintId, taskId, 'failed', implementerId);
      broadcast({ type: 'task:status', sprintId, taskId, status: 'failed', implementerId });
      broadcast({ type: 'error', sprintId, message: `Task ${taskId} failed: ${err.message}` });
    }
  });

  log.info(`Implementation worker started for ${implementerId}`);
  return worker;
}

/**
 * After a task completes, check if all tasks in its wave are done.
 * If so, enqueue the next wave's tasks.
 */
async function checkWaveCompletion(sprintId: string, wave: number): Promise<void> {
  const sprint = getSprint(sprintId);
  if (!sprint?.plan) return;

  // Find all tasks in this wave
  const waveTasks = sprint.plan.tasks.filter((t) => (t.wave || 1) === wave);
  const allDone = waveTasks.every((t) => {
    const state = sprint.tasks.get(t.id);
    return state?.status === 'completed';
  });

  if (!allDone) return;

  log.info(`Wave ${wave} complete for ${sprintId}`);
  broadcast({ type: 'wave:completed', sprintId, wave });

  const implementerIds = sprint.implementers.map((impl) => impl.id);

  // Find the next wave
  const nextWave = wave + 1;
  const nextWaveTasks = sprint.plan.tasks.filter((t) =>
    (t.wave || 1) === nextWave && (t.agent === 'implementer' || (!t.agent && t.assigned_to))
  );

  if (nextWaveTasks.length === 0) {
    // No more implementation waves — finalize git and move to testing
    log.info(`All implementation waves complete for ${sprintId}, finalizing git`);

    const { finalizeImplementation } = await import('../services/git-service.js');
    await finalizeImplementation(sprint.targetDir, sprintId, implementerIds);

    const { setSprintStatus } = await import('../services/state-service.js');
    setSprintStatus(sprintId, 'reviewing');
    broadcast({ type: 'sprint:status', sprintId, status: 'reviewing' });

    const { enqueueTesting } = await import('../queues/queue-manager.js');
    await enqueueTesting(sprintId);
    return;
  }

  // Merge this wave's work and reset worktrees for the next wave
  log.info(`Merging wave ${wave} and preparing wave ${nextWave} for ${sprintId}`);
  const { mergeWaveAndReset } = await import('../services/git-service.js');
  const mergeResults = await mergeWaveAndReset(sprint.targetDir, sprintId, implementerIds);

  const failedMerges = mergeResults.filter((r) => !r.success);
  for (const implId of implementerIds) {
    const idx = implementerIds.indexOf(implId);
    const result = mergeResults[idx];
    if (result) {
      broadcast({ type: 'merge:completed', sprintId, implementerId: implId, success: result.success, conflicts: result.conflicts });
    }
  }
  if (failedMerges.length > 0) {
    log.warn(`Merge conflicts after wave ${wave}`, { conflicts: failedMerges.map((c) => c.conflicts) });
  }

  // Enqueue next wave
  log.info(`Starting wave ${nextWave} for ${sprintId} (${nextWaveTasks.length} tasks)`);
  broadcast({ type: 'wave:started', sprintId, wave: nextWave, taskIds: nextWaveTasks.map((t) => t.id) });

  const { setCurrentWave } = await import('../services/state-service.js');
  setCurrentWave(sprintId, nextWave);

  const { enqueueNextWave } = await import('../queues/queue-manager.js');
  await enqueueNextWave(sprintId, nextWave);
}
