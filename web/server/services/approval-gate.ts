// Approval gate helper — pauses a worker until the user approves or rejects via WebSocket

import { addPendingApproval } from './state-service.js';
import { broadcast } from '../websocket/ws-server.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('approval-gate');

export interface ApprovalResult {
  approved: boolean;
  data?: unknown;
}

/**
 * Request human approval for a sprint phase.
 * Broadcasts an `approval:required` WebSocket event and blocks until the user responds.
 * Returns an object with `approved` boolean and optional `data` from the client.
 */
export async function requestApproval(
  sprintId: string,
  approvalType: string,
  message: string,
  context?: unknown,
): Promise<ApprovalResult> {
  const approvalId = `${sprintId}:${approvalType}`;
  log.info(`Requesting approval: ${approvalId}`, { message });

  return new Promise((resolve) => {
    addPendingApproval({
      id: approvalId,
      sprintId,
      message,
      context,
      resolve: (approved, _comment, data) => {
        log.info(`Approval resolved: ${approvalId} → ${approved ? 'approved' : 'rejected'}`);
        resolve({ approved, data });
      },
    });

    broadcast({
      type: 'approval:required',
      id: approvalId,
      sprintId,
      message,
      context,
    });
  });
}
