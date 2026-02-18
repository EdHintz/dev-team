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

    const prompt = `Sprint ID: ${sprintId}
Working directory: ${targetDir}

Sprint Plan:
${planContent}

Codebase Research:
${research}`;

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
