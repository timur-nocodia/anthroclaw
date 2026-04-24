import { describe, expect, it } from 'vitest';
import { Gateway } from '../src/gateway.js';

describe('Gateway file ownership surface', () => {
  it('lists and mutates active file ownership claims for an agent', () => {
    const gw = new Gateway();
    gw._agents.set('agent-1', { id: 'agent-1' } as any);

    const decision = gw._fileOwnershipRegistry.claim({
      sessionKey: 'session-key-1',
      runId: 'run-1',
      subagentId: 'coder',
      path: '/repo/src/app.ts',
      mode: 'write',
    }, 'soft');

    const view = gw.listAgentFileOwnership('agent-1', { sessionKey: 'session-key-1' });
    expect(view.claims).toMatchObject([{
      claimId: decision.claim!.claimId,
      sessionKey: 'session-key-1',
      runId: 'run-1',
      subagentId: 'coder',
      path: '/repo/src/app.ts',
      mode: 'write',
    }]);
    expect(view.conflicts).toEqual([]);

    const result = gw.mutateFileOwnershipClaim('agent-1', decision.claim!.claimId, 'release');
    expect(result).toEqual({
      claimId: decision.claim!.claimId,
      action: 'release',
      released: true,
    });
    expect(gw.listAgentFileOwnership('agent-1').claims).toEqual([]);
  });

  it('requires a known agent before exposing ownership state', () => {
    const gw = new Gateway();
    expect(() => gw.listAgentFileOwnership('missing')).toThrow('Agent "missing" not found');
    expect(() => gw.mutateFileOwnershipClaim('missing', 'claim-1', 'override')).toThrow('Agent "missing" not found');
  });
});
