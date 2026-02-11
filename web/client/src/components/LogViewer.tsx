import { useEffect, useRef } from 'react';

interface LogViewerProps {
  lines: string[];
  maxHeight?: string;
}

export function LogViewer({ lines, maxHeight = '300px' }: LogViewerProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines.length]);

  return (
    <div
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
      <div ref={bottomRef} />
    </div>
  );
}
