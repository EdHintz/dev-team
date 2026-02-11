// Sprint CRUD and approval routes

import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { SPRINTS_DIR, SPECS_DIR, generateSprintId } from '../config.js';
import {
  initSprint,
  listSprints,
  getSprint,
  getSprintDetail,
  setSprintStatus,
} from '../services/state-service.js';
import { broadcast } from '../websocket/ws-server.js';
import type { CreateSprintRequest } from '../../shared/types.js';

export const sprintRoutes = Router();

// List all sprints
sprintRoutes.get('/', (_req, res) => {
  const sprints = listSprints();
  res.json(sprints);
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
  const { specPath, targetDir, implementerCount, sprintId: requestedId } = req.body as CreateSprintRequest;

  // Validate spec file exists
  const resolvedSpec = path.isAbsolute(specPath) ? specPath : path.join(SPECS_DIR, specPath);
  if (!fs.existsSync(resolvedSpec)) {
    res.status(400).json({ error: `Spec file not found: ${resolvedSpec}` });
    return;
  }

  // Validate target directory exists
  if (!fs.existsSync(targetDir)) {
    res.status(400).json({ error: `Target directory not found: ${targetDir}` });
    return;
  }

  const sprintId = requestedId || generateSprintId();

  // Copy spec to sprint directory
  const sprintDir = path.join(SPRINTS_DIR, sprintId);
  fs.mkdirSync(path.join(sprintDir, 'logs'), { recursive: true });
  fs.copyFileSync(resolvedSpec, path.join(sprintDir, 'spec.md'));

  // Initialize sprint state
  const sprint = initSprint(sprintId, resolvedSpec, targetDir, implementerCount);

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
  await enqueuePlanningPipeline(id, sprint.specPath, sprint.targetDir, sprint.implementers.length);

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
  broadcast({ type: 'sprint:status', sprintId: id, status: 'approved' });

  // Resolve the pending approval if one exists
  const { resolvePendingApproval, setWorktreePath } = await import('../services/state-service.js');
  resolvePendingApproval(id, `${id}:plan-approval`, true);

  // Set up git branch and worktrees
  const { setupSprintGit } = await import('../services/git-service.js');
  const implementerIds = sprint.implementers.map((impl) => impl.id);
  const worktreePaths = await setupSprintGit(sprint.targetDir, id, implementerIds);
  for (const [implId, wtPath] of worktreePaths) {
    setWorktreePath(id, implId, wtPath);
  }

  // Enqueue implementation tasks
  const { enqueueImplementation } = await import('../queues/queue-manager.js');
  await enqueueImplementation(id);

  setSprintStatus(id, 'running');
  broadcast({ type: 'sprint:status', sprintId: id, status: 'running' });

  res.json({ id, status: 'running', message: 'Implementation started.' });
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
    const sprintDir = path.join(SPRINTS_DIR, id);
    // Find the latest review file to determine cycle
    const reviewFiles = fs.readdirSync(sprintDir).filter((f) => f.match(/^review-\d+\.md$/)).sort();
    const lastCycle = reviewFiles.length > 0
      ? parseInt(reviewFiles[reviewFiles.length - 1].match(/review-(\d+)\.md/)![1], 10)
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
  const sprintDir = path.join(SPRINTS_DIR, id);
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
      await enqueuePlanningPipeline(id, resolvedSpec, resolvedTargetDir, sprint.implementers.length, true);
      setSprintStatus(id, 'researching');
      broadcast({ type: 'sprint:status', sprintId: id, status: 'researching' });
      res.json({ id, status: 'researching', message: 'Sprint restarted from research phase.' });
    } else {
      // Research exists — skip to planning
      const { enqueuePlanning } = await import('../queues/queue-manager.js');
      await enqueuePlanning(id, resolvedSpec, resolvedTargetDir, sprint.implementers.length, true);
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
  const implementerIds = sprint.implementers.map((impl) => impl.id);
  const worktreePaths = await setupSprintGit(sprint.targetDir, id, implementerIds);
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

// Get sprint logs
sprintRoutes.get('/:id/logs', (req, res) => {
  const { id } = req.params;
  const logDir = path.join(SPRINTS_DIR, id, 'logs');
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
