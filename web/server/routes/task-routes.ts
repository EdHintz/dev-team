// Task status and log routes

import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { SPRINTS_DIR } from '../config.js';
import { getSprint } from '../services/state-service.js';

export const taskRoutes = Router();

// Get all tasks for a sprint
taskRoutes.get('/:sprintId', (req, res) => {
  const { sprintId } = req.params;
  const sprint = getSprint(sprintId);

  if (!sprint) {
    // Try to read from disk
    const planFile = path.join(SPRINTS_DIR, sprintId, 'plan.json');
    if (fs.existsSync(planFile)) {
      const plan = JSON.parse(fs.readFileSync(planFile, 'utf-8'));
      res.json(plan.tasks);
      return;
    }
    res.status(404).json({ error: `Sprint not found: ${sprintId}` });
    return;
  }

  const tasks = Array.from(sprint.tasks.values());
  res.json(tasks);
});

// Get a specific task
taskRoutes.get('/:sprintId/:taskId', (req, res) => {
  const { sprintId, taskId } = req.params;
  const sprint = getSprint(sprintId);

  if (!sprint) {
    res.status(404).json({ error: `Sprint not found: ${sprintId}` });
    return;
  }

  const task = sprint.tasks.get(Number(taskId));
  if (!task) {
    res.status(404).json({ error: `Task not found: ${taskId}` });
    return;
  }

  // Include plan details
  const planTask = sprint.plan?.tasks.find((t) => t.id === Number(taskId));

  res.json({ ...task, plan: planTask });
});

// Retry a failed task
taskRoutes.post('/:sprintId/:taskId/retry', async (req, res) => {
  const { sprintId, taskId: taskIdStr } = req.params;
  const taskId = Number(taskIdStr);
  const sprint = getSprint(sprintId);

  if (!sprint) {
    res.status(404).json({ error: `Sprint not found: ${sprintId}` });
    return;
  }

  const task = sprint.tasks.get(taskId);
  if (!task) {
    res.status(404).json({ error: `Task not found: ${taskId}` });
    return;
  }

  if (task.status !== 'failed') {
    res.status(400).json({ error: `Task is in status '${task.status}', expected 'failed'` });
    return;
  }

  const { resetTaskStatus } = await import('../services/state-service.js');
  resetTaskStatus(sprintId, taskId);

  const { reEnqueueTask } = await import('../queues/queue-manager.js');
  await reEnqueueTask(sprintId, taskId);

  const { broadcast } = await import('../websocket/ws-server.js');
  broadcast({ type: 'task:status', sprintId, taskId, status: 'queued' });

  res.json({ sprintId, taskId, status: 'queued', message: 'Task re-enqueued for retry.' });
});

// Get task log file content
taskRoutes.get('/:sprintId/:taskId/log', (req, res) => {
  const { sprintId, taskId } = req.params;
  const logDir = path.join(SPRINTS_DIR, sprintId, 'logs');

  if (!fs.existsSync(logDir)) {
    res.status(404).json({ error: 'No logs found' });
    return;
  }

  // Find log files matching this task
  const logFiles = fs.readdirSync(logDir)
    .filter((f) => f.includes(`-${taskId}-`) && f.endsWith('.log'))
    .sort()
    .reverse();

  if (logFiles.length === 0) {
    res.status(404).json({ error: `No log found for task ${taskId}` });
    return;
  }

  // Return the most recent log
  const logContent = fs.readFileSync(path.join(logDir, logFiles[0]), 'utf-8');
  res.type('text/plain').send(logContent);
});
