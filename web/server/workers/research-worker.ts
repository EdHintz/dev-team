// Research worker: runs the researcher agent to analyze the target codebase

import { Worker, Job } from 'bullmq';
import fs from 'node:fs';
import path from 'node:path';
import { getRedisConnection } from '../utils/redis.js';
import { BUDGETS } from '../config.js';
import { runAgentJob } from './base-worker.js';
import { setSprintStatus, getSprintDir } from '../services/state-service.js';
import { enqueuePlanning } from '../queues/queue-manager.js';
import { broadcast } from '../websocket/ws-server.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('research-worker');

interface ResearchJobData {
  sprintId: string;
  specPath: string;
  targetDir: string;
}

export function startResearchWorker(): Worker {
  const connection = getRedisConnection();

  const worker = new Worker('research', async (job: Job<ResearchJobData>) => {
    const { sprintId, specPath, targetDir } = job.data;
    log.info(`Starting research for ${sprintId}`);

    const spec = fs.readFileSync(specPath, 'utf-8');

    const prompt = `You are analyzing a codebase for a sprint.

Sprint ID: ${sprintId}

Feature Specification:
${spec}

Target project directory: ${targetDir}

Analyze the codebase at the target directory and produce a research.md file in the sprint directory at: ${path.join(getSprintDir(sprintId), 'research.md')}

Focus on:
1. Project structure and directory layout
2. Technology stack and dependencies
3. Existing patterns and conventions
4. Relevant existing code that relates to the spec
5. Recommendations for implementation approach`;

    const result = await runAgentJob(job, 'researcher', prompt, {
      budget: String(BUDGETS.research),
      taskId: 'research',
    });

    // Verify research.md was created
    const researchFile = path.join(getSprintDir(sprintId), 'research.md');
    if (!fs.existsSync(researchFile)) {
      // Write the agent output as research.md if it didn't create the file itself
      fs.writeFileSync(researchFile, result.output);
    }

    // Transition to planning
    setSprintStatus(sprintId, 'planning');
    broadcast({ type: 'sprint:status', sprintId, status: 'planning' });

    // Enqueue the planning job
    await enqueuePlanning(sprintId, specPath, targetDir, 2);

    return { success: true, duration: result.durationSeconds };
  }, {
    connection,
    concurrency: 1,
  });

  worker.on('failed', (job, err) => {
    log.error(`Research job failed: ${err.message}`, { jobId: job?.id });
    if (job) {
      const { sprintId } = job.data as ResearchJobData;
      setSprintStatus(sprintId, 'failed');
      broadcast({ type: 'error', sprintId, message: `Research failed: ${err.message}` });
    }
  });

  log.info('Research worker started');
  return worker;
}
