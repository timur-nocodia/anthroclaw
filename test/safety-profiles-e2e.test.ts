import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const real = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return { ...real, startup: vi.fn(async () => { throw new Error('mocked: no SDK in tests'); }) };
});

import { Gateway } from '../src/gateway.js';
import type { GlobalConfig } from '../src/config/schema.js';

describe('Gateway start with safety_profile', () => {
  it('loads three agents covering all three profiles', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e2e-safety-'));
    const agentsDir = join(root, 'agents');
    const dataDir = join(root, 'data');
    mkdirSync(dataDir, { recursive: true });

    function setup(name: string, profile: string, account: string, allowlist: string) {
      const dir = join(agentsDir, name);
      mkdirSync(dir, { recursive: true });
      const yml =
        `safety_profile: ${profile}\n` +
        `routes:\n  - channel: telegram\n    account: ${account}\n    scope: dm\n` +
        allowlist +
        `mcp_tools:\n  - memory_search\n`;
      writeFileSync(join(dir, 'agent.yml'), yml);
      writeFileSync(join(dir, 'CLAUDE.md'), `You are ${name}.`);
    }

    setup('pub-bot', 'public', 'acct1', '');
    setup('team-bot', 'trusted', 'acct2', `allowlist:\n  telegram:\n    - "100"\n    - "200"\n`);
    setup('mine', 'private', 'acct3', `allowlist:\n  telegram:\n    - "12345"\n`);

    const config: GlobalConfig = {
      defaults: { model: 'claude-sonnet-4-6' },
    } as any;

    const gw = new Gateway();
    await gw.start(config, agentsDir, dataDir);
    const agents = gw._agents;
    expect(agents.size).toBe(3);
    expect(agents.get('pub-bot')?.safetyProfile.name).toBe('public');
    expect(agents.get('team-bot')?.safetyProfile.name).toBe('trusted');
    expect(agents.get('mine')?.safetyProfile.name).toBe('private');

    await gw.stop();
    rmSync(root, { recursive: true, force: true });
  });

  it('refuses to start with one bad agent (hard-fail)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e2e-fail-'));
    const agentsDir = join(root, 'agents');
    const dataDir = join(root, 'data');
    mkdirSync(dataDir, { recursive: true });

    const dir = join(agentsDir, 'broken');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'agent.yml'),
      `safety_profile: public\n` +
      `routes:\n  - channel: telegram\n    scope: dm\n` +
      `mcp_tools:\n  - manage_cron\n`);
    writeFileSync(join(dir, 'CLAUDE.md'), 'broken');

    const config = { defaults: { model: 'claude-sonnet-4-6' } } as any;
    const gw = new Gateway();
    await expect(gw.start(config, agentsDir, dataDir)).rejects.toThrow(/manage_cron/);

    rmSync(root, { recursive: true, force: true });
  });
});
