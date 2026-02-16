// Central configuration for the dev-team web orchestrator
// Ported from scripts/lib/config.sh

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { AutonomyMode } from '../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Paths ---
// The web/ directory lives inside the dev-team repo
export const WEB_DIR = path.resolve(__dirname, '..');
export const PROJECT_ROOT = path.resolve(WEB_DIR, '..');
export const SCRIPTS_DIR = path.join(PROJECT_ROOT, 'scripts');
export const AGENTS_DIR = path.join(PROJECT_ROOT, '.claude', 'agents');
export const SPRINTS_DIR = path.join(PROJECT_ROOT, 'sprints');
export const SPECS_DIR = path.join(PROJECT_ROOT, 'specs');
export const DATA_DIR = path.join(PROJECT_ROOT, 'data');

// --- Server ---
export const WEB_PORT = parseInt(process.env.WEB_PORT || '4000', 10);
export const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// --- Autonomy Mode ---
export const AUTONOMY_MODE: AutonomyMode =
  (process.env.AUTONOMY_MODE as AutonomyMode) || 'supervised';

// --- Budget Defaults (USD) ---
export const BUDGETS = {
  plan: parseFloat(process.env.DEFAULT_PLAN_BUDGET || '3.00'),
  research: parseFloat(process.env.DEFAULT_RESEARCH_BUDGET || '1.50'),
  task: parseFloat(process.env.DEFAULT_TASK_BUDGET || '6.00'),
  review: parseFloat(process.env.DEFAULT_REVIEW_BUDGET || '3.00'),
  test: parseFloat(process.env.DEFAULT_TEST_BUDGET || '3.00'),
} as const;

// --- Model Selection ---
export const MODELS = {
  planner: process.env.PLANNER_MODEL || 'opus',
  developer: process.env.DEVELOPER_MODEL || 'opus',
  reviewer: process.env.REVIEWER_MODEL || 'opus',
  researcher: process.env.RESEARCHER_MODEL || 'opus',
  tester: process.env.TESTER_MODEL || 'opus',
} as const;

export type AgentName = keyof typeof MODELS;

export function getModelForAgent(agent: string): string {
  return MODELS[agent as AgentName] || 'sonnet';
}

// --- Limits ---
export const MAX_FIX_CYCLES = parseInt(process.env.MAX_FIX_CYCLES || '3', 10);
export const DEFAULT_DEVELOPER_COUNT = parseInt(process.env.DEVELOPER_COUNT || '2', 10);

// --- Developer Identities ---
export const DEVELOPER_POOL = [
  { id: 'developer-1', name: 'Sage', avatar: '/avatars/sage.svg', color: '#10B981' },
  { id: 'developer-2', name: 'Atlas', avatar: '/avatars/atlas.svg', color: '#3B82F6' },
  { id: 'developer-3', name: 'Bolt', avatar: '/avatars/bolt.svg', color: '#F59E0B' },
  { id: 'developer-4', name: 'Nova', avatar: '/avatars/nova.svg', color: '#8B5CF6' },
  { id: 'developer-5', name: 'Flux', avatar: '/avatars/flux.svg', color: '#EF4444' },
] as const;

// --- Autonomy Helpers ---

export function needsApproval(stepType: 'plan' | 'task' | 'commit' | 'pr'): boolean {
  switch (AUTONOMY_MODE) {
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

// --- GitHub ---
export const GH_ORG = process.env.GH_ORG || '';
export const PROJECT_BOARD_NAME = process.env.PROJECT_BOARD_NAME || 'Dev Team Sprints';

// --- Sprint ID Generation ---
export function generateSprintId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = Math.random().toString(16).slice(2, 6);
  return `sprint-${date}-${suffix}`;
}
