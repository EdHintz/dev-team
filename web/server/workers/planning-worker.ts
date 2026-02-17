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

    const prompt = `You are planning a sprint.

Sprint ID: ${sprintId}

Feature Specification:
${spec}

Codebase Research:
${research}

Target project directory: ${targetDir}

Number of developers: ${developerCount}

IMPORTANT: You must distribute tasks across ${developerCount} developers. For each task, include:
- "assigned_to": which developer should do it ("developer-1", "developer-2", etc.)
- "files_touched": list of files this task will likely create or modify
- "wave": execution wave number (tasks in the same wave with different developers run in parallel)

Distribution guidelines:
- Group tasks by file domain to minimize cross-developer file overlap
- Tasks in the same wave assigned to different developers MUST NOT touch the same files
- Minimize cross-developer dependencies (task A on dev-1 depending on task B on dev-2)
- Wave 1 has tasks with no dependencies; subsequent waves depend on prior waves completing

IMPORTANT: Include an "estimates" object in the plan JSON with:
- "ai_team": estimated wall-clock time for this AI dev team to complete the sprint (e.g. "~25 minutes"). Consider each task takes roughly 3-8 min by complexity (small ~3min, medium ~5min, large ~8min), and same-wave tasks run in parallel.
- "ai_team_minutes": numeric version of ai_team in minutes (e.g. 25)
- "human_team": estimated time for ${developerCount} human developer(s) to implement the same spec (e.g. "~3-4 days"). Use realistic professional estimates including code review and testing.
- "human_team_minutes": numeric version of human_team in minutes. IMPORTANT: 1 work day = 8 hours = 480 minutes (not 24 hours).

Write the plan to: ${path.join(getSprintDir(sprintId), 'plan.json')}`;

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

    // Enrich plan with developer_count if not set
    plan.developer_count = plan.developer_count || developerCount;

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
