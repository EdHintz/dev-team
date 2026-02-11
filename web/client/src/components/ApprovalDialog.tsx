import { useState } from 'react';

interface ApprovalDialogProps {
  message: string;
  onApprove: (comment?: string) => void;
  onReject: (comment?: string) => void;
}

export function ApprovalDialog({ message, onApprove, onReject }: ApprovalDialogProps) {
  const [comment, setComment] = useState('');

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
