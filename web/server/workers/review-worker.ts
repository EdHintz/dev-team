// Review worker: runs the reviewer agent to check code quality

import { Worker, Job } from 'bullmq';
import fs from 'node:fs';
import path from 'node:path';
import { getRedisConnection } from '../utils/redis.js';
import { SPRINTS_DIR, BUDGETS, MAX_FIX_CYCLES } from '../config.js';
import { runAgentJob } from './base-worker.js';
import { setSprintStatus } from '../services/state-service.js';
import { enqueuePrCreation, enqueueFixCycle } from '../queues/queue-manager.js';
import { broadcast } from '../websocket/ws-server.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('review-worker');

interface ReviewJobData {
  sprintId: string;
  cycle: number;
  targetDir: string;
}

export function startReviewWorker(): Worker {
  const connection = getRedisConnection();

  const worker = new Worker('review', async (job: Job<ReviewJobData>) => {
    const { sprintId, cycle, targetDir } = job.data;
    log.info(`Starting review cycle ${cycle} for ${sprintId}`);

    broadcast({ type: 'review:update', sprintId, cycle, status: 'reviewing' });

    const researchFile = path.join(SPRINTS_DIR, sprintId, 'research.md');
    const research = fs.existsSync(researchFile) ? fs.readFileSync(researchFile, 'utf-8') : '';
    const planFile = path.join(SPRINTS_DIR, sprintId, 'plan.json');
    const planContent = fs.existsSync(planFile) ? fs.readFileSync(planFile, 'utf-8') : '';

    const prompt = `You are the code reviewer for sprint ${sprintId}, review cycle ${cycle}.

Codebase Research:
${research}

Sprint Plan:
${planContent}

Working directory: ${targetDir}

Instructions:
1. Review the git diff for this sprint
2. Run linting and tests
3. Categorize findings as MUST-FIX, SHOULD-FIX, or NITPICK
4. Output APPROVE if the code is ready, or REQUEST_CHANGES if there are MUST-FIX items
5. Write your review to: ${path.join(SPRINTS_DIR, sprintId, `review-${cycle}.md`)}`;

    const result = await runAgentJob(job, 'reviewer', prompt, {
      budget: String(BUDGETS.review),
      taskId: `review-${cycle}`,
      cwd: targetDir,
    });

    // Check if review approved or needs changes
    const isApproved = result.output.includes('APPROVE') && !result.output.includes('MUST-FIX');

    if (isApproved) {
      broadcast({ type: 'review:update', sprintId, cycle, status: 'approved' });
      setSprintStatus(sprintId, 'pr-created');

      // Enqueue PR creation
      await enqueuePrCreation(sprintId);
    } else if (cycle < MAX_FIX_CYCLES) {
      broadcast({ type: 'review:update', sprintId, cycle, status: 'needs-fixes' });
      log.info(`Review cycle ${cycle} needs fixes, enqueuing fix job`);

      // Enqueue a fix job — implementer will fix issues then trigger review cycle+1
      await enqueueFixCycle(sprintId, cycle, result.output);
    } else {
      broadcast({ type: 'review:update', sprintId, cycle, status: 'max-cycles-reached' });
      setSprintStatus(sprintId, 'failed');
      broadcast({ type: 'sprint:status', sprintId, status: 'failed' });
      log.warn(`Max review cycles reached for ${sprintId}, marking as failed`);
    }

    return { success: true, approved: isApproved, duration: result.durationSeconds };
  }, {
    connection,
    concurrency: 1,
  });

  worker.on('failed', (job, err) => {
    log.error(`Review job failed: ${err.message}`, { jobId: job?.id });
    if (job) {
      const { sprintId } = job.data as ReviewJobData;
      setSprintStatus(sprintId, 'failed');
      broadcast({ type: 'sprint:status', sprintId, status: 'failed' });
      broadcast({ type: 'error', sprintId, message: `Review failed: ${err.message}` });
    }
  });

  log.info('Review worker started');
  return worker;
}
