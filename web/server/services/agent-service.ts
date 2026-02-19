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
  stderr: string;
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
    '--verbose',
    '--output-format', 'stream-json',
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
      env: { ...process.env, CLAUDECODE: undefined },
    });

    // Close stdin immediately to prevent agent from waiting for input
    child.stdin.end();

    const outputChunks: string[] = [];
    const errorChunks: string[] = [];
    let lineBuf = '';
    let hasEmittedText = false;

    child.stdout.on('data', (chunk: Buffer) => {
      lineBuf += chunk.toString();
      const lines = lineBuf.split('\n');
      lineBuf = lines.pop() || ''; // keep incomplete last line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
            for (const block of event.message.content) {
              if (block.type === 'text' && block.text) {
                // Skip whitespace-only blocks before any real content
                if (!hasEmittedText && !block.text.trim()) continue;
                // Trim leading whitespace from the very first text block
                const text = hasEmittedText ? block.text : block.text.trimStart();
                hasEmittedText = true;
                outputChunks.push(text);
                if (options.onStdout) options.onStdout(text);
              } else if (block.type === 'tool_use' && block.name) {
                if (options.onStdout) options.onStdout(`⚡ ${block.name}${summarizeToolInput(block.name, block.input)}`);
              }
            }
          } else if (event.type === 'result' && event.result && outputChunks.length === 0) {
            outputChunks.push(event.result);
          }
        } catch {
          // non-JSON line — pass through as-is
          outputChunks.push(line);
          if (options.onStdout) options.onStdout(line);
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
      const output = outputChunks.join('\n');

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
        stderr: errorChunks.join(''),
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

/** Extract a short summary from a tool_use input to show alongside the tool name in logs. */
function summarizeToolInput(toolName: string, input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  try {
    switch (toolName) {
      case 'Read':
        if (input.file_path) return ` ${basename(String(input.file_path))}`;
        break;
      case 'Write':
        if (input.file_path) return ` ${basename(String(input.file_path))}`;
        break;
      case 'Edit':
        if (input.file_path) return ` ${basename(String(input.file_path))}`;
        break;
      case 'Bash':
        if (input.command) {
          const cmd = String(input.command).split('\n')[0].slice(0, 80);
          return ` ${cmd}`;
        }
        break;
      case 'Glob':
        if (input.pattern) return ` ${input.pattern}`;
        break;
      case 'Grep':
        if (input.pattern) return ` "${input.pattern}"`;
        break;
      case 'Task':
        if (input.description) return ` ${input.description}`;
        break;
    }
  } catch {
    // best-effort
  }
  return '';
}

function basename(filePath: string): string {
  const i = filePath.lastIndexOf('/');
  return i >= 0 ? filePath.slice(i + 1) : filePath;
}

async function trackCost(sprintId: string, agentName: string, taskId: string, durationSeconds: number): Promise<void> {
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

    // Refresh in-memory state and broadcast to clients
    const { updateCosts } = await import('./state-service.js');
    const updated = updateCosts(sprintId);
    const { broadcast } = await import('../websocket/ws-server.js');
    broadcast({ type: 'cost:update', sprintId, costs: updated });
  } catch {
    log.warn('Could not update cost tracker', { costFile });
  }
}
