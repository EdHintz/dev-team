import { useState } from 'react';

interface ReviewFinding {
  id: string;
  category: 'must-fix' | 'should-fix' | 'nitpick';
  location: string;
  description: string;
}

interface ApprovalDialogProps {
  message: string;
  context?: unknown;
  onApprove: (comment?: string, data?: unknown) => void;
  onReject: (comment?: string) => void;
}

const CATEGORY_CONFIG = {
  'must-fix': { label: 'MUST-FIX', color: 'text-red-400', border: 'border-red-800', bg: 'bg-red-950' },
  'should-fix': { label: 'SHOULD-FIX', color: 'text-yellow-400', border: 'border-yellow-800', bg: 'bg-yellow-950' },
  'nitpick': { label: 'NITPICK', color: 'text-blue-400', border: 'border-blue-800', bg: 'bg-blue-950' },
} as const;

export function ApprovalDialog({ message, context, onApprove, onReject }: ApprovalDialogProps) {
  const [comment, setComment] = useState('');

  const findings = extractFindings(context);

  if (findings.length > 0) {
    return (
      <FindingsApprovalDialog
        message={message}
        findings={findings}
        comment={comment}
        onCommentChange={setComment}
        onApprove={onApprove}
        onReject={onReject}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-lg w-full mx-4">
        <h3 className="text-lg font-medium text-white mb-3">Approval Required</h3>
        <p className="text-gray-300 text-sm mb-4">{message}</p>

        <textarea
          className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-gray-200 mb-4 placeholder-gray-600"
          rows={2}
          placeholder="Optional comment..."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />

        <div className="flex gap-3 justify-end">
          <button
            onClick={() => onReject(comment || undefined)}
            className="px-4 py-2 bg-gray-800 text-gray-300 rounded hover:bg-gray-700 text-sm"
          >
            Reject
          </button>
          <button
            onClick={() => onApprove(comment || undefined)}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500 text-sm"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}

function FindingsApprovalDialog({
  message,
  findings,
  comment,
  onCommentChange,
  onApprove,
  onReject,
}: {
  message: string;
  findings: ReviewFinding[];
  comment: string;
  onCommentChange: (v: string) => void;
  onApprove: (comment?: string, data?: unknown) => void;
  onReject: (comment?: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(findings.map(f => f.id)));

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleCategory = (category: string, ids: string[]) => {
    setSelected(prev => {
      const next = new Set(prev);
      const allSelected = ids.every(id => next.has(id));
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const selectedCount = selected.size;

  // Group by category
  const grouped: Record<string, ReviewFinding[]> = {};
  for (const f of findings) {
    (grouped[f.category] ||= []).push(f);
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col">
        <h3 className="text-lg font-medium text-white mb-1">Review Findings</h3>
        <p className="text-gray-400 text-sm mb-4">{message}</p>

        <div className="overflow-y-auto flex-1 space-y-4 mb-4 pr-1">
          {(['must-fix', 'should-fix', 'nitpick'] as const).map(category => {
            const items = grouped[category];
            if (!items?.length) return null;
            const config = CATEGORY_CONFIG[category];
            const categoryIds = items.map(f => f.id);
            const allChecked = categoryIds.every(id => selected.has(id));

            return (
              <div key={category}>
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={() => toggleCategory(category, categoryIds)}
                    className="rounded border-gray-600 bg-gray-800"
                  />
                  <span className={`text-xs font-semibold uppercase tracking-wider ${config.color}`}>
                    {config.label}
                  </span>
                  <span className="text-xs text-gray-500">({items.length})</span>
                </div>
                <div className={`space-y-1 border-l-2 ${config.border} pl-3 ml-2`}>
                  {items.map(finding => (
                    <label
                      key={finding.id}
                      className={`flex items-start gap-2 p-2 rounded cursor-pointer hover:bg-gray-800/50 ${
                        selected.has(finding.id) ? '' : 'opacity-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(finding.id)}
                        onChange={() => toggle(finding.id)}
                        className="mt-0.5 rounded border-gray-600 bg-gray-800"
                      />
                      <div className="text-sm">
                        <span className="font-mono text-gray-200">{finding.location}</span>
                        <span className="text-gray-500 mx-1">&mdash;</span>
                        <span className="text-gray-400">{finding.description}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <textarea
          className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-gray-200 mb-4 placeholder-gray-600"
          rows={2}
          placeholder="Optional comment..."
          value={comment}
          onChange={(e) => onCommentChange(e.target.value)}
        />

        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">
            {selectedCount}/{findings.length} selected
          </span>
          <div className="flex gap-3">
            <button
              onClick={() => onReject(comment || undefined)}
              className="px-4 py-2 bg-gray-800 text-gray-300 rounded hover:bg-gray-700 text-sm"
            >
              Reject
            </button>
            <button
              onClick={() => onApprove(comment || undefined, { selectedIds: Array.from(selected) })}
              disabled={selectedCount === 0}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {selectedCount > 0
                ? `Approve ${selectedCount} to be fixed`
                : 'Select items to fix'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function extractFindings(context: unknown): ReviewFinding[] {
  if (!context || typeof context !== 'object') return [];
  const ctx = context as Record<string, unknown>;
  if (!Array.isArray(ctx.findings)) return [];
  return ctx.findings.filter(
    (f): f is ReviewFinding =>
      typeof f === 'object' && f !== null &&
      typeof (f as ReviewFinding).id === 'string' &&
      typeof (f as ReviewFinding).category === 'string' &&
      typeof (f as ReviewFinding).location === 'string' &&
      typeof (f as ReviewFinding).description === 'string',
  );
}
