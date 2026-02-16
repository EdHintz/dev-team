// App management routes

import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { SPECS_DIR, generateSprintId } from '../config.js';
import { listApps, getApp, createApp, deleteApp, reorderApps, getAppSprintsDir, getAppSpecsDir } from '../services/app-service.js';
import { listSprints, initSprint, setSprintStatus } from '../services/state-service.js';
import { broadcast } from '../websocket/ws-server.js';
import type { AppWithSprints } from '../../shared/types.js';

export const appRoutes = Router();

// List all apps with their matched sprints
appRoutes.get('/', (_req, res) => {
  try {
    const apps = listApps();
    const sprints = listSprints();

    const result: AppWithSprints[] = apps.map((app) => ({
      ...app,
      sprints: sprints.filter(
        (s) => s.targetDir && s.targetDir.startsWith(app.rootFolder),
      ),
    }));

    res.json(result);
  } catch (err) {
    console.error('Failed to list apps:', err);
    res.status(500).json({ error: 'Failed to list apps' });
  }
});

// Create an app (without a sprint)
appRoutes.post('/', (req, res) => {
  const { name, rootFolder } = req.body;

  if (!name || !rootFolder) {
    res.status(400).json({ error: 'name and rootFolder are required' });
    return;
  }

  if (!path.isAbsolute(rootFolder)) {
    res.status(400).json({ error: `Root folder must be an absolute path. Got: "${rootFolder}"` });
    return;
  }

  try {
    const app = createApp(name, rootFolder);
    res.status(201).json(app);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create app';
    res.status(400).json({ error: message });
  }
});

// Reorder apps
appRoutes.put('/reorder', (req, res) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) {
    res.status(400).json({ error: 'orderedIds array is required' });
    return;
  }
  try {
    reorderApps(orderedIds);
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to reorder';
    res.status(500).json({ error: message });
  }
});

// Remove an app reference (does not delete the directory)
appRoutes.delete('/:id', (req, res) => {
  const { id } = req.params;
  const deleted = deleteApp(id);
  if (!deleted) {
    res.status(404).json({ error: 'App not found' });
    return;
  }
  res.json({ ok: true });
});

// Create an app + first sprint, then auto-start planning
appRoutes.post('/with-sprint', async (req, res) => {
  const { name, rootFolder, specPath, developerCount = 2, autonomyMode, sprintName } = req.body;

  if (!name || !rootFolder || !specPath) {
    res.status(400).json({ error: 'name, rootFolder, and specPath are required' });
    return;
  }

  // Validate rootFolder is an absolute path
  if (!path.isAbsolute(rootFolder)) {
    res.status(400).json({ error: `Root folder must be an absolute path. Got: "${rootFolder}"` });
    return;
  }

  // Resolve spec path — check app-local specs first, then global
  let resolvedSpec: string;
  if (path.isAbsolute(specPath)) {
    resolvedSpec = specPath;
  } else {
    const appSpecPath = path.join(getAppSpecsDir(rootFolder), specPath);
    resolvedSpec = fs.existsSync(appSpecPath) ? appSpecPath : path.join(SPECS_DIR, specPath);
  }
  if (!fs.existsSync(resolvedSpec)) {
    res.status(400).json({ error: `Spec file not found: ${resolvedSpec}` });
    return;
  }

  // Create target directory if it doesn't exist
  try {
    if (!fs.existsSync(rootFolder)) {
      fs.mkdirSync(rootFolder, { recursive: true });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: `Cannot create root folder "${rootFolder}": ${message}` });
    return;
  }

  // Create or get existing app
  let app = getApp(name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  if (!app) {
    try {
      app = createApp(name, rootFolder);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create app';
      res.status(400).json({ error: message });
      return;
    }
  }

  // Create sprint under app's rootFolder
  const sprintId = generateSprintId();
  const sprintDir = path.join(getAppSprintsDir(rootFolder), sprintId);
  try {
    fs.mkdirSync(path.join(sprintDir, 'logs'), { recursive: true });
    fs.copyFileSync(resolvedSpec, path.join(sprintDir, 'spec.md'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: `Failed to set up sprint directory at "${sprintDir}": ${message}` });
    return;
  }

  const sprint = initSprint(sprintId, resolvedSpec, rootFolder, developerCount, sprintDir, autonomyMode, sprintName);
  broadcast({ type: 'sprint:status', sprintId, status: sprint.status });

  // Auto-start planning
  try {
    const { enqueuePlanningPipeline } = await import('../queues/queue-manager.js');
    await enqueuePlanningPipeline(sprintId, resolvedSpec, rootFolder, developerCount);

    setSprintStatus(sprintId, 'researching');
    broadcast({ type: 'sprint:status', sprintId, status: 'researching' });

    res.status(201).json({
      app,
      sprint: { id: sprintId, status: 'researching' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to start planning';
    res.status(500).json({ error: message });
  }
});
