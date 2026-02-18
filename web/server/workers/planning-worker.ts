// Planning worker: runs the planner agent to create a task breakdown

import { Worker, Job } from 'bullmq';
import fs from 'node:fs';
import path from 'node:path';
import { getRedisConnection } from '../utils/redis.js';
import { BUDGETS } from '../config.js';
import { runAgentJob } from './base-worker.js';
import { setSprintStatus, setSprintPlan, setSprintApprovedAt, getSprintDir, sprintNeedsApproval } from '../services/state-service.js';
import { broadcast } from '../websocket/ws-server.js';
import { startImplementation } from '../services/sprint-lifecycle.js';
import { createLogger } from '../utils/logger.js';
import type { Plan } from '../../shared/types.js';

const log = createLogger('planning-worker');

interface PlanningJobData {
  sprintId: string;
  specPath: string;
  targetDir: string;
  developerCount: number;
}

export function startPlanningWorker(): Worker {
  const connection = getRedisConnection();

  const worker = new Worker('planning', async (job: Job<PlanningJobData>) => {
    const { sprintId, specPath, targetDir, developerCount } = job.data;
    log.info(`Starting planning for ${sprintId}`, { developerCount });

    const spec = fs.readFileSync(specPath, 'utf-8');
    const researchFile = path.join(getSprintDir(sprintId), 'research.md');
    const research = fs.existsSync(researchFile) ? fs.readFileSync(researchFile, 'utf-8') : '';

    const prompt = `Sprint ID: ${sprintId}
Number of developers: ${developerCount}
Target project directory: ${targetDir}
Write the plan to: ${path.join(getSprintDir(sprintId), 'plan.json')}

Feature Specification:
${spec}

Codebase Research:
${research}`;

    const result = await runAgentJob(job, 'planner', prompt, {
      budget: String(BUDGETS.plan),
      taskId: 'planning',
    });

    // Read the plan from disk (the planner agent should have written it)
    const planFile = path.join(getSprintDir(sprintId), 'plan.json');
    if (!fs.existsSync(planFile)) {
      throw new Error('Planner did not create plan.json');
    }

    const plan: Plan = JSON.parse(fs.readFileSync(planFile, 'utf-8'));

    // Always use the requested developer count — the planner may output a different value
    plan.developer_count = developerCount;

    // Save enriched plan and update state
    fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));
    setSprintPlan(sprintId, plan);

    // Check if plan needs human approval based on autonomy mode
    if (sprintNeedsApproval(sprintId, 'plan')) {
      setSprintStatus(sprintId, 'awaiting-approval');
      broadcast({ type: 'sprint:status', sprintId, status: 'awaiting-approval' });
      log.info(`Plan requires approval for ${sprintId}`);
    } else {
      // Auto-approve: skip waiting and start implementation directly
      log.info(`Auto-approving plan for ${sprintId} (autonomy mode)`);
      setSprintStatus(sprintId, 'approved');
      setSprintApprovedAt(sprintId);
      broadcast({ type: 'sprint:status', sprintId, status: 'approved' });

      try {
        await startImplementation(sprintId);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error(`Auto-approve implementation start failed for ${sprintId}: ${message}`);
        setSprintStatus(sprintId, 'awaiting-approval');
        broadcast({ type: 'sprint:status', sprintId, status: 'awaiting-approval' });
        broadcast({ type: 'error', sprintId, message: `Auto-start failed, manual approval required: ${message}` });
      }
    }

    return { success: true, duration: result.durationSeconds, taskCount: plan.tasks.length };
  }, {
    connection,
    concurrency: 1,
  });

  worker.on('failed', (job, err) => {
    log.error(`Planning job failed: ${err.message}`, { jobId: job?.id });
    if (job) {
      const { sprintId } = job.data as PlanningJobData;
      setSprintStatus(sprintId, 'failed');
      broadcast({ type: 'error', sprintId, message: `Planning failed: ${err.message}` });
    }
  });

  log.info('Planning worker started');
  return worker;
}
