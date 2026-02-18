// Sprint data hooks

import { useState, useEffect, useCallback } from 'react';
import type { SprintSummary, SprintDetail, AutonomyMode } from '@shared/types.js';

const API_BASE = '/api';

export function useSprints() {
  const [sprints, setSprints] = useState<SprintSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/sprints`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSprints(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch sprints');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { sprints, loading, error, refresh };
}

export function useSprintDetail(sprintId: string | undefined) {
  const [sprint, setSprint] = useState<SprintDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!sprintId) return;
    try {
      const res = await fetch(`${API_BASE}/sprints/${sprintId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSprint(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch sprint');
    } finally {
      setLoading(false);
    }
  }, [sprintId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { sprint, loading, error, refresh, setSprint };
}

export async function createSprint(specPath: string, targetDir: string, developerCount = 2, autonomyMode?: AutonomyMode, name?: string): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE}/sprints`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ specPath, targetDir, developerCount, autonomyMode, name }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function startSprint(sprintId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/sprints/${sprintId}/start`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
}

export async function approveSprint(sprintId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/sprints/${sprintId}/approve`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
}

export async function cancelSprint(sprintId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/sprints/${sprintId}/cancel`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
}

export async function pauseSprint(sprintId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/sprints/${sprintId}/pause`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
}

export async function resumeSprint(sprintId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/sprints/${sprintId}/resume`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
}

export async function restartSprint(sprintId: string, targetDir?: string): Promise<{ pendingTaskIds: number[] }> {
  const res = await fetch(`${API_BASE}/sprints/${sprintId}/restart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetDir }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function retryTask(sprintId: string, taskId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/tasks/${sprintId}/${taskId}/retry`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
}

export async function completeSprint(sprintId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/sprints/${sprintId}/complete`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
}

export async function mergeSprintLocal(sprintId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/sprints/${sprintId}/merge-local`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
}
