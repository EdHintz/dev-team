// Planning worker: runs the planner agent to create a task breakdown

import { Worker, Job } from 'bullmq';
import fs from 'node:fs';
import path from 'node:path';
import { getRedisConnection } from '../utils/redis.js';
import { SPRINTS_DIR, BUDGETS } from '../config.js';
import { runAgentJob } from './base-worker.js';
import { setSprintStatus, setSprintPlan } from '../services/state-service.js';
import { broadcast } from '../websocket/ws-server.js';
import { createLogger } from '../utils/logger.js';
import type { Plan } from '../../shared/types.js';

const log = createLogger('planning-worker');

interface PlanningJobData {
  sprintId: string;
  specPath: string;
  targetDir: string;
  implementerCount: number;
}

export function startPlanningWorker(): Worker {
  const connection = getRedisConnection();

  const worker = new Worker('planning', async (job: Job<PlanningJobData>) => {
    const { sprintId, specPath, targetDir, implementerCount } = job.data;
    log.info(`Starting planning for ${sprintId}`, { implementerCount });

    const spec = fs.readFileSync(specPath, 'utf-8');
    const researchFile = path.join(SPRINTS_DIR, sprintId, 'research.md');
    const research = fs.existsSync(researchFile) ? fs.readFileSync(researchFile, 'utf-8') : '';

    const prompt = `You are planning a sprint.

Sprint ID: ${sprintId}

Feature Specification:
${spec}

Codebase Research:
${research}

Target project directory: ${targetDir}

Number of implementers: ${implementerCount}

IMPORTANT: You must distribute tasks across ${implementerCount} implementers. For each task, include:
- "assigned_to": which implementer should do it ("implementer-1", "implementer-2", etc.)
- "files_touched": list of files this task will likely create or modify
- "wave": execution wave number (tasks in the same wave with different implementers run in parallel)

Distribution guidelines:
- Group tasks by file domain to minimize cross-implementer file overlap
- Tasks in the same wave assigned to different implementers MUST NOT touch the same files
- Minimize cross-implementer dependencies (task A on impl-1 depending on task B on impl-2)
- Wave 1 has tasks with no dependencies; subsequent waves depend on prior waves completing

Write the plan to: ${path.join(SPRINTS_DIR, sprintId, 'plan.json')}`;

    const result = await runAgentJob(job, 'planner', prompt, {
      budget: String(BUDGETS.plan),
      taskId: 'planning',
    });

    // Read the plan from disk (the planner agent should have written it)
    const planFile = path.join(SPRINTS_DIR, sprintId, 'plan.json');
    if (!fs.existsSync(planFile)) {
      throw new Error('Planner did not create plan.json');
    }

    const plan: Plan = JSON.parse(fs.readFileSync(planFile, 'utf-8'));

    // Enrich plan with implementer_count if not set
    plan.implementer_count = plan.implementer_count || implementerCount;

    // Save enriched plan and update state
    fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));
    setSprintPlan(sprintId, plan);

    // Transition to awaiting approval
    setSprintStatus(sprintId, 'awaiting-approval');
    broadcast({ type: 'sprint:status', sprintId, status: 'awaiting-approval' });

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
