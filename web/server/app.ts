// Express application setup

import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { WEB_DIR } from './config.js';
import { sprintRoutes } from './routes/sprint-routes.js';
import { taskRoutes } from './routes/task-routes.js';
import { systemRoutes } from './routes/system-routes.js';
import { appRoutes } from './routes/app-routes.js';

export function createApp(): express.Application {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // API routes
  app.use('/api/apps', appRoutes);
  app.use('/api/sprints', sprintRoutes);
  app.use('/api/tasks', taskRoutes);
  app.use('/api/system', systemRoutes);

  // Serve static avatars
  app.use('/avatars', express.static(path.join(WEB_DIR, 'client', 'public', 'avatars')));

  // In production, serve the built React app
  const clientDist = path.join(WEB_DIR, 'dist', 'client');
  app.use(express.static(clientDist));

  // SPA fallback — serve index.html for all non-API routes
  app.get('*', (_req, res) => {
    const indexFile = path.join(clientDist, 'index.html');
    if (fs.existsSync(indexFile)) {
      res.sendFile(indexFile);
    } else {
      res.json({ message: 'Dev Team Web API. Run `npm run dev:client` for the UI.' });
    }
  });

  return app;
}
