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
import type { ChannelAdapter, InboundMessage, OutboundMedia, SendOptions } from '../src/channels/types.js';

class MockChannel implements ChannelAdapter {
  readonly id: 'telegram' | 'whatsapp';
  messages: { peerId: string; text: string }[] = [];
  constructor(id: 'telegram' | 'whatsapp') { this.id = id; }
  onMessage(_h: (msg: InboundMessage) => Promise<void>): void {}
  async sendText(peerId: string, text: string, _opts?: SendOptions): Promise<string> {
    this.messages.push({ peerId, text });
    return 'mock-id';
  }
  async editText(): Promise<void> {}
  async sendMedia(_p: string, _m: OutboundMedia, _o?: SendOptions): Promise<string> { return 'mock-id'; }
  async sendTyping(): Promise<void> {}
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  readonly supportsApproval = false;
  async promptForApproval(): Promise<void> {}
}

function makeMsg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    channel: 'telegram',
    accountId: 'acct1',
    chatType: 'dm',
    peerId: 'peer-1',
    senderId: 'sender-1',
    text: 'hello',
    messageId: `mid-${Math.random()}`,
    mentionedBot: false,
    raw: {},
    ...overrides,
  };
}

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

describe('Gateway profileRateLimiters', () => {
  it('creates a profile rate limiter for public agent (floor=30/hour)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e2e-rl-pub-'));
    const agentsDir = join(root, 'agents');
    const dataDir = join(root, 'data');
    mkdirSync(dataDir, { recursive: true });

    const dir = join(agentsDir, 'pub-bot');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'agent.yml'),
      `safety_profile: public\nroutes:\n  - channel: telegram\n    scope: dm\nmcp_tools:\n  - memory_search\n`);
    writeFileSync(join(dir, 'CLAUDE.md'), 'You are pub-bot.');

    const config = { defaults: { model: 'claude-sonnet-4-6' } } as any;
    const gw = new Gateway();
    await gw.start(config, agentsDir, dataDir);

    expect(gw._profileRateLimiters.has('pub-bot')).toBe(true);

    await gw.stop();
    rmSync(root, { recursive: true, force: true });
  });

  it('does not create a profile rate limiter for private agent (floor=null)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e2e-rl-priv-'));
    const agentsDir = join(root, 'agents');
    const dataDir = join(root, 'data');
    mkdirSync(dataDir, { recursive: true });

    const dir = join(agentsDir, 'mine');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'agent.yml'),
      `safety_profile: private\nroutes:\n  - channel: telegram\n    scope: dm\nallowlist:\n  telegram:\n    - "12345"\nmcp_tools:\n  - memory_search\n`);
    writeFileSync(join(dir, 'CLAUDE.md'), 'You are mine.');

    const config = { defaults: { model: 'claude-sonnet-4-6' } } as any;
    const gw = new Gateway();
    await gw.start(config, agentsDir, dataDir);

    expect(gw._profileRateLimiters.has('mine')).toBe(false);

    await gw.stop();
    rmSync(root, { recursive: true, force: true });
  });

  it('public agent: 31st message from same peer is rate-limited', async () => {
    vi.useFakeTimers();
    const root = mkdtempSync(join(tmpdir(), 'e2e-rl-enforce-'));
    const agentsDir = join(root, 'agents');
    const dataDir = join(root, 'data');
    mkdirSync(dataDir, { recursive: true });

    const dir = join(agentsDir, 'pub-bot');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'agent.yml'),
      `safety_profile: public\nroutes:\n  - channel: telegram\n    scope: dm\npairing:\n  mode: open\nmcp_tools:\n  - memory_search\n`);
    writeFileSync(join(dir, 'CLAUDE.md'), 'You are pub-bot.');

    const config = { defaults: { model: 'claude-sonnet-4-6' } } as any;
    const gw = new Gateway();
    await gw.start(config, agentsDir, dataDir);

    const mockTg = new MockChannel('telegram');
    gw._setChannel('telegram', mockTg);

    // Send 30 messages — all should be allowed (no rate-limit message sent)
    for (let i = 0; i < 30; i++) {
      await gw.dispatch(makeMsg({ senderId: 'peer-pub', peerId: 'peer-pub' }));
    }
    const beforeCount = mockTg.messages.length;

    // 31st message should be rate-limited
    await gw.dispatch(makeMsg({ senderId: 'peer-pub', peerId: 'peer-pub' }));
    const newMessages = mockTg.messages.slice(beforeCount);
    expect(newMessages.some((m) => m.text.includes('Rate limit exceeded'))).toBe(true);

    await gw.stop();
    vi.useRealTimers();
    rmSync(root, { recursive: true, force: true });
  });
});
