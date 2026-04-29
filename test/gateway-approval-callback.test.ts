import { describe, it, expect } from 'vitest';
import { Gateway } from '../src/gateway.js';

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
});
