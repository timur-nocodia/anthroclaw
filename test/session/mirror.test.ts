import { describe, it, expect, vi, afterEach } from 'vitest';
import { SessionMirror } from '../../src/session/mirror.js';

describe('SessionMirror', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('records and consumes a single record', () => {
    const mirror = new SessionMirror();
    mirror.record('session-1', 'cron:daily', 'Hello');

    const records = mirror.consume('session-1');
    expect(records).toHaveLength(1);
    expect(records![0].source).toBe('cron:daily');
    expect(records![0].text).toBe('Hello');
    expect(records![0].timestamp).toBeTypeOf('number');
  });

  it('accumulates multiple records', () => {
    const mirror = new SessionMirror();
    mirror.record('s1', 'agent:bot-a', 'msg1');
    mirror.record('s1', 'agent:bot-b', 'msg2');
    mirror.record('s1', 'cron:check', 'msg3');

    const records = mirror.consume('s1');
    expect(records).toHaveLength(3);
    expect(records!.map((r) => r.source)).toEqual([
      'agent:bot-a',
      'agent:bot-b',
      'cron:check',
    ]);
  });

  it('consume clears records', () => {
    const mirror = new SessionMirror();
    mirror.record('s1', 'agent:a', 'hi');

    expect(mirror.consume('s1')).toHaveLength(1);
    expect(mirror.consume('s1')).toBeNull();
  });

  it('returns null when no records exist', () => {
    const mirror = new SessionMirror();
    expect(mirror.consume('nonexistent')).toBeNull();
  });

  it('evicts oldest records when exceeding max 50 (FIFO)', () => {
    const mirror = new SessionMirror();
    for (let i = 0; i < 60; i++) {
      mirror.record('s1', `src:${i}`, `text-${i}`);
    }

    const records = mirror.consume('s1');
    expect(records).toHaveLength(50);
    // oldest 10 should be evicted; first remaining is index 10
    expect(records![0].source).toBe('src:10');
    expect(records![49].source).toBe('src:59');
  });

  it('isolates records between sessions', () => {
    const mirror = new SessionMirror();
    mirror.record('s1', 'a', 'for s1');
    mirror.record('s2', 'b', 'for s2');

    expect(mirror.consume('s1')!.map((r) => r.text)).toEqual(['for s1']);
    expect(mirror.consume('s2')!.map((r) => r.text)).toEqual(['for s2']);
  });

  describe('formatForContext', () => {
    it('formats records as context string', () => {
      const mirror = new SessionMirror();
      const records = [
        { source: 'cron:daily-check', text: 'Report ready', timestamp: 1 },
        { source: 'agent:bot-a', text: 'Heads up!', timestamp: 2 },
      ];

      const output = mirror.formatForContext(records);
      expect(output).toBe(
        '[Mirror] Messages sent to this chat while you were away:\n' +
          '- [cron:daily-check] Report ready\n' +
          '- [agent:bot-a] Heads up!\n',
      );
    });

    it('formats a single record', () => {
      const mirror = new SessionMirror();
      const records = [
        { source: 'cron:ping', text: 'pong', timestamp: 1 },
      ];

      const output = mirror.formatForContext(records);
      expect(output).toBe(
        '[Mirror] Messages sent to this chat while you were away:\n' +
          '- [cron:ping] pong\n',
      );
    });
  });
});
