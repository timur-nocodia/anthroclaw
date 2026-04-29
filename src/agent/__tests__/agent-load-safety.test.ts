import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Agent } from '../agent.js';

function setupAgentDir(name: string, agentYml: string, claudeMd = 'You are a test agent.'): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-load-'));
  const agentDir = join(root, name);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'agent.yml'), agentYml);
  writeFileSync(join(agentDir, 'CLAUDE.md'), claudeMd);
  return agentDir;
}

describe('Agent.load() safety_profile validation', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'safety-data-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('refuses to load agent without safety_profile', async () => {
    const dir = setupAgentDir('a', `routes:\n  - channel: telegram\n    scope: dm\n`);
    await expect(Agent.load(dir, dataDir, () => undefined)).rejects.toThrow(/safety_profile/i);
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses public agent with manage_cron and no override', async () => {
    const yml = `safety_profile: public\nroutes:\n  - channel: telegram\n    scope: dm\nmcp_tools:\n  - manage_cron\n`;
    const dir = setupAgentDir('a', yml);
    await expect(Agent.load(dir, dataDir, () => undefined)).rejects.toThrow(/manage_cron/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads valid private agent', async () => {
    const yml = `safety_profile: private\nroutes:\n  - channel: telegram\n    scope: dm\nallowlist:\n  telegram:\n    - "12345"\nmcp_tools:\n  - memory_search\n`;
    const dir = setupAgentDir('a', yml);
    const agent = await Agent.load(dir, dataDir, () => undefined);
    expect(agent.config.safety_profile).toBe('private');
    expect(agent.safetyProfile.name).toBe('private');
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses private agent with 2 peers in 1 channel', async () => {
    const yml = `safety_profile: private\nroutes:\n  - channel: telegram\n    scope: dm\nallowlist:\n  telegram:\n    - "1"\n    - "2"\n`;
    const dir = setupAgentDir('a', yml);
    await expect(Agent.load(dir, dataDir, () => undefined)).rejects.toThrow(/exactly 1/);
    rmSync(dir, { recursive: true, force: true });
  });
});
