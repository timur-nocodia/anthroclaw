import { logEmitter } from '@backend/logger.js';

// ─── Types ───────────────────────────────────────────────────────────

export interface LogEntry {
  level: string;
  time: number;
  msg: string;
  source?: string;
  [key: string]: unknown;
}

// Pino numeric level → string mapping
const PINO_LEVELS: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

const LEVEL_PRIORITY: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

// ─── Subscriber ──────────────────────────────────────────────────────

export interface LogFilter {
  level?: string;
  source?: string;
}

/**
 * Subscribe to log events from the backend logger.
 * Returns an unsubscribe function.
 */
export function subscribeToLogs(
  callback: (entry: LogEntry) => void,
  filter?: LogFilter,
): () => void {
  const minLevel = filter?.level ? (LEVEL_PRIORITY[filter.level] ?? 0) : 0;
  const sourceFilter = filter?.source ?? null;

  const handler = (parsed: Record<string, unknown>) => {
    // Map pino numeric level to string
    const numLevel = typeof parsed.level === 'number' ? parsed.level : 30;
    const levelStr = PINO_LEVELS[numLevel] ?? 'info';
    const levelPriority = LEVEL_PRIORITY[levelStr] ?? 30;

    // Filter by minimum level
    if (levelPriority < minLevel) return;

    // Filter by source
    const entrySource = typeof parsed.name === 'string' ? parsed.name : undefined;
    if (sourceFilter && entrySource !== sourceFilter) return;

    const entry: LogEntry = {
      level: levelStr,
      time: typeof parsed.time === 'number' ? parsed.time : Date.now(),
      msg: typeof parsed.msg === 'string' ? parsed.msg : '',
      source: entrySource,
    };

    // Copy extra fields
    for (const [key, value] of Object.entries(parsed)) {
      if (!['level', 'time', 'msg', 'name', 'hostname', 'pid', 'v'].includes(key)) {
        entry[key] = value;
      }
    }

    callback(entry);
  };

  logEmitter.on('log', handler);

  return () => {
    logEmitter.off('log', handler);
  };
}
