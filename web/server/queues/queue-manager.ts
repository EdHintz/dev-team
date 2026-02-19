// BullMQ queue initialization and orchestration

import { Queue, QueueEvents } from 'bullmq';
import { getRedisConnection } from '../utils/redis.js';
import { createLogger } from '../utils/logger.js';
import { getSprintOrThrow } from '../services/state-service.js';
import { broadcast } from '../websocket/ws-server.js';

const log = createLogger('queues');

// --- Queue Instances ---

let researchQueue: Queue;
let planningQueue: Queue;
let testingQueue: Queue;
let reviewQueue: Queue;
let prQueue: Queue;
const implementationQueues = new Map<string, Queue>();

// --- Queue Events ---

let researchEvents: QueueEvents;
let planningEvents: QueueEvents;
let testingEvents: QueueEvents;
let reviewEvents: QueueEvents;

export function initQueues(): void {
  const connection = getRedisConnection();

  researchQueue = new Queue('research', { connection });
  planningQueue = new Queue('planning', { connection });
  testingQueue = new Queue('testing', { connection });
  reviewQueue = new Queue('review', { connection });
  prQueue = new Queue('pr-creation', { connection });

  // Create per-developer queues (default 5 slots, created on demand)
  for (let i = 1; i <= 5; i++) {
    const queueName = `implementation-developer-${i}`;
    implementationQueues.set(`developer-${i}`, new Queue(queueName, { connection }));
  }

  // Set up event listeners for progress forwarding
  researchEvents = new QueueEvents('research', { connection });
  planningEvents = new QueueEvents('planning', { connection });

  researchEvents.on('progress', ({ data }) => {
    if (data && typeof data === 'object' && 'type' in data) {
      const progressData = data as { type: string; sprintId?: string; line?: string };
      if (progressData.type === 'log' && progressData.sprintId) {
        broadcast({
          type: 'task:log',
          sprintId: progressData.sprintId,
          taskId: 0,
          developerId: 'researcher',
          line: progressData.line || '',
        });
      }
    }
  });

  planningEvents.on('progress', ({ data }) => {
    if (data && typeof data === 'object' && 'type' in data) {
      const progressData = data as { type: string; sprintId?: string; line?: string };
      if (progressData.type === 'log' && progressData.sprintId) {
        broadcast({
          type: 'task:log',
          sprintId: progressData.sprintId,
          taskId: 0,
          developerId: 'planner',
          line: progressData.line || '',
        });
      }
    }
  });

  testingEvents = new QueueEvents('testing', { connection });
  reviewEvents = new QueueEvents('review', { connection });

  testingEvents.on('progress', ({ data }) => {
    if (data && typeof data === 'object' && 'type' in data) {
      const progressData = data as { type: string; sprintId?: string; line?: string };
      if (progressData.type === 'log' && progressData.sprintId) {
        broadcast({
          type: 'task:log',
          sprintId: progressData.sprintId,
          taskId: 0,
          developerId: 'tester',
          line: progressData.line || '',
        });
      }
    }
  });

  reviewEvents.on('progress', ({ data }) => {
    if (data && typeof data === 'object' && 'type' in data) {
      const progressData = data as { type: string; sprintId?: string; line?: string };
      if (progressData.type === 'log' && progressData.sprintId) {
        broadcast({
          type: 'task:log',
          sprintId: progressData.sprintId,
          taskId: 0,
          developerId: 'reviewer',
          line: progressData.line || '',
        });
      }
    }
  });

  // Set up implementation queue event listeners
  for (const [implId, queue] of implementationQueues) {
    const events = new QueueEvents(queue.name, { connection });
    events.on('progress', ({ data }) => {
      if (data && typeof data === 'object' && 'type' in data) {
        const progressData = data as { type: string; sprintId?: string; taskId?: number; line?: string };
        if (progressData.type === 'log' && progressData.sprintId) {
          broadcast({
            type: 'task:log',
            sprintId: progressData.sprintId,
            taskId: progressData.taskId || 0,
            developerId: implId,
            line: progressData.line || '',
          });
        }
      }
    });
  }

  log.info('BullMQ queues initialized');
}

// --- Enqueue Functions ---

export async function enqueuePlanningPipeline(
  sprintId: string,
  specPath: string,
  targetDir: string,
  _developerCount: number,
  retry = false,
): Promise<void> {
  const suffix = retry ? `-retry-${Date.now()}` : '';
  // Step 1: Research
  await researchQueue.add('research', {
    sprintId,
    specPath,
    targetDir,
  }, {
    jobId: `research-${sprintId}${suffix}`,
  });

  log.info(`Enqueued research job for ${sprintId}`);
}

export async function enqueuePlanning(
  sprintId: string,
  specPath: string,
  targetDir: string,
  developerCount: number,
  retry = false,
): Promise<void> {
  const suffix = retry ? `-retry-${Date.now()}` : '';
  await planningQueue.add('planning', {
    sprintId,
    specPath,
    targetDir,
    developerCount,
  }, {
    jobId: `planning-${sprintId}${suffix}`,
  });

  log.info(`Enqueued planning job for ${sprintId}`);
}

export async function enqueueImplementation(sprintId: string): Promise<void> {
  const sprint = getSprintOrThrow(sprintId);
  if (!sprint.plan) throw new Error('No plan found for sprint');

  // Filter to developer-assigned tasks — any task with assigned_to should be enqueued
  const tasks = sprint.plan.tasks.filter((t) => t.assigned_to);

  // Group tasks by wave
  const waves = new Map<number, typeof tasks>();
  for (const task of tasks) {
    const wave = task.wave || 1;
    if (!waves.has(wave)) waves.set(wave, []);
    waves.get(wave)!.push(task);
  }

  // Enqueue wave 1 tasks — subsequent waves are enqueued after wave completion
  const wave1 = waves.get(1) || tasks.filter((t) => (t.depends_on || []).length === 0);
  for (const task of wave1) {
    const implId = task.assigned_to || 'developer-1';
    const queue = implementationQueues.get(implId);
    if (!queue) continue;

    await queue.add('implement', {
      sprintId,
      taskId: task.id,
      taskDetails: task,
      developerId: implId,
      targetDir: sprint.targetDir,
    }, {
      jobId: `impl-${sprintId}-${task.id}`,
    });
  }

  log.info(`Enqueued wave 1 implementation tasks for ${sprintId}`, { count: wave1.length });
}

export async function enqueueNextWave(sprintId: string, wave: number): Promise<number> {
  const sprint = getSprintOrThrow(sprintId);
  if (!sprint.plan) return 0;

  const tasks = sprint.plan.tasks.filter((t) =>
    t.wave === wave && t.assigned_to
  );

  for (const task of tasks) {
    const implId = task.assigned_to || 'developer-1';
    const queue = implementationQueues.get(implId);
    if (!queue) continue;

    await queue.add('implement', {
      sprintId,
      taskId: task.id,
      taskDetails: task,
      developerId: implId,
      targetDir: sprint.targetDir,
    }, {
      jobId: `impl-${sprintId}-${task.id}`,
    });
  }

  log.info(`Enqueued wave ${wave} tasks for ${sprintId}`, { count: tasks.length });
  return tasks.length;
}

export async function enqueueTesting(sprintId: string): Promise<void> {
  const sprint = getSprintOrThrow(sprintId);

  await testingQueue.add('test', {
    sprintId,
    targetDir: sprint.targetDir,
  }, {
    jobId: `test-${sprintId}-${Date.now()}`,
  });

  log.info(`Enqueued testing job for ${sprintId}`);
}

export async function enqueueReview(sprintId: string, cycle: number): Promise<void> {
  const sprint = getSprintOrThrow(sprintId);

  await reviewQueue.add('review', {
    sprintId,
    cycle,
    targetDir: sprint.targetDir,
  }, {
    jobId: `review-${sprintId}-${cycle}-${Date.now()}`,
  });

  log.info(`Enqueued review job for ${sprintId} (cycle ${cycle})`);
}

export async function enqueuePrCreation(sprintId: string): Promise<void> {
  const sprint = getSprintOrThrow(sprintId);

  await prQueue.add('create-pr', {
    sprintId,
    targetDir: sprint.targetDir,
    baseBranch: 'main',
  }, {
    jobId: `pr-${sprintId}`,
  });

  log.info(`Enqueued PR creation job for ${sprintId}`);
}

export async function enqueueFixCycle(sprintId: string, cycle: number, reviewFindings: string): Promise<void> {
  const sprint = getSprintOrThrow(sprintId);

  // Send fix job to developer-1 (primary fixer)
  const fixerId = 'developer-1';
  const queue = implementationQueues.get(fixerId);
  if (!queue) throw new Error(`No queue found for ${fixerId}`);

  await queue.add('fix', {
    sprintId,
    taskId: 0,
    taskDetails: {
      id: 0,
      title: `Fix review cycle ${cycle} issues`,
      description: reviewFindings,
      depends_on: [],
    },
    developerId: fixerId,
    targetDir: sprint.targetDir,
    fixCycle: cycle,
    reviewFindings,
  }, {
    jobId: `fix-${sprintId}-cycle-${cycle}-${Date.now()}`,
  });

  log.info(`Enqueued fix job for ${sprintId} (review cycle ${cycle})`);
}

// --- Getters ---

export function getResearchQueue(): Queue { return researchQueue; }
export function getPlanningQueue(): Queue { return planningQueue; }
export function getTestingQueue(): Queue { return testingQueue; }
export function getReviewQueue(): Queue { return reviewQueue; }
export function getPrQueue(): Queue { return prQueue; }
export function getImplementationQueue(developerId: string): Queue | undefined {
  return implementationQueues.get(developerId);
}

// --- Subtask Enqueueing ---

export async function enqueueSubtask(
  sprintId: string,
  task: { id: number; title: string; description: string; assigned_to?: string },
  developerId: string,
): Promise<void> {
  const sprint = getSprintOrThrow(sprintId);
  const queue = implementationQueues.get(developerId);
  if (!queue) throw new Error(`No queue found for ${developerId}`);

  await queue.add('implement', {
    sprintId,
    taskId: task.id,
    taskDetails: task,
    developerId,
    targetDir: sprint.targetDir,
  }, {
    jobId: `impl-${sprintId}-${task.id}-sub-${Date.now()}`,
  });

  log.info(`Enqueued subtask ${task.id} for ${developerId} in ${sprintId}`);
}

// --- Drain Sprint Jobs ---

export async function drainSprintJobs(sprintId: string): Promise<number> {
  let removed = 0;

  const allQueues: Queue[] = [
    researchQueue,
    planningQueue,
    testingQueue,
    reviewQueue,
    prQueue,
    ...implementationQueues.values(),
  ];

  for (const queue of allQueues) {
    // Remove waiting jobs for this sprint
    const waiting = await queue.getJobs(['waiting', 'delayed', 'prioritized']);
    for (const job of waiting) {
      if (job.data?.sprintId === sprintId) {
        try {
          await job.remove();
          removed++;
        } catch {
          // Job may have already started — skip
        }
      }
    }
  }

  log.info(`Drained ${removed} queued jobs for cancelled sprint ${sprintId}`);
  return removed;
}

// --- Restart / Retry ---

export async function reEnqueueTask(sprintId: string, taskId: number): Promise<void> {
  const sprint = getSprintOrThrow(sprintId);
  if (!sprint.plan) throw new Error('No plan found for sprint');

  const task = sprint.plan.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`Task ${taskId} not found in plan`);

  const implId = task.assigned_to || 'developer-1';
  const queue = implementationQueues.get(implId);
  if (!queue) throw new Error(`No queue found for ${implId}`);

  await queue.add('implement', {
    sprintId,
    taskId: task.id,
    taskDetails: task,
    developerId: implId,
    targetDir: sprint.targetDir,
  }, {
    jobId: `impl-${sprintId}-${task.id}-retry-${Date.now()}`,
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
  });

  log.info(`Re-enqueued task ${taskId} for ${sprintId}`);
}

export async function restartSprint(sprintId: string, pendingTaskIds: number[]): Promise<void> {
  const sprint = getSprintOrThrow(sprintId);
  if (!sprint.plan) throw new Error('No plan found for sprint');

  // Only enqueue tasks from the earliest incomplete wave
  // (later waves will be enqueued as earlier waves complete)
  const pendingSet = new Set(pendingTaskIds);
  const pendingTasks = sprint.plan.tasks.filter((t) => pendingSet.has(t.id));

  const minWave = Math.min(...pendingTasks.map((t) => t.wave || 1));
  const tasksToEnqueue = pendingTasks.filter((t) => (t.wave || 1) === minWave);

  for (const task of tasksToEnqueue) {
    await reEnqueueTask(sprintId, task.id);
  }

  log.info(`Restarted sprint ${sprintId}: enqueued ${tasksToEnqueue.length} tasks from wave ${minWave} (${pendingTaskIds.length} total pending)`);
}
