// WebSocket server for real-time communication with the browser client

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import { createLogger } from '../utils/logger.js';
import { resolvePendingApproval } from '../services/state-service.js';
import type { ServerEvent, ClientEvent } from '../../shared/types.js';

const log = createLogger('ws');

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();

export function initWebSocket(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    clients.add(ws);
    log.info(`Client connected (${clients.size} total)`);

    ws.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString()) as ClientEvent;
        handleClientEvent(event, ws);
      } catch (err) {
        log.error('Invalid WebSocket message', { error: String(err) });
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      log.info(`Client disconnected (${clients.size} total)`);
    });

    ws.on('error', (err) => {
      log.error('WebSocket error', { error: err.message });
      clients.delete(ws);
    });
  });

  log.info('WebSocket server initialized on /ws');
  return wss;
}

/**
 * Broadcast a server event to all connected clients.
 */
export function broadcast(event: ServerEvent): void {
  const message = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

/**
 * Send a server event to a specific client.
 */
export function sendTo(ws: WebSocket, event: ServerEvent): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

function handleClientEvent(event: ClientEvent, _ws: WebSocket): void {
  switch (event.type) {
    case 'approval:response':
      log.info('Approval response received', { id: event.id, approved: event.approved });
      // The sprintId is embedded in the approval ID format: `<sprintId>:<uniqueId>`
      const parts = event.id.split(':');
      const sprintId = parts.length > 1 ? parts[0] : '';
      if (sprintId) {
        resolvePendingApproval(sprintId, event.id, event.approved, event.comment);
      }
      break;

    case 'sprint:start':
      // Handled by the sprint-routes REST API instead
      log.info('Sprint start via WS — use POST /api/sprints instead');
      break;

    case 'sprint:approve':
      log.info('Sprint approval via WS', { sprintId: event.sprintId });
      // Look for a pending approval matching this sprint
      resolvePendingApproval(event.sprintId, `${event.sprintId}:plan-approval`, true);
      break;

    case 'sprint:cancel':
      log.info('Sprint cancel via WS', { sprintId: event.sprintId });
      break;

    case 'task:retry':
      log.info('Task retry via WS', { sprintId: event.sprintId, taskId: event.taskId });
      handleTaskRetry(event.sprintId, event.taskId);
      break;

    default:
      log.warn('Unknown client event type');
  }
}

async function handleTaskRetry(sprintId: string, taskId: number): Promise<void> {
  try {
    const { resetTaskStatus } = await import('../services/state-service.js');
    resetTaskStatus(sprintId, taskId);

    const { reEnqueueTask } = await import('../queues/queue-manager.js');
    await reEnqueueTask(sprintId, taskId);

    broadcast({ type: 'task:status', sprintId, taskId, status: 'queued' });
  } catch (err) {
    log.error('Task retry failed', { sprintId, taskId, error: String(err) });
    broadcast({ type: 'error', sprintId, message: `Retry failed for task ${taskId}: ${err}` });
  }
}

export function closeWebSocket(): void {
  if (wss) {
    for (const client of clients) {
      client.close();
    }
    clients.clear();
    wss.close();
    wss = null;
  }
}
