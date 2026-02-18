// Monitor chat hook — fetches history and exposes state for MonitorPanel

import { useState, useEffect, useCallback } from 'react';
import type { MonitorMessage } from '@shared/types.js';

const API_BASE = '/api';

export function useMonitorChat(sprintId: string | undefined) {
  const [messages, setMessages] = useState<MonitorMessage[]>([]);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (!sprintId) return;
    fetch(`${API_BASE}/sprints/${sprintId}/monitor-chat`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: MonitorMessage[]) => setMessages(data))
      .catch(() => setMessages([]));
  }, [sprintId]);

  const addMessage = useCallback((msg: MonitorMessage) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  return { messages, typing, setTyping, addMessage };
}

export async function sendMonitorChat(sprintId: string, content: string): Promise<void> {
  await fetch(`${API_BASE}/sprints/${sprintId}/monitor-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}
