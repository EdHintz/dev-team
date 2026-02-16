import { useEffect, useRef, useCallback } from 'react';

interface LogViewerProps {
  lines: string[];
  maxHeight?: string;
}

export function LogViewer({ lines, maxHeight = '300px' }: LogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    // Consider "near bottom" if within 40px of the bottom
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !isNearBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="bg-gray-950 border border-gray-800 rounded p-3 overflow-y-auto font-mono text-xs text-gray-400"
      style={{ maxHeight }}
    >
      {lines.length === 0 && (
        <span className="text-gray-600">Waiting for output...</span>
      )}
      {lines.map((line, i) => (
        <div key={i} className="whitespace-pre-wrap break-all leading-relaxed">
          {line}
        </div>
      ))}
    </div>
  );
}
