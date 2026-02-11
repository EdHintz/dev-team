// GitHub CLI helpers for sprint management
// Ported from scripts/lib/github.sh

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { SPRINTS_DIR } from '../config.js';
import { createLogger } from '../utils/logger.js';
import type { Plan, Task } from '../../shared/types.js';

const execFileAsync = promisify(execFile);
const log = createLogger('github');

async function gh(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('gh', args, { cwd });
    return stdout.trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'gh command failed';
    log.error('GitHub CLI error', { args: args.join(' '), error: message });
    throw err;
  }
}

// --- Repo ---

export async function getRepoName(cwd?: string): Promise<string> {
  return gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], cwd);
}

export async function ensureRepo(cwd?: string): Promise<boolean> {
  try {
    await gh(['repo', 'view'], cwd);
    return true;
  } catch {
    return false;
  }
}

// --- Milestone (Sprint) Management ---

export async function createMilestone(sprintId: string, description?: string, cwd?: string): Promise<string> {
  const desc = description || `Sprint ${sprintId}`;

  // Check if milestone already exists
  try {
    const existing = await gh([
      'api', 'repos/:owner/:repo/milestones',
      '--jq', `.[] | select(.title == "${sprintId}") | .number`,
    ], cwd);
    if (existing) return existing;
  } catch {
    // Milestone doesn't exist, create it
  }

  return gh([
    'api', 'repos/:owner/:repo/milestones',
    '-f', `title=${sprintId}`,
    '-f', `description=${desc}`,
    '-f', 'state=open',
    '--jq', '.number',
  ], cwd);
}

export async function closeMilestone(milestoneNumber: string, cwd?: string): Promise<void> {
  await gh([
    'api', `repos/:owner/:repo/milestones/${milestoneNumber}`,
    '-X', 'PATCH',
    '-f', 'state=closed',
    '--silent',
  ], cwd);
}

// --- Issue Management ---

export async function createIssue(
  title: string,
  body: string,
  milestoneNumber?: string,
  labels?: string[],
  cwd?: string,
): Promise<string> {
  const args = ['issue', 'create', '--title', title, '--body', body];

  if (milestoneNumber) {
    args.push('--milestone', milestoneNumber);
  }

  if (labels && labels.length > 0) {
    for (const label of labels) {
      // Ensure label exists
      try {
        await gh(['label', 'create', label, '--force'], cwd);
      } catch {
        // Label may already exist
      }
      args.push('--label', label);
    }
  }

  return gh([...args, '--json', 'number', '-q', '.number'], cwd);
}

export async function updateIssueStatus(issueNumber: string, status: string, cwd?: string): Promise<void> {
  switch (status) {
    case 'closed':
    case 'done':
      await gh(['issue', 'close', issueNumber, '--comment', 'Completed by dev-team agent.'], cwd);
      break;
    case 'in-progress':
      await gh(['issue', 'edit', issueNumber, '--add-label', 'in-progress'], cwd);
      break;
    default:
      log.info(`Unknown issue status: ${status}`);
  }
}

export async function addIssueComment(issueNumber: string, comment: string, cwd?: string): Promise<void> {
  await gh(['issue', 'comment', issueNumber, '--body', comment], cwd);
}

// --- Sprint Tasks ---

export function getSprintTasksOrdered(sprintId: string): Task[] {
  const planFile = path.join(SPRINTS_DIR, sprintId, 'plan.json');

  if (!fs.existsSync(planFile)) {
    throw new Error(`No plan.json found for sprint ${sprintId}`);
  }

  const plan: Plan = JSON.parse(fs.readFileSync(planFile, 'utf-8'));
  return topologicalSort(plan.tasks);
}

/**
 * Topological sort: returns tasks ordered by dependencies (tasks with no deps first).
 */
export function topologicalSort(tasks: Task[]): Task[] {
  const resolved = new Set<number>();
  const ordered: Task[] = [];
  const remaining = [...tasks];

  while (remaining.length > 0) {
    let progress = false;

    for (let i = remaining.length - 1; i >= 0; i--) {
      const task = remaining[i];
      const deps = new Set(task.depends_on || []);
      const allDepsResolved = [...deps].every((d) => resolved.has(d));

      if (allDepsResolved) {
        ordered.push(task);
        resolved.add(task.id);
        remaining.splice(i, 1);
        progress = true;
      }
    }

    if (!progress) {
      throw new Error('Circular dependency detected in task graph');
    }
  }

  return ordered;
}

// --- Labels ---

export async function ensureLabels(cwd?: string): Promise<void> {
  const labels = [
    'feat', 'fix', 'refactor', 'test', 'docs', 'chore',
    'backend', 'frontend', 'fullstack',
    'in-progress', 'blocked', 'sprint',
  ];

  for (const label of labels) {
    try {
      await gh(['label', 'create', label, '--force'], cwd);
    } catch {
      // Label may already exist
    }
  }
}

// --- PR Helpers ---

export async function createSprintPr(
  sprintId: string,
  branch: string,
  body: string,
  base = 'main',
  cwd?: string,
): Promise<string> {
  return gh([
    'pr', 'create',
    '--base', base,
    '--head', branch,
    '--title', `Sprint: ${sprintId}`,
    '--body', body,
  ], cwd);
}

export async function getPrReviewComments(prNumber: string, cwd?: string): Promise<string> {
  return gh([
    'api', `repos/:owner/:repo/pulls/${prNumber}/comments`,
    '--jq', '.[] | {path: .path, line: .line, body: .body, author: .user.login}',
  ], cwd);
}
