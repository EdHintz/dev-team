// PR creation worker: pushes branch and creates a GitHub pull request
// For repos without a remote, offers to merge the sprint branch into local main

import { Worker, Job } from 'bullmq';
import fs from 'node:fs';
import path from 'node:path';
import { getRedisConnection } from '../utils/redis.js';
import { getSprintDir, setSprintStatus } from '../services/state-service.js';
import { pushBranch, hasRemote, mergeSprintToMain } from '../services/git-service.js';
import { createSprintPr } from '../services/github-service.js';
import { requestApproval } from '../services/approval-gate.js';
import { broadcast } from '../websocket/ws-server.js';
import { createLogger } from '../utils/logger.js';
import type { Plan, CostData } from '../../shared/types.js';

const log = createLogger('pr-worker');

interface PrJobData {
  sprintId: string;
  targetDir: string;
  baseBranch: string;
}

export function startPrWorker(): Worker {
  const connection = getRedisConnection();

  const worker = new Worker('pr-creation', async (job: Job<PrJobData>) => {
    const { sprintId, targetDir, baseBranch } = job.data;
    log.info(`Creating PR for ${sprintId}`);

    const branch = `sprint/${sprintId}`;
    const remoteExists = await hasRemote(targetDir);

    if (remoteExists) {
      // --- Remote flow: push + create GitHub PR ---
      await pushBranch(targetDir, branch);

      const body = buildPrBody(sprintId);
      const prUrl = await createSprintPr(sprintId, branch, body, baseBranch, targetDir);

      const prFile = path.join(getSprintDir(sprintId), '.pr-url');
      fs.writeFileSync(prFile, prUrl);

      setSprintStatus(sprintId, 'pr-created');
      broadcast({ type: 'sprint:status', sprintId, status: 'pr-created' });

      log.info(`PR created: ${prUrl}`);
      return { success: true, prUrl };
    }

    // --- No remote: offer to merge locally ---
    log.info(`No remote found for ${sprintId}, offering local merge`);

    const result = await requestApproval(
      sprintId,
      'local-merge',
      `No remote repository found. Merge branch "${branch}" into local main?`,
      { branch, targetDir },
    );

    if (result.approved) {
      await mergeSprintToMain(targetDir, sprintId);
      setSprintStatus(sprintId, 'completed');
      broadcast({ type: 'sprint:status', sprintId, status: 'completed' });
      log.info(`Sprint ${sprintId} merged to local main and completed`);
      return { success: true, merged: true };
    }

    // User declined — leave branch as-is, mark pr-created so they can merge later
    setSprintStatus(sprintId, 'pr-created');
    broadcast({ type: 'sprint:status', sprintId, status: 'pr-created' });
    log.info(`Local merge declined for ${sprintId}, sprint branch preserved`);
    return { success: true, merged: false };
  }, {
    connection,
    concurrency: 1,
  });

  worker.on('failed', (job, err) => {
    log.error(`PR creation failed: ${err.message}`, { jobId: job?.id });
    if (job) {
      const { sprintId } = job.data as PrJobData;
      broadcast({ type: 'error', sprintId, message: `PR creation failed: ${err.message}` });
    }
  });

  log.info('PR worker started');
  return worker;
}

function buildPrBody(sprintId: string): string {
  const sprintDir = path.join(getSprintDir(sprintId));
  const parts: string[] = ['## Sprint Summary\n'];

  // Task summary
  try {
    const plan: Plan = JSON.parse(fs.readFileSync(path.join(sprintDir, 'plan.json'), 'utf-8'));
    parts.push('### Tasks\n');
    for (const task of plan.tasks) {
      parts.push(`- [x] **Task ${task.id}**: ${task.title} (${task.agent}${task.assigned_to ? `, ${task.assigned_to}` : ''})`);
    }
    parts.push('');
  } catch {
    // No plan
  }

  // Review summary — find latest verdict JSON, then include corresponding markdown
  try {
    const verdictFiles = fs.readdirSync(sprintDir)
      .filter((f) => /^review-\d+-verdict\.json$/.test(f))
      .sort((a, b) => {
        const numA = parseInt(a.match(/review-(\d+)/)?.[1] || '0', 10);
        const numB = parseInt(b.match(/review-(\d+)/)?.[1] || '0', 10);
        return numA - numB;
      });

    if (verdictFiles.length > 0) {
      const latestVerdictFile = verdictFiles[verdictFiles.length - 1];
      const cycleNum = latestVerdictFile.match(/review-(\d+)/)?.[1];
      const verdict = JSON.parse(fs.readFileSync(path.join(sprintDir, latestVerdictFile), 'utf-8'));
      parts.push(`### Review (Cycle ${cycleNum})\n`);
      parts.push(`**Verdict:** ${verdict.verdict} | MUST-FIX: ${verdict.must_fix_count ?? '?'} | SHOULD-FIX: ${verdict.should_fix_count ?? '?'} | NITPICK: ${verdict.nitpick_count ?? '?'}`);
      if (verdict.summary) parts.push(`\n${verdict.summary}`);
      parts.push('');
    } else {
      // Fallback: use markdown review files if no verdict JSON found
      const reviewFiles = fs.readdirSync(sprintDir)
        .filter((f) => /^review-\d+\.md$/.test(f))
        .sort((a, b) => {
          const numA = parseInt(a.match(/review-(\d+)/)?.[1] || '0', 10);
          const numB = parseInt(b.match(/review-(\d+)/)?.[1] || '0', 10);
          return numA - numB;
        });
      if (reviewFiles.length > 0) {
        const latestReview = fs.readFileSync(path.join(sprintDir, reviewFiles[reviewFiles.length - 1]), 'utf-8');
        parts.push('### Review\n');
        parts.push(latestReview.slice(0, 500));
        parts.push('');
      }
    }
  } catch {
    // No reviews
  }

  // Cost summary
  try {
    const costs: CostData = JSON.parse(fs.readFileSync(path.join(sprintDir, 'cost.json'), 'utf-8'));
    parts.push('### Cost\n');
    for (const [agent, seconds] of Object.entries(costs.by_agent)) {
      parts.push(`- ${agent}: ${seconds}s`);
    }
    parts.push('');
  } catch {
    // No costs
  }

  parts.push('---\nGenerated by dev-team orchestrator v2');
  return parts.join('\n');
}
