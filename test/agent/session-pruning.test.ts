import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Agent } from '../../src/agent/agent.js';

function writeAgentYml(dir: string, maxSessions?: number): void {
  const maxLine = maxSessions !== undefined ? `\nmaxSessions: ${maxSessions}` : '';
  writeFileSync(
    join(dir, 'agent.yml'),
    `routes:
  - channel: telegram
    scope: dm${maxLine}
`,
  );
}

describe('Session pruning', () => {
  let tmpDir: string;
  let agentDir: string;
  let dataDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'session-prune-'));
    agentDir = join(tmpDir, 'test-bot');
    dataDir = join(tmpDir, 'data');
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // ─── LRU eviction when maxSessions exceeded ────────────────────
  it('evicts sessions when maxSessions is exceeded', async () => {
    writeAgentYml(agentDir, 3);
    const agent = await Agent.load(agentDir, dataDir);

    agent.setSessionId('key-1', 'sess-1');
    agent.setSessionId('key-2', 'sess-2');
    agent.setSessionId('key-3', 'sess-3');

    expect(agent.sessionCount).toBe(3);

    // Adding a 4th session should evict the oldest
    agent.setSessionId('key-4', 'sess-4');

    expect(agent.sessionCount).toBe(3);
    expect(agent.getSessionId('key-4')).toBe('sess-4');
  });

  it('evicts the least recently used session', async () => {
    writeAgentYml(agentDir, 3);
    const agent = await Agent.load(agentDir, dataDir);

    // Set sessions with increasing timestamps
    const now = Date.now();
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(now)       // key-1 set
      .mockReturnValueOnce(now + 100)  // key-2 set
      .mockReturnValueOnce(now + 200)  // key-3 set
      .mockReturnValueOnce(now + 300)  // key-1 get (touch)
      .mockReturnValueOnce(now + 400)  // key-4 set
      .mockReturnValue(now + 500);     // any subsequent calls

    agent.setSessionId('key-1', 'sess-1');
    agent.setSessionId('key-2', 'sess-2');
    agent.setSessionId('key-3', 'sess-3');

    // Touch key-1 so it becomes recently used
    agent.getSessionId('key-1');

    // key-4 should evict key-2 (oldest untouched)
    agent.setSessionId('key-4', 'sess-4');

    expect(agent.sessionCount).toBe(3);
    expect(agent.getSessionId('key-1')).toBe('sess-1');
    expect(agent.getSessionId('key-2')).toBeUndefined();
    expect(agent.getSessionId('key-3')).toBe('sess-3');
    expect(agent.getSessionId('key-4')).toBe('sess-4');
  });

  // ─── pruneOldSessions removes expired sessions ─────────────────
  it('pruneOldSessions removes sessions older than maxAgeMs', async () => {
    writeAgentYml(agentDir);
    const agent = await Agent.load(agentDir, dataDir);

    const now = Date.now();
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(now - 5000)  // key-old set
      .mockReturnValueOnce(now - 1000)  // key-new set
      .mockReturnValue(now);            // prune check

    agent.setSessionId('key-old', 'sess-old');
    agent.setSessionId('key-new', 'sess-new');

    // Prune sessions older than 3000ms
    const evicted = agent.pruneOldSessions(3000);

    expect(evicted).toBe(1);
    expect(agent.getSessionId('key-old')).toBeUndefined();
    expect(agent.getSessionId('key-new')).toBe('sess-new');
  });

  // ─── Active (recent) sessions are kept ─────────────────────────
  it('keeps active sessions during pruning', async () => {
    writeAgentYml(agentDir);
    const agent = await Agent.load(agentDir, dataDir);

    const now = Date.now();
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(now - 500)  // key-a set
      .mockReturnValueOnce(now - 200)  // key-b set
      .mockReturnValue(now);           // prune check

    agent.setSessionId('key-a', 'sess-a');
    agent.setSessionId('key-b', 'sess-b');

    // Both sessions are within the 1000ms window
    const evicted = agent.pruneOldSessions(1000);

    expect(evicted).toBe(0);
    expect(agent.sessionCount).toBe(2);
    expect(agent.getSessionId('key-a')).toBe('sess-a');
    expect(agent.getSessionId('key-b')).toBe('sess-b');
  });

  // ─── Default maxSessions is 100 ────────────────────────────────
  it('defaults maxSessions to 100', async () => {
    writeAgentYml(agentDir); // no explicit maxSessions
    const agent = await Agent.load(agentDir, dataDir);

    // Add 100 sessions — should all fit
    for (let i = 0; i < 100; i++) {
      agent.setSessionId(`key-${i}`, `sess-${i}`);
    }
    expect(agent.sessionCount).toBe(100);

    // 101st should trigger eviction
    agent.setSessionId('key-overflow', 'sess-overflow');
    expect(agent.sessionCount).toBe(100);
  });

  // ─── clearSession removes timestamp too ────────────────────────
  it('clearSession removes the session and its timestamp', async () => {
    writeAgentYml(agentDir, 5);
    const agent = await Agent.load(agentDir, dataDir);

    agent.setSessionId('key-x', 'sess-x');
    expect(agent.sessionCount).toBe(1);

    agent.clearSession('key-x');
    expect(agent.sessionCount).toBe(0);
    expect(agent.getSessionId('key-x')).toBeUndefined();
  });
});
