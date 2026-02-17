// App data hooks

import { useState, useEffect, useCallback } from 'react';
import type { AppWithSprints, App, AutonomyMode } from '@shared/types.js';

const API_BASE = '/api';

export function useApps() {
  const [apps, setApps] = useState<AppWithSprints[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/apps`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setApps(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch apps');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { apps, loading, error, refresh };
}

export async function createAppOnly(name: string, rootFolder: string): Promise<App> {
  const res = await fetch(`${API_BASE}/apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, rootFolder }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function reorderApps(orderedIds: string[]): Promise<void> {
  const res = await fetch(`${API_BASE}/apps/reorder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderedIds }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
}

export async function removeApp(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/apps/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
}

export async function createAppWithSprint(
  name: string,
  rootFolder: string,
  specPath: string,
  developerCount = 2,
  autonomyMode?: AutonomyMode,
  sprintName?: string,
): Promise<{ app: App; sprint: { id: string; status: string } }> {
  const res = await fetch(`${API_BASE}/apps/with-sprint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, rootFolder, specPath, developerCount, autonomyMode, sprintName }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}
