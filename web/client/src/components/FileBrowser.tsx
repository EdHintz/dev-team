import { useState, useEffect, useCallback } from 'react';

interface BrowseEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface BrowseResult {
  current: string;
  parent: string;
  entries: BrowseEntry[];
}

interface FileBrowserProps {
  /** Initial directory to open */
  startDir?: string;
  /** File extension filter, e.g. ".md" */
  filter?: string;
  /** Whether to select files (true) or directories (false) */
  selectFiles?: boolean;
  /** Called when user picks a path */
  onSelect: (path: string) => void;
  /** Called when user closes the browser */
  onClose: () => void;
}

export function FileBrowser({ startDir, filter, selectFiles = true, onSelect, onClose }: FileBrowserProps) {
  const [dir, setDir] = useState(startDir || '');
  const [entries, setEntries] = useState<BrowseEntry[]>([]);
  const [current, setCurrent] = useState('');
  const [parent, setParent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const browse = useCallback(async (targetDir: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (targetDir) params.set('dir', targetDir);
      if (filter) params.set('filter', filter);
      const res = await fetch(`/api/system/browse?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data: BrowseResult = await res.json();
      setCurrent(data.current);
      setParent(data.parent);
      setEntries(data.entries);
      setDir(data.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Browse failed');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    browse(dir);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEntryClick = (entry: BrowseEntry) => {
    if (entry.isDirectory) {
      browse(entry.path);
    } else if (selectFiles) {
      onSelect(entry.path);
    }
  };

  return (
    <div className="border border-gray-700 rounded-lg bg-gray-950 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-900 border-b border-gray-800">
        <div className="text-xs text-gray-400 truncate flex-1 mr-2" title={current}>
          {current}
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-sm px-1">
          &times;
        </button>
      </div>

      {error && <div className="text-red-400 text-xs px-3 py-2">{error}</div>}

      <div className="max-h-48 overflow-y-auto">
        {loading && <div className="text-gray-500 text-xs px-3 py-2">Loading...</div>}

        {!loading && current !== parent && (
          <button
            onClick={() => browse(parent)}
            className="w-full text-left px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-800 flex items-center gap-2"
          >
            <span className="text-gray-600">..</span>
            <span className="text-xs text-gray-600">(up)</span>
          </button>
        )}

        {!loading && entries.map((entry) => (
          <button
            key={entry.path}
            onClick={() => handleEntryClick(entry)}
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-800 flex items-center gap-2"
          >
            <span className={entry.isDirectory ? 'text-blue-400' : 'text-gray-300'}>
              {entry.isDirectory ? '\uD83D\uDCC1' : '\uD83D\uDCC4'}
            </span>
            <span className={entry.isDirectory ? 'text-blue-300' : 'text-gray-200'}>
              {entry.name}
            </span>
          </button>
        ))}

        {!loading && entries.length === 0 && (
          <div className="text-gray-600 text-xs px-3 py-2">Empty directory</div>
        )}
      </div>

      {!selectFiles && (
        <div className="border-t border-gray-800 px-3 py-2">
          <button
            onClick={() => onSelect(current)}
            className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-500"
          >
            Select this folder
          </button>
        </div>
      )}
    </div>
  );
}
