/**
 * @e2e — Gateway on_after_query payload contract.
 *
 * Verifies that gateway.dispatch emits `on_after_query` with `newMessages`
 * (user + assistant turn), not just the legacy `response` string. Plugin
 * mirror hooks (e.g. LCM) consume `newMessages` to ingest a turn into
 * their own stores.
 *
 * Regression: gateway previously emitted only `{agentId, sessionKey,
 * response}` — LCM mirror hook got `newMessages: undefined` and silently
 * skipped every turn, so the per-agent SQLite stayed empty in production.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { InboundMessage } from '../src/channels/types.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const real = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return {
    ...real,
    startup: vi.fn(async () => { throw new Error('mocked: no SDK in tests'); }),
  };
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const PLUGINS_DIR = resolve(REPO_ROOT, 'plugins');

describe('@e2e: gateway on_after_query payload includes newMessages', () => {
  let tmpDataDir: string;
  let tmpAgentsDir: string;

  afterEach(() => {
    if (tmpDataDir) rmSync(tmpDataDir, { recursive: true, force: true });
    if (tmpAgentsDir) rmSync(tmpAgentsDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('dispatch -> emit("on_after_query") includes newMessages [user, assistant]', async () => {
    tmpDataDir = mkdtempSync(join(tmpdir(), 'gw-payload-data-'));
    tmpAgentsDir = mkdtempSync(join(tmpdir(), 'gw-payload-agents-'));

    mkdirSync(join(tmpAgentsDir, 'test-agent'));
    writeFileSync(
      join(tmpAgentsDir, 'test-agent', 'agent.yml'),
      [
        'safety_profile: trusted',
        'routes:',
        '  - channel: telegram',
        '    scope: dm',
        'queue_mode: serial',
      ].join('\n') + '\n',
    );
    writeFileSync(join(tmpAgentsDir, 'test-agent', 'CLAUDE.md'), '# test agent\n');

    const config = {
      defaults: {
        model: 'claude-sonnet-4-6',
        embedding_provider: 'off' as const,
        embedding_model: 'text-embedding-3-small',
        debounce_ms: 0,
      },
    };

    const { Gateway } = await import('../src/gateway.js');
    const gateway = new Gateway();

    try {
      // Mock queryAgent to skip real SDK invocation.
      const queryAgentSpy = vi
        .spyOn(Gateway.prototype as never, 'queryAgent' as never)
        .mockImplementation(async () => 'hello world reply' as never);

      await gateway.start(config as never, tmpAgentsDir, tmpDataDir, PLUGINS_DIR);

      // Subscribe to on_after_query on the test-agent emitter.
      const emitter = gateway._hookEmitters.get('test-agent');
      expect(emitter, 'expected hook emitter for test-agent').toBeDefined();

      const seenPayloads: Array<Record<string, unknown>> = [];
      emitter!.subscribe('on_after_query', (payload) => {
        seenPayloads.push(payload);
      });

      // Synthetic Telegram dispatch.
      const inbound: InboundMessage = {
        channel: 'telegram',
        accountId: 'main',
        chatType: 'dm',
        peerId: '12345',
        senderId: '12345',
        text: 'ping',
        messageId: 'msg-1',
        mentionedBot: false,
        raw: {},
      };

      await gateway.dispatch(inbound);

      // Queue + emit are async. Wait briefly for drain.
      await new Promise<void>((r) => setTimeout(r, 200));

      expect(queryAgentSpy).toHaveBeenCalledTimes(1);
      expect(seenPayloads.length).toBe(1);

      const payload = seenPayloads[0]!;
      expect(payload.agentId).toBe('test-agent');
      expect(payload.sessionKey).toMatch(/^test-agent:telegram:dm:12345/);
      expect(payload.response).toBe('hello world reply');
      expect(payload.source).toBe('telegram');

      const newMessages = payload.newMessages as Array<{ role: string; content: string; ts: number }>;
      expect(Array.isArray(newMessages)).toBe(true);
      expect(newMessages).toHaveLength(2);

      expect(newMessages[0]).toMatchObject({ role: 'user', content: 'ping' });
      expect(typeof newMessages[0]!.ts).toBe('number');

      expect(newMessages[1]).toMatchObject({ role: 'assistant', content: 'hello world reply' });
      expect(typeof newMessages[1]!.ts).toBe('number');
    } finally {
      await gateway.stop();
    }
  }, 30_000);

  it('omits user entry when msg.text is empty (media-only message)', async () => {
    tmpDataDir = mkdtempSync(join(tmpdir(), 'gw-payload-empty-data-'));
    tmpAgentsDir = mkdtempSync(join(tmpdir(), 'gw-payload-empty-agents-'));

    mkdirSync(join(tmpAgentsDir, 'test-agent'));
    writeFileSync(
      join(tmpAgentsDir, 'test-agent', 'agent.yml'),
      [
        'safety_profile: trusted',
        'routes:',
        '  - channel: telegram',
        '    scope: dm',
        'queue_mode: serial',
      ].join('\n') + '\n',
    );
    writeFileSync(join(tmpAgentsDir, 'test-agent', 'CLAUDE.md'), '# test agent\n');

    const config = {
      defaults: {
        model: 'claude-sonnet-4-6',
        embedding_provider: 'off' as const,
        embedding_model: 'text-embedding-3-small',
        debounce_ms: 0,
      },
    };

    const { Gateway } = await import('../src/gateway.js');
    const gateway = new Gateway();

    try {
      vi.spyOn(Gateway.prototype as never, 'queryAgent' as never)
        .mockImplementation(async () => 'response only' as never);

      await gateway.start(config as never, tmpAgentsDir, tmpDataDir, PLUGINS_DIR);

      const emitter = gateway._hookEmitters.get('test-agent');
      const seenPayloads: Array<Record<string, unknown>> = [];
      emitter!.subscribe('on_after_query', (payload) => {
        seenPayloads.push(payload);
      });

      const inbound: InboundMessage = {
        channel: 'telegram',
        accountId: 'main',
        chatType: 'dm',
        peerId: '99999',
        senderId: '99999',
        text: '',                      // empty (media-only)
        messageId: 'msg-2',
        mentionedBot: false,
        raw: {},
      };

      await gateway.dispatch(inbound);
      await new Promise<void>((r) => setTimeout(r, 200));

      expect(seenPayloads.length).toBe(1);
      const newMessages = seenPayloads[0]!.newMessages as Array<{ role: string }>;
      expect(newMessages).toHaveLength(1);
      expect(newMessages[0]!.role).toBe('assistant');
    } finally {
      await gateway.stop();
    }
  }, 30_000);
});
