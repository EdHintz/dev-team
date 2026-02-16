// Implementation worker: runs implementer agents on assigned tasks
// One worker instance per developer, consuming from their dedicated queue

import { Worker, Job } from 'bullmq';
import fs from 'node:fs';
import path from 'node:path';
import { getRedisConnection } from '../utils/redis.js';
import { BUDGETS } from '../config.js';
import { runAgentJob } from './base-worker.js';
import { setTaskStatus, getSprintOrThrow, getSprint, getSprintDir } from '../services/state-service.js';
import { commitInWorktree } from '../services/git-service.js';
import { broadcast } from '../websocket/ws-server.js';
import { createLogger } from '../utils/logger.js';
import type { Task } from '../../shared/types.js';

const log = createLogger('impl-worker');

interface ImplementationJobData {
  sprintId: string;
  taskId: number;
  taskDetails: Task;
  developerId: string;
  targetDir: string;
  fixCycle?: number;
  reviewFindings?: string;
}

export function startImplementationWorker(developerId: string): Worker {
  const connection = getRedisConnection();
  const queueName = `implementation-${developerId}`;

  const worker = new Worker(queueName, async (job: Job<ImplementationJobData>) => {
    const { sprintId, taskId, taskDetails, targetDir, fixCycle, reviewFindings } = job.data;
    const isFixJob = job.name === 'fix' && fixCycle !== undefined;

    // Check if sprint is paused before starting a new task
    const sprintState = getSprint(sprintId);
    if (sprintState?.status === 'paused') {
      log.info(`Sprint ${sprintId} is paused, delaying task ${taskId}`);
      if (taskId > 0) setTaskStatus(sprintId, taskId, 'queued', developerId);
      throw new Error('SPRINT_PAUSED');
    }

    const sprint = getSprintOrThrow(sprintId);
    const worktreePath = sprint.worktreePaths.get(developerId);
    const cwd = (worktreePath && fs.existsSync(worktreePath)) ? worktreePath : targetDir;

    // Build shared context
    const researchFile = path.join(getSprintDir(sprintId), 'research.md');
    const research = fs.existsSync(researchFile) ? fs.readFileSync(researchFile, 'utf-8') : '';

    if (isFixJob) {
      // --- Fix job: address review findings ---
      log.info(`${developerId} starting fix cycle ${fixCycle} for ${sprintId}`);
      broadcast({ type: 'task:status', sprintId, taskId: 0, status: 'in-progress', developerId });

      const reviewFile = path.join(getSprintDir(sprintId), `review-${fixCycle}.md`);
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

      log.info(`${developerId} completed fix cycle ${fixCycle} for ${sprintId}`);
      broadcast({ type: 'task:status', sprintId, taskId: 0, status: 'completed', developerId });

      // Enqueue next review cycle
      const { enqueueReview } = await import('../queues/queue-manager.js');
      await enqueueReview(sprintId, fixCycle + 1);

      return { success: true, duration: result.durationSeconds };
    }

    // --- Normal implementation job ---
    log.info(`${developerId} starting task ${taskId}: ${taskDetails.title}`);

    setTaskStatus(sprintId, taskId, 'in-progress', developerId);
    broadcast({ type: 'task:status', sprintId, taskId, status: 'in-progress', developerId });

    const planFile = path.join(getSprintDir(sprintId), 'plan.json');
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

    setTaskStatus(sprintId, taskId, 'completed', developerId);
    broadcast({ type: 'task:status', sprintId, taskId, status: 'completed', developerId });

    log.info(`${developerId} completed task ${taskId}`);

    try {
      await checkWaveCompletion(sprintId, taskDetails.wave || 1);
    } catch (waveErr) {
      log.error(`Wave completion check failed for ${sprintId} wave ${taskDetails.wave || 1}`, { error: String(waveErr) });
      broadcast({ type: 'error', sprintId, message: `Wave transition failed: ${waveErr instanceof Error ? waveErr.message : String(waveErr)}` });
    }

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
      // Don't override a task that already completed (e.g., wave transition failed after task success)
      const currentState = getSprint(sprintId)?.tasks.get(taskId);
      if (currentState?.status === 'completed') {
        log.warn(`Task ${taskId} already completed — not marking as failed`);
        broadcast({ type: 'error', sprintId, message: `Post-task error for task ${taskId}: ${err.message}` });
        return;
      }
      setTaskStatus(sprintId, taskId, 'failed', developerId);
      broadcast({ type: 'task:status', sprintId, taskId, status: 'failed', developerId });
      broadcast({ type: 'error', sprintId, message: `Task ${taskId} failed: ${err.message}` });
    }
  });

  log.info(`Implementation worker started for ${developerId}`);
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

  const developers = sprint.developers.map((dev) => ({ id: dev.id, name: dev.name }));

  // Find the next wave
  const nextWave = wave + 1;
  const nextWaveTasks = sprint.plan.tasks.filter((t) =>
    (t.wave || 1) === nextWave && (t.agent === 'implementer' || (!t.agent && t.assigned_to))
  );

  if (nextWaveTasks.length === 0) {
    // No more implementation waves — finalize git and move to testing
    log.info(`All implementation waves complete for ${sprintId}, finalizing git`);

    const { finalizeImplementation } = await import('../services/git-service.js');
    await finalizeImplementation(sprint.targetDir, sprintId, developers);

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
  const mergeResults = await mergeWaveAndReset(sprint.targetDir, sprintId, developers);

  const failedMerges = mergeResults.filter((r) => !r.success);
  for (const dev of developers) {
    const idx = developers.findIndex((d) => d.id === dev.id);
    const devId = dev.id;
    const result = mergeResults[idx];
    if (result) {
      broadcast({ type: 'merge:completed', sprintId, developerId: devId, success: result.success, conflicts: result.conflicts });
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
