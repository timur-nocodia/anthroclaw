import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { startupMock, queryMock } = vi.hoisted(() => ({
  startupMock: vi.fn(),
  queryMock: vi.fn(),
}));

function createSdkStream(events: Array<Record<string, unknown>>) {
  return {
    interrupt: vi.fn(),
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
  };
}

const seenPrompts: unknown[] = [];

function createQueryForPrompt(prompt: unknown) {
  seenPrompts.push(prompt);
  const text = typeof prompt === 'string' ? prompt : '';

  if (text.includes('Extract durable memory candidates')) {
    return createSdkStream([
      {
        type: 'result',
        result: JSON.stringify({
          candidates: [{
            kind: 'decision',
            text: 'The team chose SDK-native memory review.',
            confidence: 0.91,
            reason: 'The run discussed it.',
          }],
        }),
        session_id: 'memory-extraction-session',
      },
    ]);
  }

  if (text.includes('Generate a short, descriptive title')) {
    return createSdkStream([
      {
        type: 'result',
        result: 'Useful Session Title',
        session_id: 'title-session',
      },
    ]);
  }

  if (text.includes('[web-user]:')) {
    return createSdkStream([
      { session_id: 'web-sdk-session-1' },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Web SDK says hi' }],
        },
        usage: {
          output_tokens: 12,
        },
      },
      {
        type: 'result',
        result: 'Web SDK says hi',
        session_id: 'web-sdk-session-1',
      },
    ]);
  }

  return createSdkStream([
    { session_id: 'sdk-session-1' },
    {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'SDK says hi' }],
      },
    },
    {
      type: 'result',
      result: 'SDK says hi',
      session_id: 'sdk-session-1',
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 40,
      },
    },
  ]);
}

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const real = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return {
    ...real,
    startup: startupMock,
    query: queryMock,
  };
});

import { Gateway } from '../src/gateway.js';
import { metrics } from '../src/metrics/collector.js';
import type { GlobalConfig } from '../src/config/schema.js';
import type { InboundMessage } from '../src/channels/types.js';

function minimalConfig(): GlobalConfig {
  return {
    defaults: {
      model: 'claude-sonnet-4-6',
      embedding_provider: 'openai',
      embedding_model: 'text-embedding-3-small',
      debounce_ms: 0,
    },
  };
}

function writeAgentYml(dir: string, content: string): void {
  writeFileSync(join(dir, 'agent.yml'), content);
}

function makeMsg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    channel: 'telegram',
    accountId: 'default',
    chatType: 'dm',
    peerId: 'peer-123',
    senderId: 'sender-456',
    senderName: 'Test User',
    text: 'hello sdk',
    messageId: 'mid-1',
    mentionedBot: true,
    raw: {},
    ...overrides,
  };
}

async function waitForPendingMemory(gw: Gateway, agentId: string) {
  for (let i = 0; i < 20; i++) {
    const entries = gw.listAgentMemoryEntries(agentId, { reviewStatus: 'pending' });
    if (entries.length > 0) return entries;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return gw.listAgentMemoryEntries(agentId, { reviewStatus: 'pending' });
}

describe('Gateway SDK success path', () => {
  let tmpDir: string;
  let agentsDir: string;
  let dataDir: string;

  beforeEach(() => {
    metrics._reset();
    startupMock.mockReset();
    queryMock.mockReset();
    seenPrompts.length = 0;

    startupMock.mockImplementation(async (params?: { options?: unknown }) => {
      if (!params?.options) {
        return { close: vi.fn() };
      }

      return {
        close: vi.fn(),
        query: vi.fn((prompt: unknown) => createQueryForPrompt(prompt)),
      };
    });

    queryMock.mockImplementation(({ prompt }: { prompt: unknown }) => createQueryForPrompt(prompt));

    tmpDir = mkdtempSync(join(tmpdir(), 'gateway-sdk-success-'));
    agentsDir = join(tmpDir, 'agents');
    dataDir = join(tmpDir, 'data');
    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('dispatch uses native SDK query flow and records cache-read usage', async () => {
    const botDir = join(agentsDir, 'sdk-bot');
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

    const sent: string[] = [];
    gw._setChannel('telegram', {
      id: 'telegram',
      onMessage() {},
      async start() {},
      async stop() {},
      async sendText(_peerId, text) {
        sent.push(text);
        return 'msg1';
      },
      async editText() {},
      async sendMedia() {
        return 'media1';
      },
      async sendTyping() {},
    });

    await gw.dispatch(makeMsg());

    expect(sent).toEqual(['SDK says hi']);
    const snap = metrics.snapshot();
    expect(snap.tokens_24h.input).toBe(100);
    expect(snap.tokens_24h.output).toBe(20);
    expect(snap.tokens_24h.cache_read).toBe(40);
    expect(snap.tokens_24h.byModel['claude-sonnet-4-6']).toEqual({
      input: 100,
      output: 20,
      cache_read: 40,
    });
    const sessions = await gw.listAgentSessions('sdk-bot');
    expect(sessions[0]).toMatchObject({
      sessionId: 'sdk-session-1',
      provenance: {
        source: 'channel',
        channel: 'telegram',
        accountId: 'default',
        peerId: 'peer-123',
        messageId: 'mid-1',
        sessionKey: 'sdk-bot:telegram:dm:peer-123',
        routeOutcome: 'dispatched',
        status: 'succeeded',
      },
    });
    expect(sessions[0]?.provenance?.routeDecisionId).toEqual(expect.any(String));
    expect(gw.listRouteDecisions({ agentId: 'sdk-bot' })).toMatchObject([{
      id: sessions[0]?.provenance?.routeDecisionId,
      messageId: 'mid-1',
      winnerAgentId: 'sdk-bot',
      accessAllowed: true,
      sessionKey: 'sdk-bot:telegram:dm:peer-123',
      outcome: 'dispatched',
      candidates: [{ agentId: 'sdk-bot', scope: 'dm' }],
    }]);

    await gw.stop();
  });

  it('injects per-chat operator context and honors reply_to_mode', async () => {
    const botDir = join(agentsDir, 'context-bot');
    mkdirSync(botDir);
    writeAgentYml(botDir, `
routes:
  - channel: telegram
    scope: group
    topics: ['topic-42']
pairing:
  mode: open
channel_context:
  reply_to_mode: incoming_reply_only
  telegram:
    topics:
      topic-42:
        prompt: Keep replies concise for the support topic.
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const sent: Array<{ text: string; replyToId?: string }> = [];
    gw._setChannel('telegram', {
      id: 'telegram',
      onMessage() {},
      async start() {},
      async stop() {},
      async sendText(_peerId, text, opts) {
        sent.push({ text, replyToId: opts?.replyToId });
        return 'msg1';
      },
      async editText() {},
      async sendMedia() {
        return 'media1';
      },
      async sendTyping() {},
    });

    await gw.dispatch(makeMsg({
      chatType: 'group',
      peerId: 'group-123',
      threadId: 'topic-42',
      replyToId: 'parent-message',
    }));

    const sdkPrompt = seenPrompts.find((prompt): prompt is string =>
      typeof prompt === 'string' && prompt.includes('[Test User]: hello sdk'),
    );
    expect(sdkPrompt).toContain('<channel-operator-context>');
    expect(sdkPrompt).toContain('Keep replies concise for the support topic.');
    expect(sdkPrompt).toContain('additive to CLAUDE.md');
    expect(sent).toEqual([{ text: 'SDK says hi', replyToId: 'mid-1' }]);

    await gw.stop();
  });

  it('dispatchWebUI streams native SDK text instead of fallback output', async () => {
    const botDir = join(agentsDir, 'web-sdk-bot');
    mkdirSync(botDir);
    writeAgentYml(botDir, `
routes:
  - channel: telegram
    scope: dm
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const textParts: string[] = [];
    let doneSessionId = '';

    await gw.dispatchWebUI('web-sdk-bot', 'hello web', undefined, {}, {
      onText: (chunk) => textParts.push(chunk),
      onToolCall: () => {},
      onToolResult: () => {},
      onDone: (sid, tokens) => {
        doneSessionId = sid;
        expect(typeof tokens).toBe('number');
      },
      onError: (err) => {
        throw err;
      },
    });

    expect(textParts.join('')).toBe('Web SDK says hi');
    expect(doneSessionId).toBe('web-sdk-session-1');

    await gw.stop();
  });

  it('proposes post-run memory candidates for review without making them searchable before approval', async () => {
    const botDir = join(agentsDir, 'memory-bot');
    mkdirSync(botDir);
    writeAgentYml(botDir, `
routes:
  - channel: telegram
    scope: dm
pairing:
  mode: open
memory_extraction:
  enabled: true
  max_candidates: 2
  max_input_chars: 2000
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const sent: string[] = [];
    gw._setChannel('telegram', {
      id: 'telegram',
      onMessage() {},
      async start() {},
      async stop() {},
      async sendText(_peerId, text) {
        sent.push(text);
        return 'msg1';
      },
      async editText() {},
      async sendMedia() {
        return 'media1';
      },
      async sendTyping() {},
    });

    await gw.dispatch(makeMsg({ text: 'remember that we chose SDK-native memory review' }));

    expect(sent).toEqual(['SDK says hi']);
    const pending = await waitForPendingMemory(gw, 'memory-bot');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      source: 'post_run_candidate',
      reviewStatus: 'pending',
      provenance: {
        source: 'post_run_candidate',
        reviewStatus: 'pending',
        runId: expect.any(String),
        sessionKey: 'memory-bot:telegram:dm:peer-123',
        agentId: 'memory-bot',
        sdkSessionId: 'sdk-session-1',
        sourceChannel: 'telegram',
        sourcePeerHash: expect.any(String),
        metadata: {
          kind: 'decision',
          confidence: 0.91,
          reason: 'The run discussed it.',
        },
      },
    });
    expect(pending[0].path).toContain('memory/candidates/');
    expect(metrics.snapshot().counters.memory_candidates_proposed).toBe(1);

    const store = gw.getAgent('memory-bot')!.memoryStore;
    expect(store.textSearch('review', 10)).toEqual([]);

    const updated = gw.updateAgentMemoryEntryReview('memory-bot', pending[0].id, 'approved');
    expect(updated.updated).toBe(true);
    expect(store.textSearch('review', 10).map((result) => result.path)).toEqual([pending[0].path]);

    await gw.stop();
  });
});
