// Base worker logic: Claude CLI invocation with log streaming via BullMQ job progress

import { Job } from 'bullmq';
import { runAgent, type RunAgentOptions, type AgentResult } from '../services/agent-service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('worker');

export interface BaseJobData {
  sprintId: string;
  targetDir: string;
}

/**
 * Run a Claude agent as part of a BullMQ job, streaming log lines via job.updateProgress().
 */
export async function runAgentJob(
  job: Job,
  agentName: string,
  prompt: string,
  options: Partial<RunAgentOptions> = {},
): Promise<AgentResult> {
  const data = job.data as BaseJobData;

  const result = await runAgent({
    agentName,
    prompt,
    sprintId: data.sprintId,
    cwd: options.cwd || data.targetDir,
    ...options,
    onStdout: (line) => {
      job.updateProgress({
        type: 'log',
        sprintId: data.sprintId,
        taskId: (job.data as { taskId?: number }).taskId,
        line,
      });
    },
    onStderr: (line) => {
      log.warn(`[${agentName}] stderr: ${line}`);
    },
  });

  if (result.exitCode !== 0) {
    throw new Error(`Agent ${agentName} failed with exit code ${result.exitCode}`);
  }

  return result;
}
