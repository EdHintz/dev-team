// Git operations with worktree support for multiple implementers

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { createLogger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);
const log = createLogger('git');

export interface MergeResult {
  success: boolean;
  conflicts?: string[];
}

async function git(args: string[], cwd: string, quiet = false): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd });
    return stdout.trim();
  } catch (err) {
    if (!quiet) {
      const message = err instanceof Error ? err.message : 'git command failed';
      log.error('Git error', { args: args.join(' '), cwd, error: message });
    }
    throw err;
  }
}

// --- Branch Management ---

export async function getCurrentBranch(cwd: string): Promise<string> {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
}

export async function createSprintBranch(targetDir: string, sprintId: string): Promise<string> {
  const branchName = `sprint/${sprintId}`;
  await git(['checkout', '-b', branchName], targetDir);
  log.info(`Created sprint branch: ${branchName}`);
  return branchName;
}

export async function checkoutBranch(cwd: string, branch: string): Promise<void> {
  await git(['checkout', branch], cwd);
}

// --- Worktree Management ---

/**
 * Create a git worktree for an implementer on a sub-branch of the sprint branch.
 * Returns the path to the worktree.
 */
export async function createWorktree(
  targetDir: string,
  sprintId: string,
  implementerId: string,
): Promise<string> {
  const worktreePath = path.resolve(targetDir, '..', `${path.basename(targetDir)}-worktree-${implementerId}`);
  const branchName = `sprint/${sprintId}/${implementerId}`;

  // Clean up if worktree already exists
  if (fs.existsSync(worktreePath)) {
    await removeWorktree(targetDir, worktreePath);
  }

  await git(['worktree', 'add', worktreePath, '-b', branchName], targetDir);
  log.info(`Created worktree for ${implementerId}`, { worktreePath, branchName });

  return worktreePath;
}

/**
 * Remove a git worktree and delete its branch.
 */
export async function removeWorktree(targetDir: string, worktreePath: string): Promise<void> {
  try {
    await git(['worktree', 'remove', worktreePath, '--force'], targetDir);
    log.info(`Removed worktree: ${worktreePath}`);
  } catch {
    // Worktree may not exist
    log.warn(`Could not remove worktree: ${worktreePath}`);
  }
}

/**
 * Clean up all worktrees for a sprint.
 */
export async function cleanupWorktrees(
  targetDir: string,
  sprintId: string,
  implementerIds: string[],
): Promise<void> {
  for (const implId of implementerIds) {
    const worktreePath = path.resolve(targetDir, '..', `${path.basename(targetDir)}-worktree-${implId}`);
    await removeWorktree(targetDir, worktreePath);

    // Delete the implementer sub-branch
    const branchName = `sprint/${sprintId}/${implId}`;
    try {
      await git(['branch', '-D', branchName], targetDir);
    } catch {
      // Branch may not exist
    }
  }

  // Prune worktree metadata
  try {
    await git(['worktree', 'prune'], targetDir);
  } catch {
    // Not critical
  }
}

// --- Merge ---

/**
 * Merge an implementer's branch back into the sprint branch.
 */
export async function mergeImplementerBranch(
  targetDir: string,
  sprintId: string,
  implementerId: string,
): Promise<MergeResult> {
  const sprintBranch = `sprint/${sprintId}`;
  const implBranch = `sprint/${sprintId}/${implementerId}`;

  // Ensure we're on the sprint branch
  await git(['checkout', sprintBranch], targetDir);

  try {
    await git(['merge', implBranch, '--no-edit'], targetDir);
    log.info(`Merged ${implBranch} into ${sprintBranch}`);
    return { success: true };
  } catch (err) {
    // Check for merge conflicts
    const message = err instanceof Error ? err.message : '';
    if (message.includes('CONFLICT') || message.includes('Automatic merge failed')) {
      const conflicts = await getConflictFiles(targetDir);
      log.warn(`Merge conflicts detected`, { implBranch, conflicts });

      // Abort the merge for now — let the orchestrator decide what to do
      await git(['merge', '--abort'], targetDir);
      return { success: false, conflicts };
    }
    throw err;
  }
}

async function getConflictFiles(cwd: string): Promise<string[]> {
  try {
    const output = await git(['diff', '--name-only', '--diff-filter=U'], cwd);
    return output.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Reset a worktree to match the sprint branch head.
 * Used before starting a new wave.
 */
export async function resetWorktreeToSprint(
  targetDir: string,
  worktreePath: string,
  sprintId: string,
  implementerId: string,
): Promise<void> {
  const sprintBranch = `sprint/${sprintId}`;
  const implBranch = `sprint/${sprintId}/${implementerId}`;

  // Delete and recreate the implementer branch from the current sprint branch
  try {
    await git(['checkout', sprintBranch], worktreePath);
    await git(['branch', '-D', implBranch], targetDir);
  } catch {
    // Branch may not exist
  }

  await git(['checkout', '-b', implBranch], worktreePath);
  log.info(`Reset worktree to sprint head`, { worktreePath, implBranch });
}

// --- Commit ---

export async function commitInWorktree(
  worktreePath: string,
  message: string,
): Promise<void> {
  await git(['add', '-A'], worktreePath);

  // Check if there are any changes to commit
  // diff --quiet exits with 1 when there are changes — this is expected, so suppress the error log
  try {
    await git(['diff', '--cached', '--quiet'], worktreePath, true);
    log.info('No changes to commit');
    return;
  } catch {
    // Has staged changes — proceed with commit
  }

  await git(['commit', '-m', message], worktreePath);
  log.info(`Committed: ${message.split('\n')[0]}`);
}

export async function stageAll(cwd: string): Promise<void> {
  await git(['add', '-A'], cwd);
}

// --- Push ---

export async function pushBranch(cwd: string, branch: string): Promise<void> {
  await git(['push', '-u', 'origin', branch], cwd);
  log.info(`Pushed branch: ${branch}`);
}

// --- Diff ---

export async function getDiff(cwd: string, base?: string): Promise<string> {
  if (base) {
    return git(['diff', `${base}...HEAD`], cwd);
  }
  return git(['diff', '--staged'], cwd);
}

// --- Sprint Git Lifecycle ---

/**
 * Set up git state for a new sprint:
 * 1. Create sprint branch from current HEAD (should be on main)
 * 2. Create a worktree for each implementer
 * Returns map of implementerId → worktreePath
 */
export async function setupSprintGit(
  targetDir: string,
  sprintId: string,
  implementerIds: string[],
): Promise<Map<string, string>> {
  // Create the sprint branch
  const sprintBranch = `sprint/${sprintId}`;
  try {
    await git(['checkout', '-b', sprintBranch], targetDir);
    log.info(`Created sprint branch: ${sprintBranch}`);
  } catch {
    // Branch may already exist (restart scenario)
    await git(['checkout', sprintBranch], targetDir);
    log.info(`Checked out existing sprint branch: ${sprintBranch}`);
  }

  // Create worktrees for each implementer
  const worktreePaths = new Map<string, string>();
  for (const implId of implementerIds) {
    const wtPath = await createWorktree(targetDir, sprintId, implId);
    worktreePaths.set(implId, wtPath);
  }

  return worktreePaths;
}

/**
 * After a wave completes, merge each implementer's branch back to the sprint branch,
 * then reset worktrees for the next wave.
 */
export async function mergeWaveAndReset(
  targetDir: string,
  sprintId: string,
  implementerIds: string[],
): Promise<MergeResult[]> {
  const results: MergeResult[] = [];

  // Switch to sprint branch in the main targetDir
  const sprintBranch = `sprint/${sprintId}`;
  await git(['checkout', sprintBranch], targetDir);

  // Merge each implementer's branch
  for (const implId of implementerIds) {
    const result = await mergeImplementerBranch(targetDir, sprintId, implId);
    results.push(result);
    if (!result.success) {
      log.warn(`Merge conflict from ${implId}`, { conflicts: result.conflicts });
    }
  }

  // Reset worktrees for the next wave
  for (const implId of implementerIds) {
    const worktreePath = path.resolve(targetDir, '..', `${path.basename(targetDir)}-worktree-${implId}`);
    if (fs.existsSync(worktreePath)) {
      await resetWorktreeToSprint(targetDir, worktreePath, sprintId, implId);
    }
  }

  return results;
}

/**
 * After all implementation is done, clean up worktrees.
 * Testing and review run directly on the sprint branch in targetDir.
 */
export async function finalizeImplementation(
  targetDir: string,
  sprintId: string,
  implementerIds: string[],
): Promise<void> {
  // Final merge
  await mergeWaveAndReset(targetDir, sprintId, implementerIds);

  // Clean up worktrees
  await cleanupWorktrees(targetDir, sprintId, implementerIds);

  // Stay on sprint branch for testing/review
  const sprintBranch = `sprint/${sprintId}`;
  await git(['checkout', sprintBranch], targetDir);
  log.info(`Sprint ${sprintId} finalized on branch ${sprintBranch}`);
}
