import { describe, expect, it } from 'vitest';
import {
  parseDirectWebhookPayload,
  renderDirectWebhook,
  verifyDirectWebhookSecret,
} from '../../src/webhooks/direct.js';
import type { DirectWebhookConfig } from '../../src/webhooks/direct.js';

function headers(values: Record<string, string>) {
  return {
    get(name: string): string | null {
      return values[name.toLowerCase()] ?? null;
    },
  };
}

const baseConfig: DirectWebhookConfig = {
  enabled: true,
  secret: 'secret-1',
  deliver_to: {
    channel: 'telegram',
    peer_id: 'peer-1',
  },
  template: 'CI {status}: {repo}#{run_number} {ignored}',
  fields: ['status', 'repo', 'run_number'],
  max_payload_bytes: 32_768,
};

describe('direct webhooks', () => {
  it('verifies supported secret headers', () => {
    expect(verifyDirectWebhookSecret(headers({ 'x-anthroclaw-webhook-secret': 'secret-1' }), 'secret-1')).toBe(true);
    expect(verifyDirectWebhookSecret(headers({ authorization: 'Bearer secret-1' }), 'secret-1')).toBe(true);
    expect(verifyDirectWebhookSecret(headers({ 'x-webhook-secret': 'wrong' }), 'secret-1')).toBe(false);
  });

  it('bounds and parses JSON object payloads', () => {
    expect(parseDirectWebhookPayload('{"status":"ok"}', 100)).toEqual({ status: 'ok' });
    expect(() => parseDirectWebhookPayload('[]', 100)).toThrow('JSON object');
    expect(() => parseDirectWebhookPayload('{"status":"too-big"}', 5)).toThrow('exceeds');
  });

  it('renders only allowlisted template fields', () => {
    const rendered = renderDirectWebhook(baseConfig, {
      status: 'passed',
      repo: 'anthroclaw',
      run_number: 42,
      ignored: 'must-not-render',
    });

    expect(rendered.text).toBe('CI passed: anthroclaw#42 ');
    expect(rendered.payload).toEqual({
      status: 'passed',
      repo: 'anthroclaw',
      run_number: 42,
    });
  });
});
