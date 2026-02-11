// Worker manager: starts and manages all BullMQ workers

import type { Worker } from 'bullmq';
import { startResearchWorker } from './research-worker.js';
import { startPlanningWorker } from './planning-worker.js';
import { startImplementationWorker } from './implementation-worker.js';
import { startTestingWorker } from './testing-worker.js';
import { startReviewWorker } from './review-worker.js';
import { startPrWorker } from './pr-worker.js';
import { DEFAULT_IMPLEMENTER_COUNT } from '../config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('worker-mgr');

const workers: Worker[] = [];

export function startAllWorkers(implementerCount = DEFAULT_IMPLEMENTER_COUNT): void {
  // Start singleton workers
  workers.push(startResearchWorker());
  workers.push(startPlanningWorker());
  workers.push(startTestingWorker());
  workers.push(startReviewWorker());
  workers.push(startPrWorker());

  // Start implementation workers — one per implementer
  for (let i = 1; i <= implementerCount; i++) {
    workers.push(startImplementationWorker(`implementer-${i}`));
  }

  log.info(`Started ${workers.length} workers (${implementerCount} implementers)`);
}

export async function stopAllWorkers(): Promise<void> {
  log.info(`Stopping ${workers.length} workers...`);
  await Promise.all(workers.map((w) => w.close()));
  workers.length = 0;
  log.info('All workers stopped');
}
