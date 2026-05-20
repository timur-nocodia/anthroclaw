import { describe, it, expect, vi } from 'vitest';
import { Gateway } from '../src/gateway.js';
import type { InboundMessage } from '../src/channels/types.js';

describe('Gateway.handleApprovalCallback → ApprovalBroker integration', () => {
  it('routes "approve:<id>" via real handleApprovalCallback → allow + input preserved', async () => {
    const gw = new Gateway();
    const broker = gw.getApprovalBroker();
    const input = { foo: 'bar' };
    const promise = broker.request('xyz', 60_000, 'sender-A', input);

    const result = gw.handleApprovalCallback('approve:xyz', 'sender-A');
    expect(result).toBe(true);

    const r = await promise;
    expect(r.behavior).toBe('allow');
    expect((r as any).updatedInput).toEqual(input);
  });

  it('routes "deny:<id>" via real handleApprovalCallback → deny', async () => {
    const gw = new Gateway();
    const broker = gw.getApprovalBroker();
    const promise = broker.request('abc', 60_000, 'sender-A', {});

    const result = gw.handleApprovalCallback('deny:abc', 'sender-A');
    expect(result).toBe(true);

    const r = await promise;
    expect(r.behavior).toBe('deny');
  });

  it('rejects mismatched sender — returns false, pending stays active', async () => {
    const gw = new Gateway();
    const broker = gw.getApprovalBroker();
    const promise = broker.request('xyz2', 60_000, 'sender-A', {});

    const result = gw.handleApprovalCallback('approve:xyz2', 'sender-B');
    expect(result).toBe(false);

    // Request must still be pending — clean up with the correct sender
    broker.resolveBySender('xyz2', 'sender-A', 'deny');
    const r = await promise;
    expect(r.behavior).toBe('deny');
  });

  it('unrecognised payload returns false', () => {
    const gw = new Gateway();
    expect(gw.handleApprovalCallback('model:something', 'any-sender')).toBe(false);
    expect(gw.handleApprovalCallback('', 'any-sender')).toBe(false);
    expect(gw.handleApprovalCallback('approve:', 'any-sender')).toBe(false);
  });

  it('matching sender allow resolves allow with original input', async () => {
    const gw = new Gateway();
    const broker = gw.getApprovalBroker();
    const input = { command: 'ls /tmp', reason: 'test' };
    const promise = broker.request('tool-req-1', 60_000, 'user-42', input);

    gw.handleApprovalCallback('approve:tool-req-1', 'user-42');
    const r = await promise;
    expect(r.behavior).toBe('allow');
    expect((r as any).updatedInput).toEqual(input);
  });

  it('prevents callback replay after a durable approval is resolved', async () => {
    const gw = new Gateway();
    const broker = gw.getApprovalBroker();
    const promise = broker.request('replay-1', 60_000, 'sender-A', {});

    expect(gw.handleApprovalCallback('approve:replay-1', 'sender-A')).toBe(true);
    expect(gw.handleApprovalCallback('deny:replay-1', 'sender-A')).toBe(false);

    const r = await promise;
    expect(r.behavior).toBe('allow');
    expect(broker.get('replay-1')).toMatchObject({ status: 'allowed', decision: 'allow' });
  });

  it('routes WhatsApp /approve text-code replies through the approval broker', async () => {
    const gw = new Gateway() as unknown as {
      getApprovalBroker(): Gateway['getApprovalBroker'] extends () => infer R ? R : never;
      handleApprovalTextReply(msg: InboundMessage): Promise<boolean>;
      channels: Map<string, unknown>;
    };
    const sendText = vi.fn(async () => 'ack-1');
    gw.channels.set('whatsapp', {
      approvalMode: 'text_code',
      sendText,
    });
    const broker = gw.getApprovalBroker();
    const promise = broker.request('wa-approval-1', 60_000, 'sender-A', { action: 'send' });

    const handled = await gw.handleApprovalTextReply({
      channel: 'whatsapp',
      accountId: 'default',
      chatType: 'dm',
      peerId: '123@s.whatsapp.net',
      senderId: 'sender-A',
      text: '/approve wa-approval-1',
      messageId: 'msg-1',
      mentionedBot: false,
      raw: {},
    });

    expect(handled).toBe(true);
    expect(sendText).toHaveBeenCalledWith(
      '123@s.whatsapp.net',
      'Approval recorded.',
      expect.objectContaining({ accountId: 'default', parseMode: 'plain' }),
    );
    expect((await promise).behavior).toBe('allow');
  });
});
