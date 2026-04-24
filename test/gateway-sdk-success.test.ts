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

function createQueryForPrompt(prompt: unknown) {
  const text = typeof prompt === 'string' ? prompt : '';

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

describe('Gateway SDK success path', () => {
  let tmpDir: string;
  let agentsDir: string;
  let dataDir: string;

  beforeEach(() => {
    metrics._reset();
    startupMock.mockReset();
    queryMock.mockReset();

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
        status: 'succeeded',
      },
    });

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
});
