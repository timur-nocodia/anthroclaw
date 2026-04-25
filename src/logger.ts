import pino from 'pino';
import { EventEmitter } from 'node:events';

export const logEmitter = new EventEmitter();
logEmitter.setMaxListeners(50);

export type BufferedLogEntry = Record<string, unknown>;

const MAX_BUFFERED_LOGS = 500;
const logBuffer: BufferedLogEntry[] = [];

function bufferLog(entry: BufferedLogEntry): void {
  logBuffer.push(entry);
  if (logBuffer.length > MAX_BUFFERED_LOGS) {
    logBuffer.splice(0, logBuffer.length - MAX_BUFFERED_LOGS);
  }
}

export function getRecentLogs(limit = 200): BufferedLogEntry[] {
  const safeLimit = Math.max(0, Math.min(limit, MAX_BUFFERED_LOGS));
  return logBuffer.slice(-safeLimit).map((entry) => ({ ...entry }));
}

const logStream = {
  write(msg: string) {
    process.stdout.write(msg);
    try {
      const parsed = JSON.parse(msg);
      bufferLog(parsed);
      logEmitter.emit('log', parsed);
    } catch {
      // non-JSON log line, ignore
    }
  },
};

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
}, logStream);
