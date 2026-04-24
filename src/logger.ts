import pino from 'pino';
import { EventEmitter } from 'node:events';

export const logEmitter = new EventEmitter();
logEmitter.setMaxListeners(50);

const logStream = {
  write(msg: string) {
    process.stdout.write(msg);
    try {
      const parsed = JSON.parse(msg);
      logEmitter.emit('log', parsed);
    } catch {
      // non-JSON log line, ignore
    }
  },
};

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
}, logStream);
