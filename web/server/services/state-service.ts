// In-memory sprint state management with file-system persistence
// Reads/writes from sprints/<sprint-id>/ directory

import fs from 'node:fs';
import path from 'node:path';
import { SPRINTS_DIR, IMPLEMENTER_POOL, DEFAULT_IMPLEMENTER_COUNT } from '../config.js';
import { createLogger } from '../utils/logger.js';
import type {
  SprintStatus,
  TaskStatus,
  TaskState,
  Plan,
  CostData,
  SprintSummary,
  SprintDetail,
  ImplementerIdentity,
} from '../../shared/types.js';

const log = createLogger('state');

export interface SprintState {
  id: string;
  status: SprintStatus;
  plan: Plan | null;
  tasks: Map<number, TaskState>;
  implementers: ImplementerIdentity[];
  currentWave: number;
  worktreePaths: Map<string, string>;
  pendingApprovals: Map<string, PendingApproval>;
  costs: CostData;
  targetDir: string;
  specPath: string;
}

export interface PendingApproval {
  id: string;
  sprintId: string;
  message: string;
  context?: unknown;
  resolve: (approved: boolean, comment?: string) => void;
}

// In-memory store of active sprints
const sprints = new Map<string, SprintState>();

// --- Initialization ---

export function initSprint(
  sprintId: string,
  specPath: string,
  targetDir: string,
  implementerCount = DEFAULT_IMPLEMENTER_COUNT,
): SprintState {
  const sprintDir = path.join(SPRINTS_DIR, sprintId);
  fs.mkdirSync(path.join(sprintDir, 'logs'), { recursive: true });

  const costFile = path.join(sprintDir, 'cost.json');
  if (!fs.existsSync(costFile)) {
    fs.writeFileSync(costFile, JSON.stringify({ total: 0, by_agent: {}, by_task: {}, sessions: [] }, null, 2));
  }

  const implementers = IMPLEMENTER_POOL.slice(0, implementerCount).map((impl) => ({ ...impl }));

  const state: SprintState = {
    id: sprintId,
    status: 'created',
    plan: null,
    tasks: new Map(),
    implementers,
    currentWave: 0,
    worktreePaths: new Map(),
    pendingApprovals: new Map(),
    costs: { total: 0, by_agent: {}, by_task: {}, sessions: [] },
    targetDir,
    specPath,
  };

  sprints.set(sprintId, state);
  writeStatus(sprintId, 'created');
  writeMeta(sprintId, { targetDir, specPath, implementerCount, createdAt: new Date().toISOString() });

  log.info(`Initialized sprint: ${sprintId}`, { implementerCount });
  return state;
}

// --- Getters ---

export function getSprint(sprintId: string): SprintState | undefined {
  return sprints.get(sprintId);
}

export function getSprintOrThrow(sprintId: string): SprintState {
  const sprint = sprints.get(sprintId);
  if (!sprint) throw new Error(`Sprint not found: ${sprintId}`);
  return sprint;
}

/**
 * List all sprints, combining in-memory state with file-system discovery.
 */
export function listSprints(): SprintSummary[] {
  const summaries: SprintSummary[] = [];

  if (!fs.existsSync(SPRINTS_DIR)) return summaries;

  const dirs = fs.readdirSync(SPRINTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('sprint-'));

  for (const dir of dirs) {
    const sprintId = dir.name;
    const inMemory = sprints.get(sprintId);

    if (inMemory) {
      summaries.push(sprintStateToSummary(inMemory));
    } else {
      // Load from file system
      summaries.push(loadSprintSummaryFromDisk(sprintId));
    }
  }

  return summaries;
}

export function getSprintDetail(sprintId: string): SprintDetail {
  const state = sprints.get(sprintId);
  if (state) {
    return {
      ...sprintStateToSummary(state),
      plan: state.plan,
      tasks: Array.from(state.tasks.values()),
      implementers: state.implementers,
      currentWave: state.currentWave,
      costs: state.costs,
    };
  }

  // Fall back to loading from disk for sprints not in memory
  return loadSprintDetailFromDisk(sprintId);
}

// --- State Mutations ---

export function setSprintStatus(sprintId: string, status: SprintStatus): void {
  const sprint = getSprintOrThrow(sprintId);
  sprint.status = status;
  writeStatus(sprintId, status);
  log.info(`Sprint ${sprintId} status: ${status}`);
}

export function setSprintPlan(sprintId: string, plan: Plan): void {
  const sprint = getSprintOrThrow(sprintId);

  // Normalize plan tasks — handle planners that produce string IDs or omit fields
  normalizePlan(plan);

  sprint.plan = plan;

  // Initialize task states from plan
  for (const task of plan.tasks) {
    sprint.tasks.set(task.id, {
      taskId: task.id,
      status: 'pending',
      implementerId: task.assigned_to,
    });
  }

  // Write plan.json to disk
  const planFile = path.join(SPRINTS_DIR, sprintId, 'plan.json');
  fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));
}

/**
 * Normalize a plan's tasks to ensure consistent types.
 * Handles: string IDs ("task-1" → 1), missing agent fields, missing arrays.
 */
function normalizePlan(plan: Plan): void {
  for (let i = 0; i < plan.tasks.length; i++) {
    const task = plan.tasks[i];

    // Normalize task ID: "task-1" → 1, "3" → 3, or use index+1 as fallback
    if (typeof task.id === 'string') {
      const numericPart = (task.id as string).replace(/\D/g, '');
      (task as { id: number }).id = numericPart ? parseInt(numericPart, 10) : i + 1;
    }

    // Default agent to 'implementer' if it has an assigned_to
    if (!task.agent && task.assigned_to) {
      task.agent = 'implementer';
    }

    // Normalize depends_on IDs the same way
    if (task.depends_on) {
      task.depends_on = task.depends_on.map((dep) => {
        if (typeof dep === 'string') {
          const numPart = (dep as unknown as string).replace(/\D/g, '');
          return numPart ? parseInt(numPart, 10) : 0;
        }
        return dep;
      }).filter((d) => d > 0);
    } else {
      task.depends_on = [];
    }

    // Default missing arrays
    if (!task.labels) task.labels = [];
    if (!task.acceptance_criteria) task.acceptance_criteria = [];
  }
}

export function setTaskStatus(sprintId: string, taskId: number, status: TaskStatus, implementerId?: string): void {
  const sprint = getSprintOrThrow(sprintId);
  const task = sprint.tasks.get(taskId);

  if (task) {
    task.status = status;
    if (implementerId) task.implementerId = implementerId;
    if (status === 'in-progress') task.startedAt = new Date().toISOString();
    if (status === 'completed' || status === 'failed') task.completedAt = new Date().toISOString();
  }

  // Update .completed file if task is done
  if (status === 'completed') {
    appendCompleted(sprintId, taskId);
  }
}

export function setCurrentWave(sprintId: string, wave: number): void {
  const sprint = getSprintOrThrow(sprintId);
  sprint.currentWave = wave;
}

export function setWorktreePath(sprintId: string, implementerId: string, worktreePath: string): void {
  const sprint = getSprintOrThrow(sprintId);
  sprint.worktreePaths.set(implementerId, worktreePath);
}

export function updateCosts(sprintId: string): CostData {
  const sprint = getSprintOrThrow(sprintId);
  const costFile = path.join(SPRINTS_DIR, sprintId, 'cost.json');

  if (fs.existsSync(costFile)) {
    sprint.costs = JSON.parse(fs.readFileSync(costFile, 'utf-8'));
  }

  return sprint.costs;
}

// --- Approval Management ---

export function addPendingApproval(approval: PendingApproval): void {
  const sprint = getSprintOrThrow(approval.sprintId);
  sprint.pendingApprovals.set(approval.id, approval);
}

export function resolvePendingApproval(sprintId: string, approvalId: string, approved: boolean, comment?: string): boolean {
  const sprint = getSprint(sprintId);
  if (!sprint) return false;

  const approval = sprint.pendingApprovals.get(approvalId);
  if (!approval) return false;

  approval.resolve(approved, comment);
  sprint.pendingApprovals.delete(approvalId);
  return true;
}

// --- Restart / Retry ---

export function resetTaskStatus(sprintId: string, taskId: number): void {
  const sprint = getSprintOrThrow(sprintId);
  const task = sprint.tasks.get(taskId);
  if (task) {
    task.status = 'pending';
    task.startedAt = undefined;
    task.completedAt = undefined;
    task.error = undefined;
  }
  removeFromCompleted(sprintId, taskId);
}

export function resetSprintForRestart(sprintId: string): { pendingTaskIds: number[] } {
  const sprint = getSprintOrThrow(sprintId);
  const pendingTaskIds: number[] = [];
  for (const [taskId, task] of sprint.tasks) {
    if (task.status === 'failed' || task.status === 'blocked' || task.status === 'queued' || task.status === 'in-progress') {
      task.status = 'pending';
      task.startedAt = undefined;
      task.completedAt = undefined;
      task.error = undefined;
      removeFromCompleted(sprintId, taskId);
      pendingTaskIds.push(taskId);
    }
  }
  sprint.status = 'running';
  writeStatus(sprintId, 'running');
  sprint.pendingApprovals.clear();
  return { pendingTaskIds };
}

// --- Auto-load on startup ---

/**
 * Load all sprints with active statuses from disk into memory on server startup.
 * This ensures workers can find sprint state after a server restart.
 */
export function loadActiveSprintsFromDisk(): number {
  if (!fs.existsSync(SPRINTS_DIR)) return 0;

  const activeStatuses = new Set(['running', 'researching', 'planning', 'awaiting-approval', 'approved', 'reviewing', 'paused']);
  let loaded = 0;

  const dirs = fs.readdirSync(SPRINTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('sprint-'));

  for (const dir of dirs) {
    const sprintId = dir.name;
    if (sprints.has(sprintId)) continue;

    const status = readStatus(sprintId);
    if (activeStatuses.has(status)) {
      const result = loadSprintFromDisk(sprintId);
      if (result) {
        loaded++;
        log.info(`Auto-loaded sprint ${sprintId} (status: ${status})`);
      }
    }
  }

  return loaded;
}

// --- Load from disk ---

/**
 * Load a sprint into memory from disk (for sprints started before the server).
 * If targetDir is not provided, attempts to read it from .meta.json.
 */
export function loadSprintFromDisk(sprintId: string, targetDir?: string): SprintState | null {
  const sprintDir = path.join(SPRINTS_DIR, sprintId);
  if (!fs.existsSync(sprintDir)) return null;

  const status = readStatus(sprintId);
  const plan = readPlan(sprintId);
  const costs = readCosts(sprintId);
  const completedTasks = readCompleted(sprintId);
  const meta = readMeta(sprintId);

  const resolvedTargetDir = targetDir || meta?.targetDir || '';

  const state: SprintState = {
    id: sprintId,
    status,
    plan,
    tasks: new Map(),
    implementers: IMPLEMENTER_POOL.slice(0, plan?.implementer_count || meta?.implementerCount || DEFAULT_IMPLEMENTER_COUNT).map((i) => ({ ...i })),
    currentWave: 0,
    worktreePaths: new Map(),
    pendingApprovals: new Map(),
    costs,
    targetDir: resolvedTargetDir,
    specPath: plan?.spec || meta?.specPath || '',
  };

  if (plan) {
    for (const task of plan.tasks) {
      state.tasks.set(task.id, {
        taskId: task.id,
        status: completedTasks.has(task.id) ? 'completed' : 'pending',
        implementerId: task.assigned_to,
      });
    }
  }

  sprints.set(sprintId, state);
  return state;
}

// --- File Helpers ---

function writeStatus(sprintId: string, status: string): void {
  const file = path.join(SPRINTS_DIR, sprintId, '.status');
  fs.writeFileSync(file, status);
}

function readStatus(sprintId: string): SprintStatus {
  const file = path.join(SPRINTS_DIR, sprintId, '.status');
  if (!fs.existsSync(file)) return 'created';
  return fs.readFileSync(file, 'utf-8').trim() as SprintStatus;
}

function readPlan(sprintId: string): Plan | null {
  const file = path.join(SPRINTS_DIR, sprintId, 'plan.json');
  if (!fs.existsSync(file)) return null;
  try {
    const plan = JSON.parse(fs.readFileSync(file, 'utf-8')) as Plan;
    normalizePlan(plan);
    return plan;
  } catch {
    return null;
  }
}

function readCosts(sprintId: string): CostData {
  const file = path.join(SPRINTS_DIR, sprintId, 'cost.json');
  if (!fs.existsSync(file)) return { total: 0, by_agent: {}, by_task: {} };
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return { total: 0, by_agent: {}, by_task: {} };
  }
}

function appendCompleted(sprintId: string, taskId: number): void {
  const file = path.join(SPRINTS_DIR, sprintId, '.completed');
  fs.appendFileSync(file, `${taskId}\n`);
}

function readCompleted(sprintId: string): Set<number> {
  const file = path.join(SPRINTS_DIR, sprintId, '.completed');
  if (!fs.existsSync(file)) return new Set();
  const lines = fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean);
  return new Set(lines.map(Number));
}

function removeFromCompleted(sprintId: string, taskId: number): void {
  const file = path.join(SPRINTS_DIR, sprintId, '.completed');
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean);
  const filtered = lines.filter((line) => Number(line) !== taskId);
  fs.writeFileSync(file, filtered.join('\n') + (filtered.length ? '\n' : ''));
}

/**
 * Load a full SprintDetail from disk files (for sprints not in memory after server restart).
 * Throws if the sprint directory doesn't exist.
 */
function loadSprintDetailFromDisk(sprintId: string): SprintDetail {
  const sprintDir = path.join(SPRINTS_DIR, sprintId);
  if (!fs.existsSync(sprintDir)) {
    throw new Error(`Sprint not found: ${sprintId}`);
  }

  const status = readStatus(sprintId);
  const plan = readPlan(sprintId);
  const costs = readCosts(sprintId);
  const completed = readCompleted(sprintId);
  const meta = readMeta(sprintId);

  const implementerCount = plan?.implementer_count || meta?.implementerCount || DEFAULT_IMPLEMENTER_COUNT;
  const implementers = IMPLEMENTER_POOL.slice(0, implementerCount).map((i) => ({ ...i }));

  const tasks: TaskState[] = [];
  if (plan) {
    for (const task of plan.tasks) {
      tasks.push({
        taskId: task.id,
        status: completed.has(task.id) ? 'completed' : 'pending',
        implementerId: task.assigned_to,
      });
    }
  }

  return {
    id: sprintId,
    status,
    spec: plan?.spec || meta?.specPath,
    taskCount: plan?.tasks.length,
    completedCount: completed.size,
    implementerCount,
    plan,
    tasks,
    implementers,
    currentWave: 0,
    costs,
  };
}

function loadSprintSummaryFromDisk(sprintId: string): SprintSummary {
  const status = readStatus(sprintId);
  const plan = readPlan(sprintId);
  const completed = readCompleted(sprintId);

  return {
    id: sprintId,
    status,
    spec: plan?.spec,
    taskCount: plan?.tasks.length,
    completedCount: completed.size,
    implementerCount: plan?.implementer_count || DEFAULT_IMPLEMENTER_COUNT,
  };
}

interface SprintMeta {
  targetDir: string;
  specPath: string;
  implementerCount: number;
  createdAt: string;
}

function writeMeta(sprintId: string, meta: SprintMeta): void {
  const file = path.join(SPRINTS_DIR, sprintId, '.meta.json');
  fs.writeFileSync(file, JSON.stringify(meta, null, 2));
}

function readMeta(sprintId: string): SprintMeta | null {
  const file = path.join(SPRINTS_DIR, sprintId, '.meta.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function sprintStateToSummary(state: SprintState): SprintSummary {
  const completedCount = Array.from(state.tasks.values()).filter((t) => t.status === 'completed').length;
  return {
    id: state.id,
    status: state.status,
    spec: state.plan?.spec,
    taskCount: state.plan?.tasks.length,
    completedCount,
    implementerCount: state.implementers.length,
  };
}
