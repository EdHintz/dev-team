// System routes: health, config, Redis status

import { Router } from 'express';
import { checkRedisConnection } from '../utils/redis.js';
import {
  AUTONOMY_MODE,
  BUDGETS,
  MODELS,
  DEFAULT_IMPLEMENTER_COUNT,
  IMPLEMENTER_POOL,
  WEB_PORT,
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
    defaultImplementerCount: DEFAULT_IMPLEMENTER_COUNT,
    implementerPool: IMPLEMENTER_POOL,
    webPort: WEB_PORT,
  });
});

systemRoutes.get('/redis', async (_req, res) => {
  const result = await checkRedisConnection();
  res.json(result);
});
