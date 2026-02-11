import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSprints, createSprint, startSprint } from '../hooks/use-sprint.js';
import { SprintStatusBadge } from '../components/StatusBadge.js';

export function DashboardPage() {
  const { sprints, loading, error, refresh } = useSprints();
  const navigate = useNavigate();

  const [showNew, setShowNew] = useState(false);
  const [specPath, setSpecPath] = useState('');
  const [targetDir, setTargetDir] = useState('');
  const [implCount, setImplCount] = useState(2);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!specPath || !targetDir) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { id } = await createSprint(specPath, targetDir, implCount);
      await startSprint(id);
      refresh();
      navigate(`/sprint/${id}/planning`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create sprint');
    } finally {
      setCreating(false);
    }
  };

  const navigateToSprint = (id: string, status: string) => {
    if (status === 'awaiting-approval' || status === 'researching' || status === 'planning') {
      navigate(`/sprint/${id}/planning`);
    } else if (status === 'reviewing') {
      navigate(`/sprint/${id}/review`);
    } else {
      navigate(`/sprint/${id}`);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Sprints</h1>
        <button
          onClick={() => setShowNew(!showNew)}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500 text-sm"
        >
          New Sprint
        </button>
      </div>

      {showNew && (
        <div className="border border-gray-800 rounded-lg p-4 mb-6 bg-gray-900">
          <h2 className="text-lg font-medium text-white mb-4">Create New Sprint</h2>

          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Spec file path</label>
              <input
                type="text"
                value={specPath}
                onChange={(e) => setSpecPath(e.target.value)}
                placeholder="/path/to/spec.md"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Target project directory</label>
              <input
                type="text"
                value={targetDir}
                onChange={(e) => setTargetDir(e.target.value)}
                placeholder="/path/to/project"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Implementers</label>
              <select
                value={implCount}
                onChange={(e) => setImplCount(Number(e.target.value))}
                className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>{n} implementer{n > 1 ? 's' : ''}</option>
                ))}
              </select>
            </div>

            {createError && (
              <div className="text-red-400 text-sm">{createError}</div>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleCreate}
                disabled={creating || !specPath || !targetDir}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-500 text-sm disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create & Start Planning'}
              </button>
              <button
                onClick={() => setShowNew(false)}
                className="px-4 py-2 bg-gray-800 text-gray-300 rounded hover:bg-gray-700 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && <div className="text-gray-500">Loading sprints...</div>}
      {error && <div className="text-red-400">Error: {error}</div>}

      {sprints.length === 0 && !loading && (
        <div className="text-gray-600 text-center py-12">
          No sprints yet. Create one to get started.
        </div>
      )}

      <div className="space-y-2">
        {sprints.map((sprint) => (
          <div
            key={sprint.id}
            onClick={() => navigateToSprint(sprint.id, sprint.status)}
            className="border border-gray-800 rounded-lg p-4 hover:border-gray-700 cursor-pointer transition"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-white">{sprint.id}</div>
                {sprint.spec && (
                  <div className="text-xs text-gray-500 mt-1">{sprint.spec}</div>
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
          </div>
        ))}
      </div>
    </div>
  );
}
