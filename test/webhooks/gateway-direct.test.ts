import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gateway } from '../../src/gateway.js';
import type { ChannelAdapter, InboundMessage, OutboundMedia, SendOptions } from '../../src/channels/types.js';
import type { GlobalConfig } from '../../src/config/schema.js';
import { metrics } from '../../src/metrics/collector.js';
import { MetricsStore } from '../../src/metrics/store.js';

class MockChannel implements ChannelAdapter {
  readonly id = 'telegram' as const;
  sendText = vi.fn(async (_peerId: string, _text: string, _opts?: SendOptions) => 'msg-1');
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  onMessage(_handler: (msg: InboundMessage) => Promise<void>): void {}
  async editText(_peerId: string, _messageId: string, _text: string, _opts?: SendOptions): Promise<void> {}
  async sendMedia(_peerId: string, _media: OutboundMedia, _opts?: SendOptions): Promise<string> { return 'msg-1'; }
  async sendTyping(_peerId: string, _accountId?: string): Promise<void> {}
}

function headers(secret: string) {
  return {
    get(name: string): string | null {
      return name.toLowerCase() === 'x-anthroclaw-webhook-secret' ? secret : null;
    },
  };
}

function config(enabled = true): GlobalConfig {
  return {
    defaults: {
      model: 'claude-sonnet-4-6',
      embedding_provider: 'openai',
      embedding_model: 'text-embedding-3-small',
      debounce_ms: 0,
    },
    webhooks: {
      ci: {
        enabled,
        secret: 'secret-1',
        deliver_to: {
          channel: 'telegram',
          peer_id: 'peer-1',
          account_id: 'default',
          thread_id: 'topic-1',
        },
        template: 'CI {status}: {repo}#{run_number}',
        fields: ['status', 'repo', 'run_number'],
        max_payload_bytes: 1024,
      },
    },
  };
}

describe('Gateway direct webhook delivery', () => {
  let tmpDir: string;
  let store: MetricsStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gateway-webhook-'));
    store = new MetricsStore(join(tmpDir, 'metrics.sqlite'));
    metrics._reset();
    metrics.setStore(store);
  });

  afterEach(() => {
    metrics._reset();
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('delivers to configured channel without starting an agent query', async () => {
    const gw = new Gateway();
    const channel = new MockChannel();
    (gw as any).globalConfig = config();
    (gw as any).channels.set('telegram', channel);
    const querySpy = vi.spyOn(gw as any, 'startQuery');

    const result = await gw.deliverDirectWebhook('ci', '{"status":"passed","repo":"anthroclaw","run_number":42}', headers('secret-1'));

    expect(result).toMatchObject({ delivered: true, status: 'delivered', messageId: 'msg-1' });
    expect(channel.sendText).toHaveBeenCalledWith('peer-1', 'CI passed: anthroclaw#42', {
      accountId: 'default',
      threadId: 'topic-1',
      parseMode: 'plain',
    });
    expect(querySpy).not.toHaveBeenCalled();
    expect(gw.listDirectWebhookDeliveries({ webhook: 'ci' })).toMatchObject([{
      webhook: 'ci',
      status: 'delivered',
      delivered: true,
      channel: 'telegram',
      accountId: 'default',
      peerId: 'peer-1',
      threadId: 'topic-1',
      messageId: 'msg-1',
    }]);
  });

  it('rejects disabled and unauthorized webhooks before delivery', async () => {
    const gw = new Gateway();
    const channel = new MockChannel();
    (gw as any).globalConfig = config(false);
    (gw as any).channels.set('telegram', channel);

    await expect(gw.deliverDirectWebhook('ci', '{}', headers('secret-1'))).resolves.toMatchObject({
      delivered: false,
      status: 'disabled',
    });

    (gw as any).globalConfig = config(true);
    await expect(gw.deliverDirectWebhook('ci', '{}', headers('wrong'))).resolves.toMatchObject({
      delivered: false,
      status: 'unauthorized',
    });
    expect(channel.sendText).not.toHaveBeenCalled();
    expect(gw.listDirectWebhookDeliveries({ webhook: 'ci' }).map((event) => event.status)).toEqual([
      'unauthorized',
      'disabled',
    ]);
  });
});
