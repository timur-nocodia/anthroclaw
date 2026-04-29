import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock the SDK so gateway tests don't require real auth or spawn SDK processes.
// startup() rejects to keep sdkReady=false, so queryAgent uses the fallback path.
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const real = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return {
    ...real,
    startup: vi.fn(async () => { throw new Error('mocked: no SDK in tests'); }),
  };
});

import { Gateway } from '../src/gateway.js';
import type {
  ChannelAdapter,
  InboundMessage,
  OutboundMedia,
  SendOptions,
} from '../src/channels/types.js';
import type { GlobalConfig } from '../src/config/schema.js';

/* ------------------------------------------------------------------ */
/*  MockChannel                                                        */
/* ------------------------------------------------------------------ */

class MockChannel implements ChannelAdapter {
  readonly id: 'telegram' | 'whatsapp';
  messages: { peerId: string; text: string; opts?: SendOptions }[] = [];
  edits: { peerId: string; messageId: string; text: string; opts?: SendOptions }[] = [];
  typingCalls: string[] = [];
  private handler?: (msg: InboundMessage) => Promise<void>;

  constructor(id: 'telegram' | 'whatsapp') {
    this.id = id;
  }

  onMessage(h: (msg: InboundMessage) => Promise<void>): void {
    this.handler = h;
  }

  async sendText(peerId: string, text: string, opts?: SendOptions): Promise<string> {
    this.messages.push({ peerId, text, opts });
    return 'msg1';
  }

  async editText(peerId: string, messageId: string, text: string, opts?: SendOptions): Promise<void> {
    this.edits.push({ peerId, messageId, text, opts });
  }

  async sendMedia(_peerId: string, _media: OutboundMedia, _opts?: SendOptions): Promise<string> {
    return 'msg1';
  }

  async sendTyping(peerId: string, _accountId?: string): Promise<void> {
    this.typingCalls.push(peerId);
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  /** Test helper to simulate an incoming message */
  async simulateMessage(msg: InboundMessage): Promise<void> {
    await this.handler?.(msg);
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Minimal config with no real channels (so start() won't create Telegram/WhatsApp) */
function minimalConfig(): GlobalConfig {
  return {
    defaults: {
      model: 'claude-sonnet-4-6',
      embedding_provider: 'openai',
      embedding_model: 'text-embedding-3-small',
    },
  };
}

/** Write an agent.yml into the given directory */
function writeAgentYml(dir: string, content: string): void {
  // Prepend safety_profile if not already present so all test fixtures are valid
  const yaml = content.includes('safety_profile:') ? content : `safety_profile: trusted\n${content}`;
  writeFileSync(join(dir, 'agent.yml'), yaml);
}

/** Create a standard InboundMessage for testing */
function makeMsg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    channel: 'telegram',
    accountId: 'default',
    chatType: 'dm',
    peerId: 'peer-123',
    senderId: 'sender-456',
    senderName: 'Test User',
    text: 'hello',
    messageId: 'mid-1',
    mentionedBot: true,
    raw: {},
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('Gateway', () => {
  let tmpDir: string;
  let agentsDir: string;
  let dataDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gateway-test-'));
    agentsDir = join(tmpDir, 'agents');
    dataDir = join(tmpDir, 'data');
    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── 1. discovers agents from directories ─────────────────────────

  it('discovers agents from directory', async () => {
    // Create two agent directories
    const botA = join(agentsDir, 'bot-a');
    const botB = join(agentsDir, 'bot-b');
    mkdirSync(botA);
    mkdirSync(botB);

    writeAgentYml(botA, `
routes:
  - channel: telegram
    scope: dm
`);
    writeAgentYml(botB, `
routes:
  - channel: telegram
    scope: group
`);

    // Create a directory without agent.yml — should be skipped
    mkdirSync(join(agentsDir, 'not-an-agent'));

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    expect(gw._agents.size).toBe(2);
    expect(gw._agents.has('bot-a')).toBe(true);
    expect(gw._agents.has('bot-b')).toBe(true);
    expect(gw._routeTable).not.toBeNull();

    await gw.stop();
  });

  it('handles empty agents directory', async () => {
    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    expect(gw._agents.size).toBe(0);

    await gw.stop();
  });

  it('handles non-existent agents directory', async () => {
    const gw = new Gateway();
    await gw.start(minimalConfig(), join(tmpDir, 'nonexistent'), dataDir);

    expect(gw._agents.size).toBe(0);

    await gw.stop();
  });

  // ─── 2. dispatch routes message to correct agent ──────────────────

  it('dispatch routes message to correct agent', async () => {
    const botDir = join(agentsDir, 'test-bot');
    mkdirSync(botDir);
    writeAgentYml(botDir, `
routes:
  - channel: telegram
    scope: dm
pairing:
  mode: open
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const mockTg = new MockChannel('telegram');
    gw._setChannel('telegram', mockTg);

    await gw.dispatch(makeMsg({ text: 'hi there' }));

    // Should have sent typing indicator
    expect(mockTg.typingCalls).toContain('peer-123');

    // Should have sent a response
    expect(mockTg.messages.length).toBe(1);
    expect(mockTg.messages[0].text).toContain('Agent test-bot received: hi there');

    await gw.stop();
  });

  // ─── 3. dispatch ignores unmatched messages ───────────────────────

  it('dispatch ignores unmatched messages', async () => {
    const botDir = join(agentsDir, 'test-bot');
    mkdirSync(botDir);
    writeAgentYml(botDir, `
routes:
  - channel: telegram
    scope: dm
pairing:
  mode: open
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const mockTg = new MockChannel('telegram');
    gw._setChannel('telegram', mockTg);

    // Send a whatsapp message — no route for that
    await gw.dispatch(makeMsg({ channel: 'whatsapp' }));

    expect(mockTg.messages.length).toBe(0);
    expect(mockTg.typingCalls.length).toBe(0);

    await gw.stop();
  });

  it('dispatch ignores group messages when only dm route exists', async () => {
    const botDir = join(agentsDir, 'dm-only');
    mkdirSync(botDir);
    writeAgentYml(botDir, `
routes:
  - channel: telegram
    scope: dm
pairing:
  mode: open
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const mockTg = new MockChannel('telegram');
    gw._setChannel('telegram', mockTg);

    await gw.dispatch(makeMsg({ chatType: 'group' }));

    expect(mockTg.messages.length).toBe(0);

    await gw.stop();
  });

  // ─── 4. dispatch enforces mention-only gating ─────────────────────

  it('dispatch enforces mention-only gating', async () => {
    const botDir = join(agentsDir, 'mention-bot');
    mkdirSync(botDir);
    writeAgentYml(botDir, `
routes:
  - channel: telegram
    scope: group
    mention_only: true
pairing:
  mode: open
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const mockTg = new MockChannel('telegram');
    gw._setChannel('telegram', mockTg);

    // Group message WITHOUT mention — should be ignored
    await gw.dispatch(makeMsg({
      chatType: 'group',
      mentionedBot: false,
    }));
    expect(mockTg.messages.length).toBe(0);

    // Group message WITH mention — should be dispatched
    await gw.dispatch(makeMsg({
      chatType: 'group',
      mentionedBot: true,
    }));
    expect(mockTg.messages.length).toBe(1);
    expect(mockTg.messages[0].text).toContain('Agent mention-bot received:');

    await gw.stop();
  });

  it('mention-only does not gate DM messages', async () => {
    const botDir = join(agentsDir, 'mention-bot');
    mkdirSync(botDir);
    writeAgentYml(botDir, `
routes:
  - channel: telegram
    scope: any
    mention_only: true
pairing:
  mode: open
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const mockTg = new MockChannel('telegram');
    gw._setChannel('telegram', mockTg);

    // DM message even though mentionedBot is false — mention_only only gates group
    await gw.dispatch(makeMsg({
      chatType: 'dm',
      mentionedBot: false,
    }));
    expect(mockTg.messages.length).toBe(1);

    await gw.stop();
  });

  // ─── 5. dispatch handles pairing code flow ────────────────────────

  it('dispatch handles pairing code — wrong code', async () => {
    const botDir = join(agentsDir, 'code-bot');
    mkdirSync(botDir);
    writeAgentYml(botDir, `
routes:
  - channel: telegram
    scope: dm
pairing:
  mode: code
  code: secret123
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const mockTg = new MockChannel('telegram');
    gw._setChannel('telegram', mockTg);

    // First message with wrong code
    await gw.dispatch(makeMsg({ text: 'wrongcode' }));

    expect(mockTg.messages.length).toBe(1);
    expect(mockTg.messages[0].text).toContain('pairing code');

    // Should NOT have sent typing (access denied before query)
    expect(mockTg.typingCalls.length).toBe(0);

    await gw.stop();
  });

  it('dispatch handles pairing code — correct code grants access', async () => {
    const botDir = join(agentsDir, 'code-bot');
    mkdirSync(botDir);
    writeAgentYml(botDir, `
routes:
  - channel: telegram
    scope: dm
pairing:
  mode: code
  code: secret123
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const mockTg = new MockChannel('telegram');
    gw._setChannel('telegram', mockTg);

    // Send correct code
    await gw.dispatch(makeMsg({ text: 'secret123' }));

    expect(mockTg.messages.length).toBe(1);
    expect(mockTg.messages[0].text).toContain('Access granted');

    // Now send a normal message — should be processed
    mockTg.messages = [];
    mockTg.typingCalls = [];
    await gw.dispatch(makeMsg({ text: 'hello after pairing' }));

    expect(mockTg.typingCalls).toContain('peer-123');
    expect(mockTg.messages.length).toBe(1);
    expect(mockTg.messages[0].text).toContain('Agent code-bot received: hello after pairing');

    await gw.stop();
  });

  it('dispatch handles approve pairing mode', async () => {
    const botDir = join(agentsDir, 'approve-bot');
    mkdirSync(botDir);
    writeAgentYml(botDir, `
routes:
  - channel: telegram
    scope: dm
pairing:
  mode: approve
  approver_chat_id: admin-1
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const mockTg = new MockChannel('telegram');
    gw._setChannel('telegram', mockTg);

    await gw.dispatch(makeMsg({ text: 'hello' }));

    expect(mockTg.messages.length).toBe(1);
    expect(mockTg.messages[0].text).toContain('pending approval');
    expect(mockTg.typingCalls.length).toBe(0);

    await gw.stop();
  });

  it('dispatch silently ignores when pairing mode is off', async () => {
    const botDir = join(agentsDir, 'locked-bot');
    mkdirSync(botDir);
    writeAgentYml(botDir, `
routes:
  - channel: telegram
    scope: dm
pairing:
  mode: "off"
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const mockTg = new MockChannel('telegram');
    gw._setChannel('telegram', mockTg);

    await gw.dispatch(makeMsg({ text: 'hello' }));

    // No message sent (silently ignored with no pairingType)
    expect(mockTg.messages.length).toBe(0);
    expect(mockTg.typingCalls.length).toBe(0);

    await gw.stop();
  });

  // ─── 6. dispatch sends typing indicator before response ───────────

  it('dispatch sends typing indicator before response', async () => {
    const botDir = join(agentsDir, 'typing-bot');
    mkdirSync(botDir);
    writeAgentYml(botDir, `
routes:
  - channel: telegram
    scope: dm
pairing:
  mode: open
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const events: string[] = [];

    // Use a channel that records call order
    const mockTg: ChannelAdapter = {
      id: 'telegram',
      onMessage() {},
      async start() {},
      async stop() {},
      async sendText(peerId, text, opts) {
        events.push(`sendText:${peerId}`);
        return 'msg1';
      },
      async editText() {},
      async sendMedia() {
        return 'msg1';
      },
      async sendTyping(peerId) {
        events.push(`typing:${peerId}`);
      },
    };
    gw._setChannel('telegram', mockTg);

    await gw.dispatch(makeMsg());

    expect(events[0]).toBe('typing:peer-123');
    expect(events[1]).toBe('sendText:peer-123');

    await gw.stop();
  });

  // ─── 7. stop clears state ─────────────────────────────────────────

  it('stop clears all internal state', async () => {
    const botDir = join(agentsDir, 'bot');
    mkdirSync(botDir);
    writeAgentYml(botDir, `
routes:
  - channel: telegram
    scope: dm
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    expect(gw._agents.size).toBe(1);
    expect(gw._routeTable).not.toBeNull();

    await gw.stop();

    expect(gw._agents.size).toBe(0);
    expect(gw._channels.size).toBe(0);
    expect(gw._routeTable).toBeNull();
    expect(gw._accessControl).toBeNull();
  });

  // ─── 8. dispatch with allowlisted sender bypasses pairing ─────────

  it('dispatch allows allowlisted sender without pairing', async () => {
    const botDir = join(agentsDir, 'allow-bot');
    mkdirSync(botDir);
    writeAgentYml(botDir, `
routes:
  - channel: telegram
    scope: dm
pairing:
  mode: code
  code: secret123
allowlist:
  telegram:
    - "sender-456"
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const mockTg = new MockChannel('telegram');
    gw._setChannel('telegram', mockTg);

    // Allowlisted sender should get through without code
    await gw.dispatch(makeMsg({ text: 'hello' }));

    expect(mockTg.typingCalls).toContain('peer-123');
    expect(mockTg.messages.length).toBe(1);
    expect(mockTg.messages[0].text).toContain('Agent allow-bot received: hello');

    await gw.stop();
  });

  // ─── 9. dispatch with no channel registered still routes ──────────

  it('dispatch without channel adapter does not crash', async () => {
    const botDir = join(agentsDir, 'no-ch-bot');
    mkdirSync(botDir);
    writeAgentYml(botDir, `
routes:
  - channel: telegram
    scope: dm
pairing:
  mode: open
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    // Don't set any channel adapter — dispatch should not throw
    await expect(gw.dispatch(makeMsg())).resolves.toBeUndefined();

    await gw.stop();
  });
});
