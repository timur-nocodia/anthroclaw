import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Agent } from '../agent.js';

const SESSION_KEY = 'sk:test:dm:42';

function setupAgentDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'compress-fail-'));
  const agentDir = join(root, 'a');
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    join(agentDir, 'agent.yml'),
    `safety_profile: private\nroutes:\n  - channel: telegram\n    scope: dm\nallowlist:\n  telegram:\n    - "1"\n`,
  );
  writeFileSync(join(agentDir, 'CLAUDE.md'), 'You are a test agent.');
  return agentDir;
}

describe('Agent compress failure counter', () => {
  let agentDir: string;
  let dataDir: string;

  beforeEach(() => {
    agentDir = setupAgentDir();
    dataDir = mkdtempSync(join(tmpdir(), 'compress-data-'));
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('starts at 0 for unknown sessions', async () => {
    const agent = await Agent.load(agentDir, dataDir, () => undefined);
    expect(agent.getCompressFailureCount(SESSION_KEY)).toBe(0);
  });

  it('increments and returns the new value', async () => {
    const agent = await Agent.load(agentDir, dataDir, () => undefined);
    expect(agent.incrementCompressFailureCount(SESSION_KEY)).toBe(1);
    expect(agent.incrementCompressFailureCount(SESSION_KEY)).toBe(2);
    expect(agent.incrementCompressFailureCount(SESSION_KEY)).toBe(3);
    expect(agent.getCompressFailureCount(SESSION_KEY)).toBe(3);
  });

  it('reset returns counter to 0', async () => {
    const agent = await Agent.load(agentDir, dataDir, () => undefined);
    agent.incrementCompressFailureCount(SESSION_KEY);
    agent.incrementCompressFailureCount(SESSION_KEY);
    agent.resetCompressFailureCount(SESSION_KEY);
    expect(agent.getCompressFailureCount(SESSION_KEY)).toBe(0);
  });

  it('clearSession also clears the failure counter', async () => {
    const agent = await Agent.load(agentDir, dataDir, () => undefined);
    agent.setSessionId(SESSION_KEY, 'sdk-session-1');
    agent.incrementCompressFailureCount(SESSION_KEY);
    agent.incrementCompressFailureCount(SESSION_KEY);
    expect(agent.getCompressFailureCount(SESSION_KEY)).toBe(2);
    agent.clearSession(SESSION_KEY);
    expect(agent.getCompressFailureCount(SESSION_KEY)).toBe(0);
  });

  it('tracks failures independently per session', async () => {
    const agent = await Agent.load(agentDir, dataDir, () => undefined);
    agent.incrementCompressFailureCount('sk:a');
    agent.incrementCompressFailureCount('sk:a');
    agent.incrementCompressFailureCount('sk:b');
    expect(agent.getCompressFailureCount('sk:a')).toBe(2);
    expect(agent.getCompressFailureCount('sk:b')).toBe(1);
    expect(agent.getCompressFailureCount('sk:c')).toBe(0);
  });
});
