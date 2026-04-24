import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Agent } from '../../src/agent/agent.js';

function writeAgentYml(dir: string, sessionPolicy: string): void {
  writeFileSync(
    join(dir, 'agent.yml'),
    `routes:
  - channel: telegram
    scope: dm
session_policy: ${sessionPolicy}
`,
  );
}

describe('Session Reset Policies', () => {
  let tmpDir: string;
  let agentDir: string;
  let dataDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'session-policy-'));
    agentDir = join(tmpDir, 'test-bot');
    dataDir = join(tmpDir, 'data');
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it('isSessionResetDue returns false for never policy', async () => {
    writeAgentYml(agentDir, 'never');
    const agent = await Agent.load(agentDir, dataDir);
    agent.setSessionId('sess1', 'id1');

    expect(agent.isSessionResetDue('sess1', 'never')).toBe(false);
  });

  it('isSessionResetDue returns false when no session started', async () => {
    writeAgentYml(agentDir, 'daily');
    const agent = await Agent.load(agentDir, dataDir);

    expect(agent.isSessionResetDue('nonexistent', 'daily')).toBe(false);
  });

  it('isSessionResetDue returns true after hourly threshold', async () => {
    vi.useFakeTimers();
    writeAgentYml(agentDir, 'hourly');
    const agent = await Agent.load(agentDir, dataDir);
    agent.setSessionId('sess1', 'id1');

    expect(agent.isSessionResetDue('sess1', 'hourly')).toBe(false);

    vi.advanceTimersByTime(61 * 60 * 1000); // 61 minutes
    expect(agent.isSessionResetDue('sess1', 'hourly')).toBe(true);
  });

  it('isSessionResetDue returns true after daily threshold', async () => {
    vi.useFakeTimers();
    writeAgentYml(agentDir, 'daily');
    const agent = await Agent.load(agentDir, dataDir);
    agent.setSessionId('sess1', 'id1');

    expect(agent.isSessionResetDue('sess1', 'daily')).toBe(false);

    vi.advanceTimersByTime(25 * 60 * 60 * 1000); // 25 hours
    expect(agent.isSessionResetDue('sess1', 'daily')).toBe(true);
  });

  it('clearSession resets start time and message count', async () => {
    writeAgentYml(agentDir, 'daily');
    const agent = await Agent.load(agentDir, dataDir);
    agent.setSessionId('sess1', 'id1');
    agent.incrementMessageCount('sess1');
    agent.incrementMessageCount('sess1');

    expect(agent.getMessageCount('sess1')).toBe(2);
    expect(agent.getSessionStartTime('sess1')).toBeDefined();

    agent.clearSession('sess1');

    expect(agent.getMessageCount('sess1')).toBe(0);
    expect(agent.getSessionStartTime('sess1')).toBeUndefined();
  });

  it('incrementMessageCount tracks correctly', async () => {
    writeAgentYml(agentDir, 'never');
    const agent = await Agent.load(agentDir, dataDir);

    expect(agent.incrementMessageCount('s1')).toBe(1);
    expect(agent.incrementMessageCount('s1')).toBe(2);
    expect(agent.incrementMessageCount('s1')).toBe(3);
    expect(agent.getMessageCount('s1')).toBe(3);
    expect(agent.getMessageCount('s2')).toBe(0);
  });

  it('_exportSessions/_importSessions preserve session metadata', async () => {
    writeAgentYml(agentDir, 'daily');
    const agent = await Agent.load(agentDir, dataDir);
    agent.setSessionId('sess1', 'id1');
    agent.incrementMessageCount('sess1');

    const exported = agent._exportSessions();
    expect(exported.started.size).toBe(1);
    expect(exported.messageCounts.size).toBe(1);

    const agent2Dir = join(tmpDir, 'test-bot2');
    mkdirSync(agent2Dir, { recursive: true });
    writeAgentYml(agent2Dir, 'daily');
    const agent2 = await Agent.load(agent2Dir, dataDir);
    agent2._importSessions(exported);

    expect(agent2.getSessionId('sess1')).toBe('id1');
    expect(agent2.getMessageCount('sess1')).toBe(1);
    expect(agent2.getSessionStartTime('sess1')).toBeDefined();
  });
});
