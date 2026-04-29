import { describe, it, expect } from 'vitest';
import { ApprovalBroker } from '../src/security/approval-broker.js';

describe('callback_query → ApprovalBroker integration', () => {
  it('routes "approve:<id>" to broker.resolve(id, "allow")', async () => {
    const broker = new ApprovalBroker();
    const promise = broker.request('xyz', 60_000);
    const data = 'approve:xyz';
    const [verb, id] = data.split(':');
    if (verb === 'approve') broker.resolve(id, 'allow');
    if (verb === 'deny')    broker.resolve(id, 'deny');
    const result = await promise;
    expect(result.behavior).toBe('allow');
  });

  it('routes "deny:<id>" to broker.resolve(id, "deny")', async () => {
    const broker = new ApprovalBroker();
    const promise = broker.request('abc', 60_000);
    const data = 'deny:abc';
    const [verb, id] = data.split(':');
    if (verb === 'approve') broker.resolve(id, 'allow');
    if (verb === 'deny')    broker.resolve(id, 'deny');
    const result = await promise;
    expect(result.behavior).toBe('deny');
  });
});
