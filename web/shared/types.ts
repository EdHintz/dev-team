// Types shared between server and client

// --- Sprint ---

export type SprintStatus =
  | 'created'
  | 'researching'
  | 'planning'
  | 'awaiting-approval'
  | 'approved'
  | 'running'
  | 'paused'
  | 'reviewing'
  | 'pr-created'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'in-progress'
  | 'completed'
  | 'failed'
  | 'blocked';

export type AutonomyMode = 'supervised' | 'semi-auto' | 'full-auto';

export interface Task {
  id: number;
  title: string;
  description: string;
  agent?: 'implementer' | 'tester';
  depends_on: number[];
  complexity?: 'small' | 'medium' | 'large';
  labels?: string[];
  acceptance_criteria?: string[];
  assigned_to?: string;
  files_touched?: string[];
  wave?: number;
}

export interface Plan {
  sprint_id: string;
  spec: string;
  implementer_count?: number;
  tasks: Task[];
}

export interface TaskState {
  taskId: number;
  status: TaskStatus;
  implementerId?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface CostEntry {
  agent: string;
  task: string;
  duration_seconds: number;
}

export interface CostData {
  total: number;
  by_agent: Record<string, number>;
  by_task: Record<string, number>;
  sessions?: CostEntry[];
}

export interface SprintSummary {
  id: string;
  status: SprintStatus;
  spec?: string;
  taskCount?: number;
  completedCount?: number;
  implementerCount?: number;
  createdAt?: string;
}

export interface SprintDetail extends SprintSummary {
  plan: Plan | null;
  tasks: TaskState[];
  implementers: ImplementerIdentity[];
  currentWave: number;
  costs: CostData;
}

// --- Implementer ---

export interface ImplementerIdentity {
  id: string;
  name: string;
  avatar: string;
  color: string;
}

// --- WebSocket Events ---

export type ServerEvent =
  | { type: 'sprint:status'; sprintId: string; status: SprintStatus }
  | { type: 'task:status'; sprintId: string; taskId: number; status: TaskStatus; implementerId?: string }
  | { type: 'task:log'; sprintId: string; taskId: number; implementerId: string; line: string }
  | { type: 'wave:started'; sprintId: string; wave: number; taskIds: number[] }
  | { type: 'wave:completed'; sprintId: string; wave: number }
  | { type: 'merge:started'; sprintId: string; implementerId: string }
  | { type: 'merge:completed'; sprintId: string; implementerId: string; success: boolean; conflicts?: string[] }
  | { type: 'approval:required'; id: string; sprintId: string; message: string; context?: unknown }
  | { type: 'review:update'; sprintId: string; cycle: number; status: string; findings?: unknown }
  | { type: 'cost:update'; sprintId: string; costs: CostData }
  | { type: 'error'; sprintId: string; message: string; details?: unknown };

export type ClientEvent =
  | { type: 'approval:response'; id: string; approved: boolean; comment?: string }
  | { type: 'sprint:start'; specPath: string; targetDir: string; implementerCount?: number }
  | { type: 'sprint:approve'; sprintId: string }
  | { type: 'sprint:cancel'; sprintId: string }
  | { type: 'task:retry'; sprintId: string; taskId: number };

// --- API Request/Response ---

export interface CreateSprintRequest {
  specPath: string;
  targetDir: string;
  implementerCount?: number;
  sprintId?: string;
}

export interface ApproveSprintRequest {
  sprintId: string;
}
