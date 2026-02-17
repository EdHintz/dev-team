// Shared sprint lifecycle transitions — used by both REST routes and workers

import { setSprintStatus, setWorktreePath, getSprintOrThrow } from './state-service.js';
import { initRepoIfNeeded, setupSprintGit } from './git-service.js';
import { enqueueImplementation } from '../queues/queue-manager.js';
import { broadcast } from '../websocket/ws-server.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('sprint-lifecycle');

/**
 * Transition a sprint from approved → running.
 * Sets up git worktrees and enqueues implementation tasks.
 * Extracted from sprint-routes.ts approve endpoint so it can be called
 * from both the REST route (manual approval) and the planning worker (auto-approve).
 */
export async function startImplementation(sprintId: string): Promise<void> {
  const sprint = getSprintOrThrow(sprintId);

  log.info(`Starting implementation for ${sprintId}`);

  // Ensure target directory is a git repo
  await initRepoIfNeeded(sprint.targetDir);

  // Set up git branch and worktrees
  const developers = sprint.developers.map((dev) => ({ id: dev.id, name: dev.name }));
  const worktreePaths = await setupSprintGit(sprint.targetDir, sprintId, developers);
  for (const [devId, wtPath] of worktreePaths) {
    setWorktreePath(sprintId, devId, wtPath);
  }

  // Enqueue implementation tasks
  await enqueueImplementation(sprintId);

  setSprintStatus(sprintId, 'running');
  broadcast({ type: 'sprint:status', sprintId, status: 'running' });

  log.info(`Implementation started for ${sprintId}`);
}
