// System routes: health, config, Redis status, filesystem browsing

import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { checkRedisConnection } from '../utils/redis.js';
import {
  AUTONOMY_MODE,
  BUDGETS,
  MODELS,
  DEFAULT_DEVELOPER_COUNT,
  DEVELOPER_POOL,
  WEB_PORT,
  SPECS_DIR,
} from '../config.js';

export const systemRoutes = Router();

systemRoutes.get('/health', async (_req, res) => {
  const redis = await checkRedisConnection();
  res.json({
    status: redis.connected ? 'ok' : 'degraded',
    redis,
    uptime: process.uptime(),
  });
});

systemRoutes.get('/config', (_req, res) => {
  res.json({
    autonomyMode: AUTONOMY_MODE,
    budgets: BUDGETS,
    models: MODELS,
    defaultDeveloperCount: DEFAULT_DEVELOPER_COUNT,
    developerPool: DEVELOPER_POOL,
    webPort: WEB_PORT,
  });
});

systemRoutes.get('/redis', async (_req, res) => {
  const result = await checkRedisConnection();
  res.json(result);
});

// Browse filesystem for file/directory picker
systemRoutes.get('/browse', (req, res) => {
  const dir = (req.query.dir as string) || SPECS_DIR;
  const filter = req.query.filter as string | undefined; // e.g. ".md"

  const resolved = dir.startsWith('~')
    ? path.join(os.homedir(), dir.slice(1))
    : path.resolve(dir);

  if (!fs.existsSync(resolved)) {
    res.status(404).json({ error: `Directory not found: ${resolved}` });
    return;
  }

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    res.status(400).json({ error: `Not a directory: ${resolved}` });
    return;
  }

  try {
    const entries = fs.readdirSync(resolved, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.'))
      .map((e) => ({
        name: e.name,
        path: path.join(resolved, e.name),
        isDirectory: e.isDirectory(),
      }))
      .filter((e) => e.isDirectory || !filter || e.name.endsWith(filter))
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    res.json({
      current: resolved,
      parent: path.dirname(resolved),
      entries,
    });
  } catch {
    res.status(500).json({ error: `Cannot read directory: ${resolved}` });
  }
});
