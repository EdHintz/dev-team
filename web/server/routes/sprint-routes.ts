// Sprint CRUD and approval routes

import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { SPECS_DIR, generateSprintId } from '../config.js';
import {
  initSprint,
  listSprints,
  getSprint,
  getSprintDetail,
  setSprintStatus,
  setSprintApprovedAt,
  getSprintDir,
} from '../services/state-service.js';
import { getAppSprintsDir, getAppSpecsDir } from '../services/app-service.js';
import { broadcast } from '../websocket/ws-server.js';
import type { CreateSprintRequest } from '../../shared/types.js';

export const sprintRoutes = Router();

// List all sprints
sprintRoutes.get('/', (_req, res) => {
  try {
    const sprints = listSprints();
    res.json(sprints);
  } catch (err) {
    console.error('Failed to list sprints:', err);
    res.status(500).json({ error: 'Failed to list sprints' });
  }
});

// Get sprint detail
sprintRoutes.get('/:id', (req, res) => {
  const { id } = req.params;
  try {
    const detail = getSprintDetail(id);
    res.json(detail);
  } catch {
    res.status(404).json({ error: `Sprint not found: ${id}` });
  }
});

// Create a new sprint
sprintRoutes.post('/', (req, res) => {
  const { specPath, targetDir, developerCount, sprintId: requestedId, name, autonomyMode } = req.body as CreateSprintRequest;

  // Validate spec file exists — check app-local specs first, then global
  let resolvedSpec: string;
  if (path.isAbsolute(specPath)) {
    resolvedSpec = specPath;
  } else {
    const appSpecPath = path.join(getAppSpecsDir(targetDir), specPath);
    resolvedSpec = fs.existsSync(appSpecPath) ? appSpecPath : path.join(SPECS_DIR, specPath);
  }
  if (!fs.existsSync(resolvedSpec)) {
    res.status(400).json({ error: `Spec file not found: ${resolvedSpec}` });
    return;
  }

  // Create target directory if it doesn't exist
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const sprintId = requestedId || generateSprintId();

  // Place sprint directory under the app's rootFolder
  const sprintDir = path.join(getAppSprintsDir(targetDir), sprintId);
  fs.mkdirSync(path.join(sprintDir, 'logs'), { recursive: true });
  fs.copyFileSync(resolvedSpec, path.join(sprintDir, 'spec.md'));

  // Initialize sprint state
  const sprint = initSprint(sprintId, resolvedSpec, targetDir, developerCount, sprintDir, autonomyMode, name);

  broadcast({ type: 'sprint:status', sprintId, status: sprint.status });

  res.status(201).json({
    id: sprintId,
    status: sprint.status,
    message: `Sprint created. POST /api/sprints/${sprintId}/start to begin planning.`,
  });
});

// Start planning for a sprint (triggers research + planning pipeline)
sprintRoutes.post('/:id/start', async (req, res) => {
  const { id } = req.params;
  const sprint = getSprint(id);
  if (!sprint) {
    res.status(404).json({ error: `Sprint not found: ${id}` });
    return;
  }

  if (sprint.status !== 'created') {
    res.status(400).json({ error: `Sprint is already in status: ${sprint.status}` });
    return;
  }

  // Import the queue manager dynamically to avoid circular deps
  const { enqueuePlanningPipeline } = await import('../queues/queue-manager.js');
  await enqueuePlanningPipeline(id, sprint.specPath, sprint.targetDir, sprint.developers.length);

  setSprintStatus(id, 'researching');
  broadcast({ type: 'sprint:status', sprintId: id, status: 'researching' });

  res.json({ id, status: 'researching', message: 'Planning pipeline started.' });
});

// Approve a sprint plan (triggers implementation)
sprintRoutes.post('/:id/approve', async (req, res) => {
  const { id } = req.params;
  const sprint = getSprint(id);
  if (!sprint) {
    res.status(404).json({ error: `Sprint not found: ${id}` });
    return;
  }

  if (sprint.status !== 'awaiting-approval') {
    res.status(400).json({ error: `Sprint is in status '${sprint.status}', expected 'awaiting-approval'` });
    return;
  }

  setSprintStatus(id, 'approved');
  setSprintApprovedAt(id);
  broadcast({ type: 'sprint:status', sprintId: id, status: 'approved' });

  // Resolve the pending approval if one exists
  const { resolvePendingApproval } = await import('../services/state-service.js');
  resolvePendingApproval(id, `${id}:plan-approval`, true);

  try {
    const { startImplementation } = await import('../services/sprint-lifecycle.js');
    await startImplementation(id);
    res.json({ id, status: 'running', message: 'Implementation started.' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error during approval';
    console.error(`Sprint ${id} approval failed:`, message);

    // Revert to awaiting-approval so user can retry
    setSprintStatus(id, 'awaiting-approval');
    broadcast({ type: 'sprint:status', sprintId: id, status: 'awaiting-approval' });
    broadcast({ type: 'error', sprintId: id, message: `Approval failed: ${message}` });

    res.status(500).json({ error: `Failed to start implementation: ${message}` });
  }
});

// Restart a failed/cancelled sprint
sprintRoutes.post('/:id/restart', async (req, res) => {
  const { id } = req.params;
  const { targetDir } = req.body || {};

  // Try in-memory first, then load from disk
  let sprint = getSprint(id);
  if (!sprint) {
    const { loadSprintFromDisk } = await import('../services/state-service.js');
    sprint = loadSprintFromDisk(id, targetDir) ?? undefined;
  }

  if (!sprint) {
    res.status(404).json({ error: `Sprint not found: ${id}` });
    return;
  }

  const restartableStatuses = new Set(['failed', 'cancelled', 'running', 'paused', 'reviewing']);
  if (!restartableStatuses.has(sprint.status)) {
    res.status(400).json({ error: `Sprint is in status '${sprint.status}', cannot restart` });
    return;
  }

  // If in reviewing state, re-trigger the review/fix flow
  if (sprint.status === 'reviewing') {
    const sprintDir = getSprintDir(id);
    // Find the latest review file to determine cycle
    const reviewFiles = fs.readdirSync(sprintDir)
      .filter((f) => /^review-\d+\.md$/.test(f))
      .sort((a, b) => {
        const numA = parseInt(a.match(/review-(\d+)/)?.[1] || '0', 10);
        const numB = parseInt(b.match(/review-(\d+)/)?.[1] || '0', 10);
        return numA - numB;
      });
    const lastCycle = reviewFiles.length > 0
      ? parseInt(reviewFiles[reviewFiles.length - 1].match(/review-(\d+)/)?.[1] || '0', 10)
      : 0;

    if (lastCycle > 0) {
      // Review already ran — enqueue fix cycle for the findings
      const reviewContent = fs.readFileSync(path.join(sprintDir, `review-${lastCycle}.md`), 'utf-8');
      const { enqueueFixCycle } = await import('../queues/queue-manager.js');
      await enqueueFixCycle(id, lastCycle, reviewContent);
      res.json({ id, status: 'reviewing', message: `Fix cycle enqueued for review cycle ${lastCycle}.` });
    } else {
      // No review yet — re-enqueue review cycle 1
      const { enqueueReview } = await import('../queues/queue-manager.js');
      await enqueueReview(id, 1);
      res.json({ id, status: 'reviewing', message: 'Review cycle 1 re-enqueued.' });
    }
    return;
  }

  // Determine where the sprint failed and resume from there
  const sprintDir = getSprintDir(id);
  const hasResearch = fs.existsSync(path.join(sprintDir, 'research.md'));
  const hasPlan = sprint.plan !== null;

  if (!hasPlan) {
    // Sprint failed before or during planning — re-trigger the pipeline
    if (!sprint.targetDir && !targetDir) {
      res.status(400).json({ error: 'targetDir is required to restart a sprint that has no plan (failed during research/planning)' });
      return;
    }
    const resolvedTargetDir = sprint.targetDir || targetDir;
    const specFile = path.join(sprintDir, 'spec.md');
    const resolvedSpec = sprint.specPath || specFile;

    if (!hasResearch) {
      // No research yet — restart from the beginning
      const { enqueuePlanningPipeline } = await import('../queues/queue-manager.js');
      await enqueuePlanningPipeline(id, resolvedSpec, resolvedTargetDir, sprint.developers.length, true);
      setSprintStatus(id, 'researching');
      broadcast({ type: 'sprint:status', sprintId: id, status: 'researching' });
      res.json({ id, status: 'researching', message: 'Sprint restarted from research phase.' });
    } else {
      // Research exists — skip to planning
      const { enqueuePlanning } = await import('../queues/queue-manager.js');
      await enqueuePlanning(id, resolvedSpec, resolvedTargetDir, sprint.developers.length, true);
      setSprintStatus(id, 'planning');
      broadcast({ type: 'sprint:status', sprintId: id, status: 'planning' });
      res.json({ id, status: 'planning', message: 'Sprint restarted from planning phase (research already complete).' });
    }
    return;
  }

  // Sprint has a plan — find all non-completed tasks and enqueue them
  const { resetSprintForRestart, setWorktreePath } = await import('../services/state-service.js');
  resetSprintForRestart(id);

  // Ensure git branch and worktrees are set up
  const { setupSprintGit } = await import('../services/git-service.js');
  const developers = sprint.developers.map((dev) => ({ id: dev.id, name: dev.name }));
  const worktreePaths = await setupSprintGit(sprint.targetDir, id, developers);
  for (const [implId, wtPath] of worktreePaths) {
    setWorktreePath(id, implId, wtPath);
  }

  // Collect all non-completed task IDs
  const nonCompletedTaskIds = Array.from(sprint.tasks.values())
    .filter((t) => t.status !== 'completed')
    .map((t) => t.taskId);

  if (nonCompletedTaskIds.length > 0) {
    const { restartSprint: restartSprintQueue } = await import('../queues/queue-manager.js');
    await restartSprintQueue(id, nonCompletedTaskIds);
  }

  setSprintStatus(id, 'running');
  broadcast({ type: 'sprint:status', sprintId: id, status: 'running' });

  res.json({ id, status: 'running', message: `Sprint restarted with ${nonCompletedTaskIds.length} tasks enqueued.` });
});

// Pause a running sprint (current tasks finish, no new tasks start)
sprintRoutes.post('/:id/pause', (_req, res) => {
  const { id } = _req.params;
  const sprint = getSprint(id);
  if (!sprint) {
    res.status(404).json({ error: `Sprint not found: ${id}` });
    return;
  }

  if (sprint.status !== 'running' && sprint.status !== 'researching' && sprint.status !== 'planning') {
    res.status(400).json({ error: `Cannot pause sprint in status '${sprint.status}'` });
    return;
  }

  setSprintStatus(id, 'paused');
  broadcast({ type: 'sprint:status', sprintId: id, status: 'paused' });

  res.json({ id, status: 'paused', message: 'Sprint paused. In-progress tasks will finish but no new tasks will start.' });
});

// Resume a paused sprint
sprintRoutes.post('/:id/resume', async (req, res) => {
  const { id } = req.params;
  const sprint = getSprint(id);
  if (!sprint) {
    res.status(404).json({ error: `Sprint not found: ${id}` });
    return;
  }

  if (sprint.status !== 'paused') {
    res.status(400).json({ error: `Sprint is in status '${sprint.status}', expected 'paused'` });
    return;
  }

  // Re-enqueue any queued tasks that were waiting when paused
  const pendingTasks = Array.from(sprint.tasks.values()).filter((t) => t.status === 'queued' || t.status === 'pending');
  const pendingTaskIds = pendingTasks.filter((t) => t.status === 'queued').map((t) => t.taskId);

  setSprintStatus(id, 'running');
  broadcast({ type: 'sprint:status', sprintId: id, status: 'running' });

  if (pendingTaskIds.length > 0) {
    const { restartSprint: restartSprintQueue } = await import('../queues/queue-manager.js');
    await restartSprintQueue(id, pendingTaskIds);
  }

  res.json({ id, status: 'running', message: `Sprint resumed with ${pendingTaskIds.length} tasks re-enqueued.` });
});

// Force-advance a sprint to reviewing (skip remaining implementation)
sprintRoutes.post('/:id/advance', async (req, res) => {
  const { id } = req.params;
  const sprint = getSprint(id);
  if (!sprint) {
    res.status(404).json({ error: `Sprint not found: ${id}` });
    return;
  }

  // Clean up worktrees
  try {
    const { finalizeImplementation } = await import('../services/git-service.js');
    const developers = sprint.developers.map((dev) => ({ id: dev.id, name: dev.name }));
    await finalizeImplementation(sprint.targetDir, id, developers);
  } catch (err) {
    // Worktrees may already be cleaned up
  }

  setSprintStatus(id, 'reviewing');
  broadcast({ type: 'sprint:status', sprintId: id, status: 'reviewing' });

  const { enqueueTesting } = await import('../queues/queue-manager.js');
  await enqueueTesting(id);

  res.json({ id, status: 'reviewing', message: 'Sprint advanced to review phase.' });
});

// Mark a sprint as completed (e.g. after PR is merged on GitHub)
sprintRoutes.post('/:id/complete', (_req, res) => {
  const { id } = _req.params;
  const sprint = getSprint(id);
  if (!sprint) {
    res.status(404).json({ error: `Sprint not found: ${id}` });
    return;
  }

  if (sprint.status !== 'pr-created') {
    res.status(400).json({ error: `Sprint is in status '${sprint.status}', expected 'pr-created'` });
    return;
  }

  setSprintStatus(id, 'completed');
  broadcast({ type: 'sprint:status', sprintId: id, status: 'completed' });

  res.json({ id, status: 'completed' });
});

// Merge sprint branch into local main and mark complete
sprintRoutes.post('/:id/merge-local', async (req, res) => {
  const { id } = req.params;
  const sprint = getSprint(id);
  if (!sprint) {
    res.status(404).json({ error: `Sprint not found: ${id}` });
    return;
  }

  if (sprint.status !== 'pr-created') {
    res.status(400).json({ error: `Sprint is in status '${sprint.status}', expected 'pr-created'` });
    return;
  }

  try {
    const { mergeSprintToMain } = await import('../services/git-service.js');
    await mergeSprintToMain(sprint.targetDir, id);

    setSprintStatus(id, 'completed');
    broadcast({ type: 'sprint:status', sprintId: id, status: 'completed' });

    res.json({ id, status: 'completed', message: 'Sprint branch merged into local main.' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Merge failed';
    res.status(500).json({ error: `Local merge failed: ${message}` });
  }
});

// Cancel a sprint
sprintRoutes.post('/:id/cancel', (_req, res) => {
  const { id } = _req.params;
  const sprint = getSprint(id);
  if (!sprint) {
    res.status(404).json({ error: `Sprint not found: ${id}` });
    return;
  }

  setSprintStatus(id, 'cancelled');
  broadcast({ type: 'sprint:status', sprintId: id, status: 'cancelled' });

  res.json({ id, status: 'cancelled' });
});

// Get sprint spec file
sprintRoutes.get('/:id/spec', (req, res) => {
  const { id } = req.params;
  const specFile = path.join(getSprintDir(id), 'spec.md');
  if (!fs.existsSync(specFile)) {
    res.status(404).json({ error: 'Spec not found' });
    return;
  }
  res.type('text/markdown').send(fs.readFileSync(specFile, 'utf-8'));
});

sprintRoutes.get('/:id/logs', (req, res) => {
  const { id } = req.params;
  const logDir = path.join(getSprintDir(id), 'logs');
  if (!fs.existsSync(logDir)) {
    res.json([]);
    return;
  }

  const logs = fs.readdirSync(logDir)
    .filter((f) => f.endsWith('.log'))
    .map((f) => ({
      name: f,
      path: path.join(logDir, f),
      size: fs.statSync(path.join(logDir, f)).size,
      modified: fs.statSync(path.join(logDir, f)).mtime.toISOString(),
    }));

  res.json(logs);
});
