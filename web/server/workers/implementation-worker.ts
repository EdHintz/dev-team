// Implementation worker: runs implementer agents on assigned tasks
// One worker instance per developer, consuming from their dedicated queue

import { Worker, Job } from 'bullmq';
import fs from 'node:fs';
import path from 'node:path';
import { getRedisConnection } from '../utils/redis.js';
import { BUDGETS } from '../config.js';
import { runAgentJob, runAgentJobSafe } from './base-worker.js';
import { setTaskStatus, getSprintOrThrow, getSprint, getSprintDir, addSubtasks } from '../services/state-service.js';
import { commitInWorktree, type ConflictResolver } from '../services/git-service.js';
import { broadcast } from '../websocket/ws-server.js';
import { runAgent, runAgentJson } from '../services/agent-service.js';
import type { AgentResult } from '../services/agent-service.js';
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

const MAX_API_RETRIES = 3;

/**
 * Detect whether an agent failure was caused by an API 400 error
 * (typically prompt too long or response too large).
 */
function isApi400Error(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return lower.includes('api error: 400') || (lower.includes('400') && lower.includes('bad request'));
}

/**
 * Build progressively simplified prompts for retry attempts.
 */
function buildPrompt(
  attempt: number,
  taskId: number,
  sprintId: string,
  taskDetails: Task,
  cwd: string,
  research: string,
  planContent: string,
): string {
  const acceptanceCriteria = (taskDetails.acceptance_criteria || []).map((c: string) => `- ${c}`).join('\n');

  if (attempt === 1) {
    // Full prompt — current behavior
    return `You are implementing task ${taskId} of sprint ${sprintId}.

Task: ${taskDetails.title}
Description: ${taskDetails.description}

Acceptance Criteria:
${acceptanceCriteria}

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
  }

  if (attempt === 2) {
    // Simplified — task details only, no research/plan
    return `You are implementing task ${taskId} of sprint ${sprintId}.

Task: ${taskDetails.title}
Description: ${taskDetails.description}

Acceptance Criteria:
${acceptanceCriteria}

Files to modify: ${(taskDetails.files_touched || []).join(', ') || 'See description'}

Working directory: ${cwd}

Keep your implementation focused and your response concise.

Instructions:
1. Implement the changes described in this task
2. Run tests if applicable (npm test)
3. Stage your changes with git add (but do NOT commit)
4. Print a brief summary of what you implemented`;
  }

  // Attempt 3 — minimal
  return `Implement task ${taskId}: ${taskDetails.title}

${taskDetails.description}

Acceptance Criteria:
${acceptanceCriteria}

Working directory: ${cwd}

Implement only the minimum required changes. Keep response under 10000 tokens.
Stage your changes with git add (do NOT commit).`;
}

/**
 * Run an implementation agent with retry on API 400 errors.
 * Each retry uses a progressively simplified prompt.
 */
async function runWithRetry(
  job: Job<ImplementationJobData>,
  taskId: number,
  sprintId: string,
  taskDetails: Task,
  cwd: string,
  research: string,
  planContent: string,
  budget: string,
): Promise<AgentResult> {
  for (let attempt = 1; attempt <= MAX_API_RETRIES; attempt++) {
    const prompt = buildPrompt(attempt, taskId, sprintId, taskDetails, cwd, research, planContent);

    const result = await runAgentJobSafe(job, 'implementer', prompt, {
      budget,
      taskId: String(taskId),
      cwd,
    });

    if (result.exitCode === 0) {
      return result;
    }

    if (isApi400Error(result.stderr) && attempt < MAX_API_RETRIES) {
      log.warn(`Task ${taskId} hit API 400 error on attempt ${attempt}/${MAX_API_RETRIES}, retrying with simplified prompt`);
      broadcast({
        type: 'task:log',
        sprintId,
        taskId,
        developerId: job.data.developerId,
        line: `API 400 error — retrying with simplified prompt (attempt ${attempt + 1}/${MAX_API_RETRIES})`,
      });
      continue;
    }

    if (isApi400Error(result.stderr) && attempt === MAX_API_RETRIES) {
      throw new Error('TASK_TOO_COMPLEX');
    }

    // Non-400 failure — throw immediately
    throw new Error(`Agent implementer failed with exit code ${result.exitCode}`);
  }

  // Should not reach here, but just in case
  throw new Error('TASK_TOO_COMPLEX');
}

/**
 * Decompose a too-complex task into smaller subtasks via the planner agent,
 * then enqueue them for the same developer.
 */
async function decomposeAndRequeue(
  sprintId: string,
  taskId: number,
  task: Task,
  developerId: string,
  targetDir: string,
): Promise<void> {
  log.info(`Decomposing task ${taskId} into subtasks for ${sprintId}`);

  broadcast({
    type: 'task:log',
    sprintId,
    taskId,
    developerId,
    line: `Task too complex after ${MAX_API_RETRIES} retries — auto-decomposing into subtasks`,
  });

  const decompositionPrompt = `Task ${taskId} "${task.title}" failed because it was too complex for a single agent session.

Original description: ${task.description}
Acceptance criteria: ${(task.acceptance_criteria || []).join('; ')}
Files: ${(task.files_touched || []).join(', ')}

Break this into 2-3 smaller, independently implementable subtasks.
Output JSON: { "subtasks": [{ "title": "string", "description": "string", "acceptance_criteria": ["string"], "files_touched": ["string"] }] }
Keep each subtask small enough to complete in a single focused session.`;

  const { data } = await runAgentJson<{ subtasks: Array<{ title: string; description: string; acceptance_criteria?: string[]; files_touched?: string[] }> }>({
    agentName: 'planner',
    prompt: decompositionPrompt,
    sprintId,
    taskId: `decompose-${taskId}`,
    cwd: targetDir,
  });

  if (!data?.subtasks || data.subtasks.length === 0) {
    log.error(`Decomposition returned no subtasks for task ${taskId}`);
    broadcast({ type: 'error', sprintId, message: `Task ${taskId} decomposition failed: planner returned no subtasks` });
    return;
  }

  // Mark original task as failed with descriptive error
  setTaskStatus(sprintId, taskId, 'failed', developerId);
  broadcast({ type: 'task:status', sprintId, taskId, status: 'failed', developerId });
  broadcast({
    type: 'task:log',
    sprintId,
    taskId,
    developerId,
    line: `Decomposed into ${data.subtasks.length} subtasks`,
  });

  // Add subtasks to the sprint plan
  const newTasks = addSubtasks(sprintId, taskId, data.subtasks.map((s) => ({
    title: s.title,
    description: s.description,
    acceptance_criteria: s.acceptance_criteria || [],
    files_touched: s.files_touched || [],
  })));

  // Enqueue each subtask
  const { enqueueSubtask } = await import('../queues/queue-manager.js');
  for (const newTask of newTasks) {
    await enqueueSubtask(sprintId, newTask, developerId);
    broadcast({ type: 'task:status', sprintId, taskId: newTask.id, status: 'pending', developerId });
  }

  log.info(`Decomposed task ${taskId} into ${newTasks.length} subtasks: ${newTasks.map((t) => t.id).join(', ')}`);
}

function buildConflictResolutionPrompt(targetDir: string, conflicts: string[]): string {
  const fileList = conflicts.map((f) => `- ${f}`).join('\n');
  return `You are resolving merge conflicts in a git repository.

Working directory: ${targetDir}

The following files have merge conflicts:
${fileList}

Instructions:
1. Read each conflicted file listed above
2. Look for conflict markers (<<<<<<< HEAD, =======, >>>>>>> branch)
3. Understand what both sides intended and produce a correct resolution that preserves both changes
4. Write the resolved content back to each file (remove all conflict markers)
5. Run \`git add <file>\` for each resolved file
6. Do NOT run git commit — the caller will handle that

Important:
- Resolve ALL conflicts in ALL listed files
- Make sure no conflict markers remain in any file
- Preserve the intent of both sides when possible
- If both sides added different content, include both additions in a logical order`;
}

function createConflictResolver(sprintId: string): ConflictResolver {
  return async (targetDir: string, conflicts: string[]): Promise<void> => {
    log.info(`Invoking agent to resolve ${conflicts.length} conflicts`, { sprintId, conflicts });

    broadcast({
      type: 'task:log',
      sprintId,
      taskId: 0,
      developerId: 'system',
      line: `Resolving merge conflicts in: ${conflicts.join(', ')}`,
    });

    const prompt = buildConflictResolutionPrompt(targetDir, conflicts);

    const result = await runAgent({
      agentName: 'implementer',
      prompt,
      budget: String(BUDGETS.task),
      maxTurns: 30,
      sprintId,
      taskId: 'conflict-resolution',
      cwd: targetDir,
    });

    if (result.exitCode !== 0) {
      throw new Error(`Conflict resolution agent failed with exit code ${result.exitCode}`);
    }

    log.info(`Conflict resolution agent completed`, { sprintId });
  };
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

    const result = await runWithRetry(
      job,
      taskId,
      sprintId,
      taskDetails,
      cwd,
      research,
      planContent,
      String(BUDGETS.task),
    );

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

    if (job && err.message === 'TASK_TOO_COMPLEX') {
      const { sprintId, taskId, taskDetails, targetDir } = job.data as ImplementationJobData;
      log.warn(`Task ${taskId} too complex, requesting decomposition`);
      decomposeAndRequeue(sprintId, taskId, taskDetails, developerId, targetDir).catch((decompErr) => {
        log.error(`Decomposition failed for task ${taskId}: ${decompErr}`);
        setTaskStatus(sprintId, taskId, 'failed', developerId);
        broadcast({ type: 'task:status', sprintId, taskId, status: 'failed', developerId });
        broadcast({ type: 'error', sprintId, message: `Task ${taskId} decomposition failed: ${decompErr instanceof Error ? decompErr.message : String(decompErr)}` });
      });
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

  const conflictResolver = createConflictResolver(sprintId);

  if (nextWaveTasks.length === 0) {
    // No more implementation waves — finalize git and move to testing
    log.info(`All implementation waves complete for ${sprintId}, finalizing git`);

    const { finalizeImplementation } = await import('../services/git-service.js');
    await finalizeImplementation(sprint.targetDir, sprintId, developers, conflictResolver);

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
  const mergeResults = await mergeWaveAndReset(sprint.targetDir, sprintId, developers, conflictResolver);

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
    log.warn(`Merge conflicts after wave ${wave} (${failedMerges.length} unresolved)`, { conflicts: failedMerges.map((c) => c.conflicts) });
    broadcast({ type: 'error', sprintId, message: `${failedMerges.length} merge conflict(s) could not be resolved after wave ${wave} — continuing to next wave` });
  }

  // Always enqueue next wave, even if some merges failed
  log.info(`Starting wave ${nextWave} for ${sprintId} (${nextWaveTasks.length} tasks)`);
  broadcast({ type: 'wave:started', sprintId, wave: nextWave, taskIds: nextWaveTasks.map((t) => t.id) });

  const { setCurrentWave } = await import('../services/state-service.js');
  setCurrentWave(sprintId, nextWave);

  const { enqueueNextWave } = await import('../queues/queue-manager.js');
  await enqueueNextWave(sprintId, nextWave);
}
