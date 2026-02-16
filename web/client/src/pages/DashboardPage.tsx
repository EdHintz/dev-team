import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApps, createAppWithSprint } from '../hooks/use-apps.js';
import { createSprint, startSprint } from '../hooks/use-sprint.js';
import { SprintStatusBadge } from '../components/StatusBadge.js';
import { FileBrowser } from '../components/FileBrowser.js';
import type { AppWithSprints, AutonomyMode } from '@shared/types.js';

// --- Autonomy Mode Selector ---

const AUTONOMY_OPTIONS: { value: AutonomyMode; label: string; description: string }[] = [
  {
    value: 'supervised',
    label: 'Supervised',
    description: 'Approve plan, review results, and PR before each phase proceeds',
  },
  {
    value: 'semi-auto',
    label: 'Semi-Auto',
    description: 'Runs implementation autonomously; approve before commit and PR',
  },
  {
    value: 'full-auto',
    label: 'Full Auto',
    description: 'Runs entire sprint end-to-end without pausing for approval',
  },
];

function AutonomyModeSelector({ value, onChange }: { value: AutonomyMode; onChange: (mode: AutonomyMode) => void }) {
  return (
    <div>
      <label className="block text-sm text-gray-400 mb-2">Oversight Mode</label>
      <div className="space-y-2">
        {AUTONOMY_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={`flex items-start gap-3 p-2.5 rounded border cursor-pointer transition ${
              value === opt.value
                ? 'border-blue-500/50 bg-blue-950/30'
                : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
            }`}
          >
            <input
              type="radio"
              name="autonomyMode"
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
              className="mt-0.5 accent-blue-500"
            />
            <div>
              <div className="text-sm text-gray-200">
                {opt.label}
                {opt.value === 'supervised' && (
                  <span className="text-xs text-gray-500 ml-1.5">(recommended)</span>
                )}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{opt.description}</div>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

// --- New App Form ---

function NewAppForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [rootFolder, setRootFolder] = useState('');
  const [specPath, setSpecPath] = useState('');
  const [devCount, setImplCount] = useState(2);
  const [autonomyMode, setAutonomyMode] = useState<AutonomyMode>('supervised');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSpecBrowser, setShowSpecBrowser] = useState(false);
  const [showDirBrowser, setShowDirBrowser] = useState(false);

  const handleCreate = async () => {
    if (!name || !rootFolder || !specPath) return;
    setCreating(true);
    setError(null);
    try {
      const { sprint } = await createAppWithSprint(name, rootFolder, specPath, devCount, autonomyMode);
      onCreated();
      navigate(`/sprint/${sprint.id}/planning`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create app');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="border border-gray-800 rounded-lg p-4 mb-6 bg-gray-900">
      <h2 className="text-lg font-medium text-white mb-4">New App + Sprint</h2>
      <div className="space-y-3">
        <div>
          <label className="block text-sm text-gray-400 mb-1">App name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Project"
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Root folder</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={rootFolder}
              onChange={(e) => setRootFolder(e.target.value)}
              placeholder="/path/to/project"
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600"
            />
            <button
              type="button"
              onClick={() => { setShowDirBrowser(!showDirBrowser); setShowSpecBrowser(false); }}
              className="px-3 py-2 bg-gray-700 text-gray-300 rounded hover:bg-gray-600 text-sm"
            >
              Browse
            </button>
          </div>
          {showDirBrowser && (
            <div className="mt-2">
              <FileBrowser
                startDir={rootFolder || undefined}
                selectFiles={false}
                onSelect={(p) => { setRootFolder(p); setShowDirBrowser(false); }}
                onClose={() => setShowDirBrowser(false)}
              />
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Spec file</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={specPath}
              onChange={(e) => setSpecPath(e.target.value)}
              placeholder="/path/to/spec.md"
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600"
            />
            <button
              type="button"
              onClick={() => { setShowSpecBrowser(!showSpecBrowser); setShowDirBrowser(false); }}
              className="px-3 py-2 bg-gray-700 text-gray-300 rounded hover:bg-gray-600 text-sm"
            >
              Browse
            </button>
          </div>
          {showSpecBrowser && (
            <div className="mt-2">
              <FileBrowser
                filter=".md"
                selectFiles
                onSelect={(p) => { setSpecPath(p); setShowSpecBrowser(false); }}
                onClose={() => setShowSpecBrowser(false)}
              />
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Developers</label>
          <select
            value={devCount}
            onChange={(e) => setImplCount(Number(e.target.value))}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{n} developer{n > 1 ? 's' : ''}</option>
            ))}
          </select>
        </div>

        <AutonomyModeSelector value={autonomyMode} onChange={setAutonomyMode} />

        {error && <div className="text-red-400 text-sm">{error}</div>}

        <div className="flex gap-3">
          <button
            onClick={handleCreate}
            disabled={creating || !name || !rootFolder || !specPath}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-500 text-sm disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create & Start Planning'}
          </button>
          <button onClick={onCancel} className="px-4 py-2 bg-gray-800 text-gray-300 rounded hover:bg-gray-700 text-sm">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// --- New Sprint Form (on existing app) ---

function NewSprintForm({ app, onCreated, onCancel }: { app: AppWithSprints; onCreated: () => void; onCancel: () => void }) {
  const navigate = useNavigate();
  const [specPath, setSpecPath] = useState('');
  const [devCount, setImplCount] = useState(2);
  const [autonomyMode, setAutonomyMode] = useState<AutonomyMode>('supervised');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSpecBrowser, setShowSpecBrowser] = useState(false);

  const handleCreate = async () => {
    if (!specPath) return;
    setCreating(true);
    setError(null);
    try {
      const { id } = await createSprint(specPath, app.rootFolder, devCount, autonomyMode);
      await startSprint(id);
      onCreated();
      navigate(`/sprint/${id}/planning`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create sprint');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="border border-gray-700 rounded p-3 mt-3 bg-gray-800/50">
      <h3 className="text-sm font-medium text-gray-300 mb-3">New Sprint for {app.name}</h3>
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Root folder (from app)</label>
          <div className="text-sm text-gray-400 bg-gray-800 rounded px-3 py-2 border border-gray-700">
            {app.rootFolder}
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Spec file</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={specPath}
              onChange={(e) => setSpecPath(e.target.value)}
              placeholder="/path/to/spec.md"
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600"
            />
            <button
              type="button"
              onClick={() => setShowSpecBrowser(!showSpecBrowser)}
              className="px-3 py-2 bg-gray-700 text-gray-300 rounded hover:bg-gray-600 text-sm"
            >
              Browse
            </button>
          </div>
          {showSpecBrowser && (
            <div className="mt-2">
              <FileBrowser
                filter=".md"
                selectFiles
                onSelect={(p) => { setSpecPath(p); setShowSpecBrowser(false); }}
                onClose={() => setShowSpecBrowser(false)}
              />
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Developers</label>
          <select
            value={devCount}
            onChange={(e) => setImplCount(Number(e.target.value))}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{n} developer{n > 1 ? 's' : ''}</option>
            ))}
          </select>
        </div>

        <AutonomyModeSelector value={autonomyMode} onChange={setAutonomyMode} />

        {error && <div className="text-red-400 text-sm">{error}</div>}

        <div className="flex gap-3">
          <button
            onClick={handleCreate}
            disabled={creating || !specPath}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-500 text-sm disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create & Start Planning'}
          </button>
          <button onClick={onCancel} className="px-4 py-2 bg-gray-800 text-gray-300 rounded hover:bg-gray-700 text-sm">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// --- App Card ---

function AppCard({ app, onRefresh }: { app: AppWithSprints; onRefresh: () => void }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(app.sprints.length > 0);
  const [showNewSprint, setShowNewSprint] = useState(false);

  const navigateToSprint = (id: string, status: string) => {
    if (status === 'awaiting-approval' || status === 'researching' || status === 'planning') {
      navigate(`/sprint/${id}/planning`);
    } else {
      navigate(`/sprint/${id}`);
    }
  };

  const activeSprints = app.sprints.filter((s) => !['completed', 'failed', 'cancelled'].includes(s.status));
  const doneSprints = app.sprints.filter((s) => ['completed', 'failed', 'cancelled'].includes(s.status));

  return (
    <div className="border border-gray-800 rounded-lg bg-gray-900/50 overflow-hidden">
      {/* Card header */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-800/30 transition"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <span className="text-gray-500 text-sm">{expanded ? '\u25BC' : '\u25B6'}</span>
          <div>
            <div className="font-medium text-white">{app.name}</div>
            <div className="text-xs text-gray-500 mt-0.5">{app.rootFolder}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            {app.sprints.length} sprint{app.sprints.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); setShowNewSprint(true); setExpanded(true); }}
            className="px-3 py-1 bg-blue-600/80 text-white rounded hover:bg-blue-500 text-xs"
          >
            New Sprint
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-gray-800 px-4 pb-4">
          {showNewSprint && (
            <NewSprintForm
              app={app}
              onCreated={onRefresh}
              onCancel={() => setShowNewSprint(false)}
            />
          )}

          {app.sprints.length === 0 && !showNewSprint && (
            <div className="text-gray-600 text-sm py-4 text-center">
              No sprints yet. Click "New Sprint" to start.
            </div>
          )}

          {/* Active sprints */}
          {activeSprints.length > 0 && (
            <div className="mt-3 space-y-1">
              {activeSprints.map((sprint) => (
                <div
                  key={sprint.id}
                  onClick={() => navigateToSprint(sprint.id, sprint.status)}
                  className="flex items-center justify-between px-3 py-2 rounded hover:bg-gray-800 cursor-pointer transition"
                >
                  <div>
                    <span className="text-sm text-gray-200">{sprint.id}</span>
                    {sprint.spec && (
                      <span className="text-xs text-gray-600 ml-2">{sprint.spec}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {sprint.taskCount !== undefined && (
                      <span className="text-xs text-gray-500">
                        {sprint.completedCount || 0}/{sprint.taskCount} tasks
                      </span>
                    )}
                    <SprintStatusBadge status={sprint.status} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Completed/failed sprints */}
          {doneSprints.length > 0 && (
            <div className="mt-2 space-y-1">
              {activeSprints.length > 0 && doneSprints.length > 0 && (
                <div className="text-xs text-gray-600 mt-3 mb-1">Previous</div>
              )}
              {doneSprints.map((sprint) => (
                <div
                  key={sprint.id}
                  onClick={() => navigateToSprint(sprint.id, sprint.status)}
                  className="flex items-center justify-between px-3 py-2 rounded hover:bg-gray-800 cursor-pointer transition opacity-60"
                >
                  <div>
                    <span className="text-sm text-gray-300">{sprint.id}</span>
                    {sprint.spec && (
                      <span className="text-xs text-gray-600 ml-2">{sprint.spec}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {sprint.taskCount !== undefined && (
                      <span className="text-xs text-gray-500">
                        {sprint.completedCount || 0}/{sprint.taskCount} tasks
                      </span>
                    )}
                    <SprintStatusBadge status={sprint.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Dashboard Page ---

export function DashboardPage() {
  const { apps, loading, error, refresh } = useApps();
  const [showNewApp, setShowNewApp] = useState(false);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Apps</h1>
        <button
          onClick={() => setShowNewApp(!showNewApp)}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500 text-sm"
        >
          New App
        </button>
      </div>

      {showNewApp && (
        <NewAppForm
          onCreated={() => { refresh(); setShowNewApp(false); }}
          onCancel={() => setShowNewApp(false)}
        />
      )}

      {loading && <div className="text-gray-500">Loading apps...</div>}
      {error && <div className="text-red-400">Error: {error}</div>}

      {apps.length === 0 && !loading && (
        <div className="text-gray-600 text-center py-12">
          No apps yet. Create one to get started.
        </div>
      )}

      <div className="space-y-3">
        {apps.map((app) => (
          <AppCard key={app.id} app={app} onRefresh={refresh} />
        ))}
      </div>
    </div>
  );
}
