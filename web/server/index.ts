// Main entry point: starts Express server, WebSocket, Redis, BullMQ workers

import 'dotenv/config';
import http from 'node:http';
import { createApp } from './app.js';
import { WEB_PORT } from './config.js';
import { checkRedisConnection, closeRedisConnection } from './utils/redis.js';
import { initWebSocket, closeWebSocket } from './websocket/ws-server.js';
import { initQueues } from './queues/queue-manager.js';
import { startAllWorkers, stopAllWorkers } from './workers/worker-manager.js';
import { loadActiveSprintsFromDisk, registerAppRootFolders } from './services/state-service.js';
import { getAllAppRootFolders } from './services/app-service.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('server');

async function main(): Promise<void> {
  log.info('Starting Dev Team Web Orchestrator...');

  // Register app root folders so sprint scanning can find per-app sprint dirs
  registerAppRootFolders(getAllAppRootFolders());

  // Load any active sprints from disk into memory
  const loadedCount = loadActiveSprintsFromDisk();
  if (loadedCount > 0) {
    log.info(`Loaded ${loadedCount} active sprint(s) from disk`);
  }

  // Check Redis
  const redis = await checkRedisConnection();
  if (!redis.connected) {
    log.error(`Redis not available: ${redis.error}`);
    log.error('The server will start but sprint operations require Redis.');
    log.error('Start Redis with: brew services start redis');
    log.error('            or: docker run -d -p 6379:6379 redis:alpine');
  } else {
    log.info('Redis connected');

    // Initialize BullMQ queues and workers
    initQueues();
    startAllWorkers();
  }

  // Create Express app and HTTP server
  const app = createApp();
  const server = http.createServer(app);

  // Initialize WebSocket
  initWebSocket(server);

  // Start listening
  server.listen(WEB_PORT, () => {
    log.info(`Server running at http://localhost:${WEB_PORT}`);
    log.info(`WebSocket available at ws://localhost:${WEB_PORT}/ws`);
    log.info(`API: http://localhost:${WEB_PORT}/api/system/health`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down...');
    await stopAllWorkers();
    closeWebSocket();
    server.close();
    await closeRedisConnection();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
