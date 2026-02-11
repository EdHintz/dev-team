// Structured logger for the dev-team web orchestrator

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',   // gray
  info: '\x1b[34m',    // blue
  warn: '\x1b[33m',    // yellow
  error: '\x1b[31m',   // red
};

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function formatTimestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

function log(level: LogLevel, context: string, message: string, data?: Record<string, unknown>): void {
  const color = LOG_COLORS[level];
  const timestamp = formatTimestamp();
  const prefix = `${color}${timestamp} [${level.toUpperCase()}]${RESET} ${BOLD}${context}${RESET}`;

  if (data) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

export function createLogger(context: string) {
  return {
    debug: (message: string, data?: Record<string, unknown>) => log('debug', context, message, data),
    info: (message: string, data?: Record<string, unknown>) => log('info', context, message, data),
    warn: (message: string, data?: Record<string, unknown>) => log('warn', context, message, data),
    error: (message: string, data?: Record<string, unknown>) => log('error', context, message, data),
  };
}
