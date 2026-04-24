import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';

// Create a mock emitter before importing the module
const mockEmitter = new EventEmitter();
mockEmitter.setMaxListeners(50);

vi.mock('@backend/logger.js', () => ({
  logEmitter: mockEmitter,
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

let logBufferModule: typeof import('@/lib/log-buffer');

beforeEach(async () => {
  mockEmitter.removeAllListeners();
  vi.resetModules();

  vi.mock('@backend/logger.js', () => ({
    logEmitter: mockEmitter,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  }));

  logBufferModule = await import('@/lib/log-buffer');
});

describe('subscribeToLogs', () => {
  it('receives log events', () => {
    const received: unknown[] = [];
    logBufferModule.subscribeToLogs((entry) => received.push(entry));

    mockEmitter.emit('log', { level: 30, time: Date.now(), msg: 'hello' });

    expect(received).toHaveLength(1);
    expect((received[0] as any).msg).toBe('hello');
    expect((received[0] as any).level).toBe('info');
  });

  it('maps pino numeric levels to strings', () => {
    const received: unknown[] = [];
    logBufferModule.subscribeToLogs((entry) => received.push(entry));

    mockEmitter.emit('log', { level: 20, time: Date.now(), msg: 'debug msg' });
    mockEmitter.emit('log', { level: 40, time: Date.now(), msg: 'warn msg' });
    mockEmitter.emit('log', { level: 50, time: Date.now(), msg: 'error msg' });

    expect((received[0] as any).level).toBe('debug');
    expect((received[1] as any).level).toBe('warn');
    expect((received[2] as any).level).toBe('error');
  });

  it('filters by minimum level', () => {
    const received: unknown[] = [];
    logBufferModule.subscribeToLogs((entry) => received.push(entry), { level: 'warn' });

    mockEmitter.emit('log', { level: 20, time: Date.now(), msg: 'debug' });
    mockEmitter.emit('log', { level: 30, time: Date.now(), msg: 'info' });
    mockEmitter.emit('log', { level: 40, time: Date.now(), msg: 'warn' });
    mockEmitter.emit('log', { level: 50, time: Date.now(), msg: 'error' });

    expect(received).toHaveLength(2);
    expect((received[0] as any).msg).toBe('warn');
    expect((received[1] as any).msg).toBe('error');
  });

  it('filters by source', () => {
    const received: unknown[] = [];
    logBufferModule.subscribeToLogs((entry) => received.push(entry), { source: 'gateway' });

    mockEmitter.emit('log', { level: 30, time: Date.now(), msg: 'from gateway', name: 'gateway' });
    mockEmitter.emit('log', { level: 30, time: Date.now(), msg: 'from other', name: 'other' });
    mockEmitter.emit('log', { level: 30, time: Date.now(), msg: 'no source' });

    expect(received).toHaveLength(1);
    expect((received[0] as any).msg).toBe('from gateway');
  });

  it('unsubscribe stops receiving events', () => {
    const received: unknown[] = [];
    const unsubscribe = logBufferModule.subscribeToLogs((entry) => received.push(entry));

    mockEmitter.emit('log', { level: 30, time: Date.now(), msg: 'before' });
    expect(received).toHaveLength(1);

    unsubscribe();

    mockEmitter.emit('log', { level: 30, time: Date.now(), msg: 'after' });
    expect(received).toHaveLength(1); // No new events
  });

  it('preserves extra fields from log entries', () => {
    const received: unknown[] = [];
    logBufferModule.subscribeToLogs((entry) => received.push(entry));

    mockEmitter.emit('log', {
      level: 30,
      time: Date.now(),
      msg: 'with extras',
      agentId: 'test-agent',
      channel: 'telegram',
    });

    const entry = received[0] as any;
    expect(entry.agentId).toBe('test-agent');
    expect(entry.channel).toBe('telegram');
  });
});
