// Git operations with worktree support for multiple developers

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
  resolved?: boolean;
}

export type ConflictResolver = (targetDir: string, conflicts: string[]) => Promise<void>;

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

// --- Repo Initialization ---

/**
 * If the target directory is not a git repository, initialize it.
 */
export async function initRepoIfNeeded(targetDir: string): Promise<void> {
  try {
    await git(['rev-parse', '--git-dir'], targetDir, true);
  } catch {
    log.info(`Initializing git repo in ${targetDir}`);
    await git(['init'], targetDir);
    // Create an initial commit so branches can be created
    await git(['commit', '--allow-empty', '-m', 'Initial commit'], targetDir);
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
 * Create a git worktree for an developer on a sub-branch of the sprint branch.
 * Returns the path to the worktree.
 */
export async function createWorktree(
  targetDir: string,
  sprintId: string,
  developerId: string,
  friendlyName?: string,
): Promise<string> {
  const suffix = friendlyName ? friendlyName.toLowerCase() : developerId;
  const worktreePath = path.resolve(targetDir, '..', `${path.basename(targetDir)}-worktree-${suffix}`);
  const branchName = `sprint/${sprintId}--${suffix}`;

  // Clean up if worktree already exists
  if (fs.existsSync(worktreePath)) {
    await removeWorktree(targetDir, worktreePath);
  }

  // Prune stale worktree references, then delete existing branch (from a previous run)
  try {
    await git(['worktree', 'prune'], targetDir, true);
  } catch { /* ignore */ }
  try {
    await git(['branch', '-D', branchName], targetDir, true);
  } catch {
    // Branch may not exist — that's fine
  }

  await git(['worktree', 'add', worktreePath, '-b', branchName], targetDir);
  log.info(`Created worktree for ${developerId}`, { worktreePath, branchName });

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
    log.warn(`Could not remove worktree via git: ${worktreePath}`);
  }

  // If the directory still exists (orphaned/unrecognized by git), remove it directly
  if (fs.existsSync(worktreePath)) {
    fs.rmSync(worktreePath, { recursive: true, force: true });
    log.info(`Removed orphaned worktree directory: ${worktreePath}`);
  }
}

/**
 * Clean up all worktrees for a sprint.
 */
export async function cleanupWorktrees(
  targetDir: string,
  sprintId: string,
  developerIds: string[],
  nameMap?: Map<string, string>,
): Promise<void> {
  for (const devId of developerIds) {
    const suffix = nameMap?.get(devId)?.toLowerCase() || devId;
    const worktreePath = path.resolve(targetDir, '..', `${path.basename(targetDir)}-worktree-${suffix}`);
    await removeWorktree(targetDir, worktreePath);

    // Delete the developer sub-branch
    const branchName = `sprint/${sprintId}--${suffix}`;
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
 * Merge an developer's branch back into the sprint branch.
 */
export async function mergeDeveloperBranch(
  targetDir: string,
  sprintId: string,
  developerId: string,
  friendlyName?: string,
  conflictResolver?: ConflictResolver,
): Promise<MergeResult> {
  const sprintBranch = `sprint/${sprintId}`;
  const suffix = friendlyName ? friendlyName.toLowerCase() : developerId;
  const devBranch = `sprint/${sprintId}--${suffix}`;

  // NOTE: Caller (mergeWaveAndReset) handles stashing. Do not stash here
  // to avoid double-stash issues that can leave orphaned staged changes.

  // Ensure we're on the sprint branch
  await git(['checkout', sprintBranch], targetDir);

  try {
    await git(['merge', devBranch, '--no-edit'], targetDir);
    log.info(`Merged ${devBranch} into ${sprintBranch}`);
    return { success: true };
  } catch (err) {
    // Check git state for conflicts instead of parsing error strings
    // (git writes conflict messages to stdout, not stderr/message)
    const conflicts = await getConflictFiles(targetDir);
    if (conflicts.length > 0) {
      log.warn(`Merge conflicts detected`, { devBranch, conflicts });

      if (conflictResolver) {
        try {
          await conflictResolver(targetDir, conflicts);

          const remaining = await getConflictFiles(targetDir);
          if (remaining.length === 0) {
            await git(['commit', '--no-edit'], targetDir);
            log.info(`Merge conflicts resolved by agent`, { devBranch, conflicts });
            return { success: true, conflicts, resolved: true };
          }

          log.warn(`Agent left unresolved conflicts`, { devBranch, remaining });
        } catch (resolveErr) {
          log.error(`Conflict resolver failed`, { devBranch, error: String(resolveErr) });
        }
      }

      // Resolver not provided, failed, or left conflicts — abort
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
  _targetDir: string,
  worktreePath: string,
  sprintId: string,
  developerId: string,
  friendlyName?: string,
): Promise<void> {
  const sprintBranch = `sprint/${sprintId}`;
  const suffix = friendlyName ? friendlyName.toLowerCase() : developerId;
  const devBranch = `sprint/${sprintId}--${suffix}`;

  // Reset the worktree (on the developer branch) to match the sprint branch head.
  // This moves the developer branch pointer + working tree to the sprint branch commit.
  // No checkout needed — the worktree stays on its developer branch.
  await git(['reset', '--hard', sprintBranch], worktreePath);
  log.info(`Reset worktree to sprint head`, { worktreePath, devBranch });
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

// --- Remote ---

export async function hasRemote(cwd: string, remote = 'origin'): Promise<boolean> {
  try {
    await git(['remote', 'get-url', remote], cwd, true);
    return true;
  } catch {
    return false;
  }
}

// --- Push ---

export async function pushBranch(cwd: string, branch: string): Promise<void> {
  await git(['push', '-u', 'origin', branch], cwd);
  log.info(`Pushed branch: ${branch}`);
}

// --- Local Merge ---

export async function mergeSprintToMain(cwd: string, sprintId: string): Promise<void> {
  const sprintBranch = `sprint/${sprintId}`;

  // Stash any uncommitted changes (sprint status/cost files) before switching branches
  const status = await git(['status', '--porcelain'], cwd);
  const needsStash = status.trim().length > 0;
  if (needsStash) {
    await git(['stash', 'push', '-m', `pre-merge-${sprintId}`], cwd);
  }

  try {
    await git(['checkout', 'main'], cwd);
    await git(['merge', sprintBranch, '--no-edit'], cwd);
    log.info(`Merged ${sprintBranch} into main`);
  } finally {
    // Restore stashed changes
    if (needsStash) {
      await git(['stash', 'pop'], cwd).catch(() => {
        log.warn('Failed to pop stash after merge — may need manual resolution');
      });
    }
  }
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
 * 2. Create a worktree for each developer
 * Returns map of developerId → worktreePath
 */
export async function setupSprintGit(
  targetDir: string,
  sprintId: string,
  developers: { id: string; name: string }[],
): Promise<Map<string, string>> {
  // Create the sprint branch
  const sprintBranch = `sprint/${sprintId}`;
  try {
    await git(['checkout', '-b', sprintBranch], targetDir);
    log.info(`Created sprint branch: ${sprintBranch}`);
  } catch {
    // Branch may already exist (restart scenario) — stash dirty state files first
    const status = await git(['status', '--porcelain'], targetDir);
    const dirty = status.trim().length > 0;
    if (dirty) {
      await git(['stash', 'push', '-m', `setup-${sprintId}`], targetDir);
    }
    await git(['checkout', sprintBranch], targetDir);
    if (dirty) {
      await git(['stash', 'pop'], targetDir).catch(() => {
        log.warn('Stash pop conflict during setup — dropping stash');
        git(['stash', 'drop'], targetDir).catch(() => {});
      });
    }
    log.info(`Checked out existing sprint branch: ${sprintBranch}`);
  }

  // Create worktrees for each developer
  const worktreePaths = new Map<string, string>();
  for (const dev of developers) {
    const wtPath = await createWorktree(targetDir, sprintId, dev.id, dev.name);
    worktreePaths.set(dev.id, wtPath);
  }

  return worktreePaths;
}

/**
 * After a wave completes, merge each developer's branch back to the sprint branch,
 * then reset worktrees for the next wave.
 */
export async function mergeWaveAndReset(
  targetDir: string,
  sprintId: string,
  developers: { id: string; name: string }[],
  conflictResolver?: ConflictResolver,
): Promise<MergeResult[]> {
  const results: MergeResult[] = [];

  // Recover from any pre-existing failed merge state
  const preConflicts = await getConflictFiles(targetDir);
  if (preConflicts.length > 0) {
    log.warn('Found pre-existing merge conflict state, aborting before proceeding');
    await git(['merge', '--abort'], targetDir).catch(() => {});
  }

  // Stash any uncommitted changes (e.g. .completed state file) before switching branches
  const sprintBranch = `sprint/${sprintId}`;
  const stashOutput = await git(['stash', 'push', '-m', `wave-merge-${sprintId}`], targetDir);
  const didStash = !stashOutput.includes('No local changes');

  await git(['checkout', sprintBranch], targetDir);

  // Restore stashed changes so state files remain up-to-date
  if (didStash) {
    await git(['stash', 'pop'], targetDir).catch(() => {
      // If pop conflicts, prefer our stashed version for state files
      log.warn('Stash pop conflict during wave merge — dropping stash');
      git(['checkout', '--theirs', '.'], targetDir).catch(() => {});
      git(['stash', 'drop'], targetDir).catch(() => {});
    });
  }

  // Merge each developer's branch
  for (const dev of developers) {
    const result = await mergeDeveloperBranch(targetDir, sprintId, dev.id, dev.name, conflictResolver);
    results.push(result);
    if (!result.success) {
      log.warn(`Merge conflict from ${dev.name}`, { conflicts: result.conflicts });
    }
  }

  // Safety net: commit any orphaned staged changes left by partial conflict resolution
  try {
    await git(['diff', '--cached', '--quiet'], targetDir, true);
  } catch {
    // Has staged changes — commit them so they don't block subsequent operations
    log.warn('Found orphaned staged changes after merge — committing');
    await git(['commit', '-m', `merge: finalize wave merge for ${sprintId}`], targetDir);
  }

  // Reset worktrees for the next wave
  for (const dev of developers) {
    const suffix = dev.name.toLowerCase();
    const worktreePath = path.resolve(targetDir, '..', `${path.basename(targetDir)}-worktree-${suffix}`);
    if (fs.existsSync(worktreePath)) {
      await resetWorktreeToSprint(targetDir, worktreePath, sprintId, dev.id, dev.name);
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
  developers: { id: string; name: string }[],
  conflictResolver?: ConflictResolver,
): Promise<void> {
  // Final merge
  await mergeWaveAndReset(targetDir, sprintId, developers, conflictResolver);

  // Clean up worktrees
  const developerIds = developers.map((i) => i.id);
  const nameMap = new Map(developers.map((i) => [i.id, i.name]));
  await cleanupWorktrees(targetDir, sprintId, developerIds, nameMap);

  // Stay on sprint branch for testing/review
  const sprintBranch = `sprint/${sprintId}`;
  await git(['checkout', sprintBranch], targetDir);
  log.info(`Sprint ${sprintId} finalized on branch ${sprintBranch}`);
}
