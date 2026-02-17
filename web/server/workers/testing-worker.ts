// Testing worker: runs the tester agent to write and run tests

import { Worker, Job } from 'bullmq';
import fs from 'node:fs';
import path from 'node:path';
import { getRedisConnection } from '../utils/redis.js';
import { BUDGETS } from '../config.js';
import { getSprintDir } from '../services/state-service.js';
import { runAgentJob } from './base-worker.js';
import { broadcast } from '../websocket/ws-server.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('testing-worker');

interface TestingJobData {
  sprintId: string;
  targetDir: string;
}

export function startTestingWorker(): Worker {
  const connection = getRedisConnection();

  const worker = new Worker('testing', async (job: Job<TestingJobData>) => {
    const { sprintId, targetDir } = job.data;
    log.info(`Starting testing for ${sprintId}`);

    const researchFile = path.join(getSprintDir(sprintId), 'research.md');
    const research = fs.existsSync(researchFile) ? fs.readFileSync(researchFile, 'utf-8') : '';
    const planFile = path.join(getSprintDir(sprintId), 'plan.json');
    const planContent = fs.existsSync(planFile) ? fs.readFileSync(planFile, 'utf-8') : '';

    const prompt = `You are the integration tester for sprint ${sprintId}.

Multiple developers worked on this sprint in parallel — their code has been merged. Your job is to verify everything works together.

Sprint Plan (shows which tasks were assigned to which developers):
${planContent}

Codebase Research:
${research}

Working directory: ${targetDir}

Instructions:
1. Run the existing test suite first: npm test. Report any failures — these likely indicate merge incompatibilities between developers' work.
2. Read the plan to identify tasks from different developers that touch related areas (shared modules, APIs one produces and another consumes, shared types).
3. Write a small number of targeted integration tests (3-8) covering those cross-task boundaries. Do NOT write unit tests — developers already handle those.
4. Run the full test suite again: npm test
5. Stage your test files with git add (but do NOT commit)
6. Print a summary of which integration points you tested and the results

If there was only one developer, just run the existing test suite and report results — skip writing new tests unless you see untested cross-module interactions.`;

    const result = await runAgentJob(job, 'tester', prompt, {
      budget: String(BUDGETS.test),
      taskId: 'testing',
      cwd: targetDir,
    });

    // Testing done — enqueue review
    log.info(`Testing complete for ${sprintId}, starting review`);
    const { enqueueReview } = await import('../queues/queue-manager.js');
    await enqueueReview(sprintId, 1);

    return { success: true, duration: result.durationSeconds };
  }, {
    connection,
    concurrency: 1,
  });

  worker.on('failed', (job, err) => {
    log.error(`Testing job failed: ${err.message}`, { jobId: job?.id });
    if (job) {
      const { sprintId } = job.data as TestingJobData;
      import('../services/state-service.js').then(({ setSprintStatus }) => {
        setSprintStatus(sprintId, 'failed');
        broadcast({ type: 'sprint:status', sprintId, status: 'failed' });
      });
      broadcast({ type: 'error', sprintId, message: `Testing failed: ${err.message}` });
    }
  });

  log.info('Testing worker started');
  return worker;
}
