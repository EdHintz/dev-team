// Monitor chat panel — collapsible chat UI for sprint health monitoring

import { useState, useRef, useEffect } from 'react';
import type { MonitorMessage } from '@shared/types.js';

interface MonitorPanelProps {
  messages: MonitorMessage[];
  typing: boolean;
  onSend: (content: string) => void;
}

export function MonitorPanel({ messages, typing, onSend }: MonitorPanelProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current && !collapsed) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, collapsed]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setInput('');
  };

  return (
    <div className="border border-amber-800/50 rounded-lg bg-gray-900/50 mb-6">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-gray-800/30 rounded-lg transition"
      >
        <span className={`w-2 h-2 rounded-full bg-amber-400 ${typing ? 'animate-pulse' : ''}`} />
        <span className="text-sm font-medium text-amber-300">Monitor</span>
        {messages.length > 0 && (
          <span className="text-xs text-gray-500">{messages.length}</span>
        )}
        <span className="ml-auto text-xs text-gray-600">{collapsed ? '\u25BC' : '\u25B2'}</span>
      </button>

      {!collapsed && (
        <>
          {/* Messages */}
          <div
            ref={scrollRef}
            className="px-4 overflow-y-auto space-y-2"
            style={{ maxHeight: '240px' }}
          >
            {messages.length === 0 && (
              <p className="text-xs text-gray-600 py-2">No messages yet. Ask the monitor about this sprint.</p>
            )}
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {typing && (
              <div className="flex items-center gap-1 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            )}
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="flex gap-2 px-4 py-3 border-t border-gray-800/50">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask the monitor..."
              className="flex-1 bg-gray-800 text-sm text-white rounded px-3 py-1.5 border border-gray-700 focus:border-amber-600 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="px-3 py-1.5 bg-amber-600 text-white text-sm rounded hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </form>
        </>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: MonitorMessage }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? 'bg-blue-600/20 text-blue-200 border border-blue-700/40'
            : isSystem
              ? 'bg-amber-900/20 text-amber-200 border border-amber-700/40'
              : 'bg-gray-800 text-gray-300 border border-gray-700/40'
        }`}
      >
        {isSystem && <span className="text-[10px] uppercase text-amber-500 font-medium">System</span>}
        <p className="whitespace-pre-wrap">{message.content}</p>
        {message.actionResult && (
          <div className={`mt-1 text-xs ${message.actionResult.success ? 'text-green-400' : 'text-red-400'}`}>
            {message.actionResult.success ? '\u2713' : '\u2717'} {message.actionResult.message}
          </div>
        )}
        <div className="text-[10px] text-gray-600 mt-1">
          {new Date(message.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}
