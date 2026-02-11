// WebSocket hook for real-time communication with the server

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ServerEvent, ClientEvent } from '@shared/types.js';

type EventHandler = (event: ServerEvent) => void;

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Set<EventHandler>>(new Set());

  const send = useCallback((event: ClientEvent) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(event));
    }
  }, []);

  const subscribe = useCallback((handler: EventHandler) => {
    handlersRef.current.add(handler);
    return () => { handlersRef.current.delete(handler); };
  }, []);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    function connect() {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        // Reconnect after 2s
        setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data) as ServerEvent;
          for (const handler of handlersRef.current) {
            handler(event);
          }
        } catch {
          // ignore invalid messages
        }
      };
    }

    connect();

    return () => {
      wsRef.current?.close();
    };
  }, []);

  return { connected, send, subscribe };
}
