// In-memory sprint state management with file-system persistence
// Reads/writes from per-app sprint directories via the sprint directory registry

import fs from 'node:fs';
import path from 'node:path';
import { SPRINTS_DIR, DEVELOPER_POOL, DEFAULT_DEVELOPER_COUNT } from '../config.js';
import { createLogger } from '../utils/logger.js';
import type {
  SprintStatus,
  TaskStatus,
  TaskState,
  Task,
  Plan,
  CostData,
  SprintSummary,
  SprintDetail,
  DeveloperIdentity,
  AutonomyMode,
} from '../../shared/types.js';

const log = createLogger('state');

// --- Sprint Directory Registry ---
// Maps sprintId → absolute path to its directory (e.g. /Users/.../macro-econ/sprints/sprint-20260210-839c)
const sprintDirRegistry = new Map<string, string>();

// App root folders registered at boot (avoids circular import with app-service)
let appRootFolders: string[] = [];

/**
 * Look up the directory for a sprint. Falls back to the global SPRINTS_DIR if not registered.
 */
export function getSprintDir(sprintId: string): string {
  return sprintDirRegistry.get(sprintId) || path.join(SPRINTS_DIR, sprintId);
}

/**
 * Register a sprint's directory in the registry.
 */
export function registerSprintDir(sprintId: string, dir: string): void {
  sprintDirRegistry.set(sprintId, dir);
}

/**
 * Register app root folders so listSprints/loadActiveSprintsFromDisk can scan them.
 * Called at boot from index.ts to avoid circular imports with app-service.
 */
export function registerAppRootFolders(folders: string[]): void {
  appRootFolders = folders;
}

/**
 * Register a single app root folder for sprint discovery.
 * Called when a new app is created after server boot.
 */
export function registerAppRootFolder(folder: string): void {
  if (!appRootFolders.includes(folder)) {
    appRootFolders.push(folder);
  }
}

export interface SprintState {
  id: string;
  name?: string;
  status: SprintStatus;
  plan: Plan | null;
  tasks: Map<number, TaskState>;
  developers: DeveloperIdentity[];
  currentWave: number;
  reviewCycle: number;
  worktreePaths: Map<string, string>;
  pendingApprovals: Map<string, PendingApproval>;
  costs: CostData;
  targetDir: string;
  specPath: string;
  autonomyMode: AutonomyMode;
  createdAt: string;
  approvedAt?: string;
}

export interface PendingApproval {
  id: string;
  sprintId: string;
  message: string;
  context?: unknown;
  resolve: (approved: boolean, comment?: string, data?: unknown) => void;
}

// In-memory store of active sprints
const sprints = new Map<string, SprintState>();

// --- Initialization ---

export function initSprint(
  sprintId: string,
  specPath: string,
  targetDir: string,
  developerCount = DEFAULT_DEVELOPER_COUNT,
  sprintDir?: string,
  autonomyMode: AutonomyMode = 'supervised',
  name?: string,
): SprintState {
  const resolvedDir = sprintDir || path.join(SPRINTS_DIR, sprintId);
  registerSprintDir(sprintId, resolvedDir);
  fs.mkdirSync(path.join(resolvedDir, 'logs'), { recursive: true });

  const costFile = path.join(resolvedDir, 'cost.json');
  if (!fs.existsSync(costFile)) {
    fs.writeFileSync(costFile, JSON.stringify({ total: 0, by_agent: {}, by_task: {}, sessions: [] }, null, 2));
  }

  const developers = DEVELOPER_POOL.slice(0, developerCount).map((impl) => ({ ...impl }));

  const createdAt = new Date().toISOString();

  const state: SprintState = {
    id: sprintId,
    name,
    status: 'created',
    plan: null,
    tasks: new Map(),
    developers,
    currentWave: 0,
    reviewCycle: 0,
    worktreePaths: new Map(),
    pendingApprovals: new Map(),
    costs: { total: 0, by_agent: {}, by_task: {}, sessions: [] },
    targetDir,
    specPath,
    autonomyMode,
    createdAt,
  };

  sprints.set(sprintId, state);
  writeStatus(sprintId, 'created');
  writeMeta(sprintId, { targetDir, specPath, developerCount, createdAt, autonomyMode, name });

  log.info(`Initialized sprint: ${sprintId}`, { developerCount, autonomyMode });
  return state;
}

// --- Getters ---

export function getSprint(sprintId: string): SprintState | undefined {
  return getOrHydrateSprint(sprintId);
}

export function getSprintOrThrow(sprintId: string): SprintState {
  const sprint = getOrHydrateSprint(sprintId);
  if (!sprint) throw new Error(`Sprint not found: ${sprintId}`);
  return sprint;
}

/**
 * Get a sprint from memory, or hydrate it from disk if it exists on the filesystem.
 * This handles the case where the server restarted and lost in-memory state.
 */
export function getOrHydrateSprint(sprintId: string): SprintState | undefined {
  const existing = sprints.get(sprintId);
  if (existing) return existing;

  // Try to load from disk
  const sprintDir = getSprintDir(sprintId);
  if (!fs.existsSync(sprintDir)) return undefined;

  const meta = readMeta(sprintId);
  if (!meta) return undefined;

  const status = readStatus(sprintId);
  const plan = readPlan(sprintId);
  const costs = readCosts(sprintId);
  const completed = readCompleted(sprintId);

  const developerCount = plan?.developer_count || meta.developerCount || DEFAULT_DEVELOPER_COUNT;
  const developers = DEVELOPER_POOL.slice(0, developerCount).map((i) => ({ ...i }));

  const tasks = new Map<number, TaskState>();
  if (plan) {
    for (const task of plan.tasks) {
      tasks.set(task.id, {
        taskId: task.id,
        status: completed.has(task.id) ? 'completed' : 'pending',
        developerId: task.assigned_to,
      });
    }
  }

  const state: SprintState = {
    id: sprintId,
    status,
    plan,
    tasks,
    developers,
    currentWave: 0,
    reviewCycle: 0,
    worktreePaths: new Map(),
    pendingApprovals: new Map(),
    costs,
    targetDir: meta.targetDir,
    specPath: meta.specPath,
    autonomyMode: meta.autonomyMode || 'supervised',
    createdAt: meta.createdAt,
    approvedAt: meta.approvedAt,
  };

  sprints.set(sprintId, state);
  log.info(`Hydrated sprint from disk: ${sprintId}`);
  return state;
}

/**
 * List all sprints, combining in-memory state with file-system discovery.
 * Scans both the global SPRINTS_DIR and each app's {rootFolder}/sprints/ dir.
 */
export function listSprints(): SprintSummary[] {
  const summaries: SprintSummary[] = [];
  const seen = new Set<string>();

  // Collect sprint directories from all locations
  const sprintScanDirs: string[] = [];
  if (fs.existsSync(SPRINTS_DIR)) sprintScanDirs.push(SPRINTS_DIR);
  for (const rootFolder of appRootFolders) {
    const appSprintsDir = path.join(rootFolder, 'sprints');
    if (fs.existsSync(appSprintsDir)) sprintScanDirs.push(appSprintsDir);
  }

  for (const scanDir of sprintScanDirs) {
    const dirs = fs.readdirSync(scanDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('sprint-'));

    for (const dir of dirs) {
      const sprintId = dir.name;
      if (seen.has(sprintId)) continue;
      seen.add(sprintId);

      // Register the directory if not already known
      if (!sprintDirRegistry.has(sprintId)) {
        registerSprintDir(sprintId, path.join(scanDir, sprintId));
      }

      try {
        const inMemory = sprints.get(sprintId);

        if (inMemory) {
          summaries.push(sprintStateToSummary(inMemory));
        } else {
          // Load from file system
          summaries.push(loadSprintSummaryFromDisk(sprintId));
        }
      } catch {
        // Skip broken sprint directories rather than failing the whole list
        summaries.push({ id: sprintId, status: 'failed' });
      }
    }
  }

  // Reverse chronological order (sprint IDs encode date as sprint-YYYYMMDD-xxxx)
  summaries.sort((a, b) => b.id.localeCompare(a.id));

  return summaries;
}

export function getSprintDetail(sprintId: string): SprintDetail {
  const roleLogs = loadRoleLogs(sprintId);
  const prUrl = readPrUrl(sprintId);

  const state = sprints.get(sprintId);
  if (state) {
    return {
      ...sprintStateToSummary(state),
      plan: state.plan,
      tasks: Array.from(state.tasks.values()),
      developers: state.developers,
      currentWave: state.currentWave,
      reviewCycle: state.reviewCycle,
      costs: state.costs,
      roleLogs,
      prUrl,
    };
  }

  // Fall back to loading from disk for sprints not in memory
  const detail = loadSprintDetailFromDisk(sprintId);
  detail.roleLogs = roleLogs;
  detail.prUrl = prUrl;
  return detail;
}

/** Load persisted role log files for a sprint. */
function loadRoleLogs(sprintId: string): Record<string, string[]> {
  const logDir = path.join(getSprintDir(sprintId), 'role-logs');
  const result: Record<string, string[]> = {};

  if (!fs.existsSync(logDir)) return result;

  try {
    const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.log'));
    for (const file of files) {
      const roleId = file.replace(/\.log$/, '');
      const content = fs.readFileSync(path.join(logDir, file), 'utf-8');
      const lines = content.split('\n').filter((l) => l);
      // Keep last 500 lines per role to avoid huge payloads
      result[roleId] = lines.slice(-500);
    }
  } catch {
    // Best-effort
  }

  return result;
}

// --- State Mutations ---

export function setSprintStatus(sprintId: string, status: SprintStatus): void {
  const sprint = getSprintOrThrow(sprintId);
  sprint.status = status;
  writeStatus(sprintId, status);
  log.info(`Sprint ${sprintId} status: ${status}`);
}

export function setReviewCycle(sprintId: string, cycle: number): void {
  const sprint = getSprintOrThrow(sprintId);
  sprint.reviewCycle = cycle;
}

export function setSprintApprovedAt(sprintId: string): void {
  const sprint = getSprintOrThrow(sprintId);
  sprint.approvedAt = new Date().toISOString();
  // Update meta on disk
  const meta = readMeta(sprintId);
  if (meta) {
    meta.approvedAt = sprint.approvedAt;
    writeMeta(sprintId, meta);
  }
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
      developerId: task.assigned_to,
    });
  }

  // Write plan.json to disk
  const planFile = path.join(getSprintDir(sprintId), 'plan.json');
  fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));
}

/**
 * Normalize a plan's tasks to ensure consistent types.
 * Handles: string IDs ("task-1" → 1), missing agent fields, missing arrays.
 */
function normalizePlan(plan: Plan): void {
  for (let i = 0; i < plan.tasks.length; i++) {
    const task = plan.tasks[i];

    // Normalize task ID to integer
    if (typeof task.id === 'string') {
      const original = task.id;
      const numericPart = (task.id as string).replace(/\D/g, '');
      (task as { id: number }).id = numericPart ? parseInt(numericPart, 10) : i + 1;
      log.warn(`Planner produced string task ID "${original}", coerced to ${task.id}`);
    } else if (typeof task.id !== 'number') {
      (task as { id: number }).id = i + 1;
      log.warn(`Planner produced non-numeric task ID, defaulted to ${task.id}`);
    }

    // Normalize agent: map legacy 'implementer' → 'developer'
    if ((task.agent as string) === 'implementer') {
      task.agent = 'developer';
    }
    // Default agent to 'developer' if it has an assigned_to
    if (!task.agent && task.assigned_to) {
      task.agent = 'developer';
    }

    // Normalize depends_on IDs to integers
    if (task.depends_on) {
      task.depends_on = task.depends_on.map((dep) => {
        if (typeof dep === 'string') {
          log.warn(`Planner produced string dependency "${dep}" in task ${task.id}, coercing`);
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

  // Default missing numeric estimate fields
  if (plan.estimates) {
    if (typeof plan.estimates.ai_team_minutes !== 'number') {
      plan.estimates.ai_team_minutes = 0;
    }
    if (typeof plan.estimates.human_team_minutes !== 'number') {
      plan.estimates.human_team_minutes = 0;
    }
  }
}

export function setTaskStatus(sprintId: string, taskId: number, status: TaskStatus, developerId?: string): void {
  const sprint = getSprintOrThrow(sprintId);
  const task = sprint.tasks.get(taskId);

  if (task) {
    task.status = status;
    if (developerId) task.developerId = developerId;
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

export function setWorktreePath(sprintId: string, developerId: string, worktreePath: string): void {
  const sprint = getSprintOrThrow(sprintId);
  sprint.worktreePaths.set(developerId, worktreePath);
}

export function updateCosts(sprintId: string): CostData {
  const sprint = getSprintOrThrow(sprintId);
  const costFile = path.join(getSprintDir(sprintId), 'cost.json');

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

export function resolvePendingApproval(sprintId: string, approvalId: string, approved: boolean, comment?: string, data?: unknown): boolean {
  const sprint = getSprint(sprintId);
  if (!sprint) return false;

  const approval = sprint.pendingApprovals.get(approvalId);
  if (!approval) return false;

  approval.resolve(approved, comment, data);
  sprint.pendingApprovals.delete(approvalId);
  return true;
}

// --- Autonomy Mode ---

export function sprintNeedsApproval(sprintId: string, stepType: 'plan' | 'task' | 'commit' | 'pr'): boolean {
  const sprint = getSprint(sprintId);
  const mode = sprint?.autonomyMode || 'supervised';
  switch (mode) {
    case 'supervised':
      return true;
    case 'semi-auto':
      return stepType === 'commit' || stepType === 'pr';
    case 'full-auto':
      return false;
    default:
      return true;
  }
}

// --- Subtask Injection ---

/**
 * Dynamically add subtasks to an existing sprint plan.
 * Assigns incrementing IDs starting from max existing ID + 1.
 * Creates TaskState entries and persists updated plan.json to disk.
 */
export function addSubtasks(sprintId: string, parentTaskId: number, subtasks: Omit<Task, 'id' | 'depends_on'>[]): Task[] {
  const sprint = getSprintOrThrow(sprintId);
  if (!sprint.plan) throw new Error(`No plan found for sprint ${sprintId}`);

  // Find the parent task to inherit wave and assignment
  const parentTask = sprint.plan.tasks.find((t) => t.id === parentTaskId);
  const wave = parentTask?.wave || 1;
  const assignedTo = parentTask?.assigned_to;

  // Determine next available ID
  const maxId = Math.max(...sprint.plan.tasks.map((t) => t.id), 0);
  const newTasks: Task[] = [];

  for (let i = 0; i < subtasks.length; i++) {
    const newId = maxId + 1 + i;
    const task: Task = {
      id: newId,
      title: subtasks[i].title,
      description: subtasks[i].description,
      acceptance_criteria: subtasks[i].acceptance_criteria || [],
      files_touched: subtasks[i].files_touched || [],
      depends_on: [],
      wave,
      assigned_to: assignedTo,
      agent: 'developer',
      labels: ['auto-decomposed'],
    };

    sprint.plan.tasks.push(task);
    sprint.tasks.set(newId, {
      taskId: newId,
      status: 'pending',
      developerId: assignedTo,
    });
    newTasks.push(task);
  }

  // Persist updated plan to disk
  const planFile = path.join(getSprintDir(sprintId), 'plan.json');
  fs.writeFileSync(planFile, JSON.stringify(sprint.plan, null, 2));

  log.info(`Added ${newTasks.length} subtasks for task ${parentTaskId} in sprint ${sprintId}`, {
    newIds: newTasks.map((t) => t.id),
  });

  return newTasks;
}

// --- Bug Task Injection ---

/**
 * Create individual bug tasks from review findings.
 * Each finding becomes its own tracked task, round-robin assigned to available developers.
 */
export function addBugTasks(
  sprintId: string,
  reviewCycle: number,
  findings: { id: string; category: string; location: string; description: string }[],
): Task[] {
  const sprint = getSprintOrThrow(sprintId);
  if (!sprint.plan) throw new Error(`No plan found for sprint ${sprintId}`);

  const maxId = Math.max(...sprint.plan.tasks.map((t) => t.id), 0);
  const developerIds = sprint.developers.map((d) => d.id);
  const newTasks: Task[] = [];

  for (let i = 0; i < findings.length; i++) {
    const finding = findings[i];
    const newId = maxId + 1 + i;
    const developerId = developerIds[i % developerIds.length];

    const task: Task = {
      id: newId,
      title: `Fix: ${finding.description.slice(0, 80)}`,
      description: `**${finding.category.toUpperCase()}** at ${finding.location}\n\n${finding.description}`,
      type: 'bug',
      reviewCycle,
      agent: 'developer',
      depends_on: [],
      labels: ['bug', finding.category],
      assigned_to: developerId,
    };

    sprint.plan.tasks.push(task);
    sprint.tasks.set(newId, {
      taskId: newId,
      status: 'pending',
      developerId,
    });
    newTasks.push(task);
  }

  // Persist updated plan to disk
  const planFile = path.join(getSprintDir(sprintId), 'plan.json');
  fs.writeFileSync(planFile, JSON.stringify(sprint.plan, null, 2));

  log.info(`Added ${newTasks.length} bug tasks for review cycle ${reviewCycle} in sprint ${sprintId}`, {
    newIds: newTasks.map((t) => t.id),
  });

  return newTasks;
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
 * Scans both the global SPRINTS_DIR and each app's {rootFolder}/sprints/ dir.
 */
export function loadActiveSprintsFromDisk(): number {
  const activeStatuses = new Set(['running', 'researching', 'planning', 'awaiting-approval', 'approved', 'reviewing', 'paused']);
  let loaded = 0;

  // Collect sprint directories from all locations
  const sprintScanDirs: string[] = [];
  if (fs.existsSync(SPRINTS_DIR)) sprintScanDirs.push(SPRINTS_DIR);
  for (const rootFolder of appRootFolders) {
    const appSprintsDir = path.join(rootFolder, 'sprints');
    if (fs.existsSync(appSprintsDir)) sprintScanDirs.push(appSprintsDir);
  }

  for (const scanDir of sprintScanDirs) {
    const dirs = fs.readdirSync(scanDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('sprint-'));

    for (const dir of dirs) {
      const sprintId = dir.name;
      if (sprints.has(sprintId)) continue;

      // Register the directory
      const sprintDir = path.join(scanDir, sprintId);
      if (!sprintDirRegistry.has(sprintId)) {
        registerSprintDir(sprintId, sprintDir);
      }

      const status = readStatus(sprintId);
      if (activeStatuses.has(status)) {
        const result = loadSprintFromDisk(sprintId);
        if (result) {
          loaded++;
          log.info(`Auto-loaded sprint ${sprintId} (status: ${status})`);
        }
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
  const sprintDir = getSprintDir(sprintId);
  if (!fs.existsSync(sprintDir)) return null;

  const status = readStatus(sprintId);
  const plan = readPlan(sprintId);
  const costs = readCosts(sprintId);
  const completedTasks = readCompleted(sprintId);
  const meta = readMeta(sprintId);

  const resolvedTargetDir = targetDir || meta?.targetDir || '';

  const state: SprintState = {
    id: sprintId,
    name: meta?.name,
    status,
    plan,
    tasks: new Map(),
    developers: DEVELOPER_POOL.slice(0, plan?.developer_count || meta?.developerCount || DEFAULT_DEVELOPER_COUNT).map((i) => ({ ...i })),
    currentWave: 0,
    reviewCycle: 0,
    worktreePaths: new Map(),
    pendingApprovals: new Map(),
    costs,
    targetDir: resolvedTargetDir,
    specPath: plan?.spec || meta?.specPath || '',
    autonomyMode: meta?.autonomyMode || 'supervised',
    createdAt: meta?.createdAt || '',
    approvedAt: meta?.approvedAt,
  };

  if (plan) {
    for (const task of plan.tasks) {
      state.tasks.set(task.id, {
        taskId: task.id,
        status: completedTasks.has(task.id) ? 'completed' : 'pending',
        developerId: task.assigned_to,
      });
    }
  }

  sprints.set(sprintId, state);
  return state;
}

// --- File Helpers ---

function readPrUrl(sprintId: string): string | undefined {
  const file = path.join(getSprintDir(sprintId), '.pr-url');
  if (!fs.existsSync(file)) return undefined;
  try {
    return fs.readFileSync(file, 'utf-8').trim() || undefined;
  } catch {
    return undefined;
  }
}

function writeStatus(sprintId: string, status: string): void {
  const file = path.join(getSprintDir(sprintId), '.status');
  fs.writeFileSync(file, status);
}

function readStatus(sprintId: string): SprintStatus {
  const file = path.join(getSprintDir(sprintId), '.status');
  if (!fs.existsSync(file)) return 'created';
  return fs.readFileSync(file, 'utf-8').trim() as SprintStatus;
}

function readPlan(sprintId: string): Plan | null {
  const file = path.join(getSprintDir(sprintId), 'plan.json');
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
  const file = path.join(getSprintDir(sprintId), 'cost.json');
  if (!fs.existsSync(file)) return { total: 0, by_agent: {}, by_task: {} };
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return { total: 0, by_agent: {}, by_task: {} };
  }
}

function appendCompleted(sprintId: string, taskId: number): void {
  const file = path.join(getSprintDir(sprintId), '.completed');
  fs.appendFileSync(file, `${taskId}\n`);
}

function readCompleted(sprintId: string): Set<number> {
  const file = path.join(getSprintDir(sprintId), '.completed');
  if (!fs.existsSync(file)) return new Set();
  const lines = fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean);
  return new Set(lines.map(Number));
}

function removeFromCompleted(sprintId: string, taskId: number): void {
  const file = path.join(getSprintDir(sprintId), '.completed');
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
  const sprintDir = getSprintDir(sprintId);
  if (!fs.existsSync(sprintDir)) {
    throw new Error(`Sprint not found: ${sprintId}`);
  }

  const status = readStatus(sprintId);
  const plan = readPlan(sprintId);
  const costs = readCosts(sprintId);
  const completed = readCompleted(sprintId);
  const meta = readMeta(sprintId);

  const developerCount = plan?.developer_count || meta?.developerCount || DEFAULT_DEVELOPER_COUNT;
  const developers = DEVELOPER_POOL.slice(0, developerCount).map((i) => ({ ...i }));

  const tasks: TaskState[] = [];
  if (plan) {
    for (const task of plan.tasks) {
      tasks.push({
        taskId: task.id,
        status: completed.has(task.id) ? 'completed' : 'pending',
        developerId: task.assigned_to,
      });
    }
  }

  return {
    id: sprintId,
    name: meta?.name,
    status,
    spec: plan?.spec || meta?.specPath,
    taskCount: plan?.tasks.length,
    completedCount: completed.size,
    developerCount,
    approvedAt: meta?.approvedAt,
    plan,
    tasks,
    developers,
    currentWave: 0,
    reviewCycle: 0,
    costs,
    autonomyMode: meta?.autonomyMode,
  };
}

function loadSprintSummaryFromDisk(sprintId: string): SprintSummary {
  const status = readStatus(sprintId);
  const plan = readPlan(sprintId);
  const completed = readCompleted(sprintId);
  const meta = readMeta(sprintId);

  return {
    id: sprintId,
    name: meta?.name,
    status,
    spec: plan?.spec,
    taskCount: plan?.tasks.length,
    completedCount: completed.size,
    developerCount: plan?.developer_count || DEFAULT_DEVELOPER_COUNT,
    createdAt: meta?.createdAt,
    approvedAt: meta?.approvedAt,
    targetDir: meta?.targetDir,
    autonomyMode: meta?.autonomyMode,
  };
}

interface SprintMeta {
  targetDir: string;
  specPath: string;
  developerCount: number;
  createdAt: string;
  approvedAt?: string;
  name?: string;
  autonomyMode?: AutonomyMode;
}

function writeMeta(sprintId: string, meta: SprintMeta): void {
  const file = path.join(getSprintDir(sprintId), '.meta.json');
  fs.writeFileSync(file, JSON.stringify(meta, null, 2));
}

function readMeta(sprintId: string): SprintMeta | null {
  const file = path.join(getSprintDir(sprintId), '.meta.json');
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
    name: state.name,
    status: state.status,
    spec: state.plan?.spec,
    taskCount: state.plan?.tasks.length,
    completedCount,
    developerCount: state.developers.length,
    createdAt: state.createdAt,
    approvedAt: state.approvedAt,
    targetDir: state.targetDir,
    autonomyMode: state.autonomyMode,
  };
}
