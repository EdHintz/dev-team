// Claude CLI wrapper for agent invocation
// Ported from scripts/lib/agent.sh

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { AGENTS_DIR, getModelForAgent } from '../config.js';
import { getSprintDir } from './state-service.js';
import { createLogger } from '../utils/logger.js';
import type { CostData } from '../../shared/types.js';

const log = createLogger('agent-service');

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';

export interface RunAgentOptions {
  agentName: string;
  prompt: string;
  budget?: string;
  model?: string;
  maxTurns?: number;
  sprintId?: string;
  taskId?: string;
  cwd?: string;
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
}

export interface AgentResult {
  output: string;
  exitCode: number;
  durationSeconds: number;
  logFile?: string;
}

export async function runAgent(options: RunAgentOptions): Promise<AgentResult> {
  const model = options.model || getModelForAgent(options.agentName);
  const agentFile = path.join(AGENTS_DIR, `${options.agentName}.md`);

  if (!fs.existsSync(agentFile)) {
    throw new Error(`Agent definition not found: ${agentFile}`);
  }

  // Set up logging
  let logFile: string | undefined;
  if (options.sprintId) {
    const logDir = path.join(getSprintDir(options.sprintId), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    logFile = path.join(logDir, `${options.agentName}-${options.taskId || 'general'}-${timestamp}.log`);
  }

  // Read agent system prompt from file so it works regardless of cwd
  const agentPrompt = fs.readFileSync(agentFile, 'utf-8');

  // Build command args
  const args = [
    '--print',
    '--model', model,
    '--system-prompt', agentPrompt,
    '--dangerously-skip-permissions',
  ];

  if (options.budget) {
    args.push('--max-budget-usd', options.budget);
  }

  if (options.maxTurns) {
    args.push('--max-turns', String(options.maxTurns));
  }

  args.push(options.prompt);

  log.info(`Running ${options.agentName} agent`, { model, taskId: options.taskId });

  const startTime = Date.now();

  return new Promise<AgentResult>((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    // Close stdin immediately to prevent agent from waiting for input
    child.stdin.end();

    const outputChunks: string[] = [];
    const errorChunks: string[] = [];

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      outputChunks.push(text);

      // Stream lines to callback for real-time log viewing
      if (options.onStdout) {
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            options.onStdout(line);
          }
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      errorChunks.push(text);
      if (options.onStderr) {
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            options.onStderr(line);
          }
        }
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn claude CLI: ${err.message}`));
    });

    child.on('close', (code) => {
      const endTime = Date.now();
      const durationSeconds = Math.round((endTime - startTime) / 1000);
      const exitCode = code ?? 1;
      const output = outputChunks.join('');

      // Write log file
      if (logFile) {
        const logContent = [
          `=== Agent: ${options.agentName} ===`,
          `=== Model: ${model} ===`,
          `=== Sprint: ${options.sprintId || 'none'} ===`,
          `=== Task: ${options.taskId || 'none'} ===`,
          `=== Duration: ${durationSeconds}s ===`,
          `=== Exit Code: ${exitCode} ===`,
          `=== Output ===`,
          output,
          errorChunks.length > 0 ? `=== Stderr ===\n${errorChunks.join('')}` : '',
        ].join('\n');

        try {
          fs.writeFileSync(logFile, logContent);
        } catch {
          log.warn('Could not write log file', { logFile });
        }
      }

      // Track cost
      if (options.sprintId) {
        trackCost(options.sprintId, options.agentName, options.taskId || '', durationSeconds);
      }

      if (exitCode !== 0) {
        log.error(`Agent ${options.agentName} exited with code ${exitCode}`, { logFile });
      } else {
        log.info(`Agent ${options.agentName} completed in ${durationSeconds}s`);
      }

      resolve({
        output,
        exitCode,
        durationSeconds,
        logFile,
      });
    });
  });
}

/**
 * Run an agent and extract the last JSON block from its output.
 */
export async function runAgentJson<T = unknown>(options: RunAgentOptions): Promise<{ data: T | null; result: AgentResult }> {
  const result = await runAgent(options);
  const data = extractLastJson<T>(result.output);
  return { data, result };
}

function extractLastJson<T>(text: string): T | null {
  // Find all JSON blocks (between { } or [ ])
  const blocks: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{' || ch === '[') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0 && start !== -1) {
        blocks.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  // Try to parse from last to first
  for (let i = blocks.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(blocks[i]) as T;
    } catch {
      continue;
    }
  }

  return null;
}

function trackCost(sprintId: string, agentName: string, taskId: string, durationSeconds: number): void {
  const costFile = path.join(getSprintDir(sprintId), 'cost.json');

  try {
    let costs: CostData;
    if (fs.existsSync(costFile)) {
      costs = JSON.parse(fs.readFileSync(costFile, 'utf-8'));
    } else {
      costs = { total: 0, by_agent: {}, by_task: {}, sessions: [] };
    }

    if (!costs.sessions) costs.sessions = [];

    costs.sessions.push({
      agent: agentName,
      task: taskId,
      duration_seconds: durationSeconds,
    });

    costs.by_agent[agentName] = (costs.by_agent[agentName] || 0) + durationSeconds;

    if (taskId) {
      costs.by_task[taskId] = (costs.by_task[taskId] || 0) + durationSeconds;
    }

    fs.writeFileSync(costFile, JSON.stringify(costs, null, 2));
  } catch {
    log.warn('Could not update cost tracker', { costFile });
  }
}
