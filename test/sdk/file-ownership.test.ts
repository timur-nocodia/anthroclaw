import { describe, expect, it } from 'vitest';
import { FileOwnershipRegistry } from '../../src/sdk/file-ownership.js';

describe('FileOwnershipRegistry', () => {
  it('allows non-conflicting read claims for sibling subagents', () => {
    const registry = new FileOwnershipRegistry();

    const first = registry.claim({
      sessionKey: 'session-1',
      runId: 'run-a',
      subagentId: 'researcher',
      path: './src/app.ts',
      mode: 'read',
    }, 'strict', 1000);
    const second = registry.claim({
      sessionKey: 'session-1',
      runId: 'run-b',
      subagentId: 'reviewer',
      path: 'src/app.ts',
      mode: 'read',
    }, 'strict', 1001);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(second.conflicts).toHaveLength(0);
    expect(registry.listClaims({ sessionKey: 'session-1' }, 1002)).toHaveLength(2);
  });

  it('records and allows sibling write conflicts in soft mode', () => {
    const registry = new FileOwnershipRegistry();

    registry.claim({
      sessionKey: 'session-1',
      runId: 'run-a',
      subagentId: 'coder-a',
      path: 'src/app.ts',
      mode: 'write',
    }, 'soft', 1000);

    const decision = registry.claim({
      sessionKey: 'session-1',
      runId: 'run-b',
      subagentId: 'coder-b',
      path: './src/app.ts',
      mode: 'write',
    }, 'soft', 1001);

    expect(decision.allowed).toBe(true);
    expect(decision.conflicts).toMatchObject([{
      path: 'src/app.ts',
      action: 'allow',
      requested: { subagentId: 'coder-b' },
      existing: { subagentId: 'coder-a' },
    }]);
    expect(registry.listClaims({ path: 'src/app.ts' }, 1002)).toHaveLength(2);
    expect(registry.listConflicts({ action: 'allow' })).toHaveLength(1);
  });

  it('denies conflicting write claims in strict mode', () => {
    const registry = new FileOwnershipRegistry();

    registry.claim({
      sessionKey: 'session-1',
      runId: 'run-a',
      subagentId: 'coder-a',
      path: 'src/app.ts',
      mode: 'write',
    }, 'strict', 1000);

    const decision = registry.claim({
      sessionKey: 'session-1',
      runId: 'run-b',
      subagentId: 'coder-b',
      path: 'src/app.ts',
      mode: 'write',
    }, 'strict', 1001);

    expect(decision.allowed).toBe(false);
    expect(decision.claim).toBeUndefined();
    expect(decision.conflicts[0]).toMatchObject({
      action: 'deny',
      reason: 'strict file ownership blocks conflicting subagent write',
    });
    expect(registry.listClaims({ path: 'src/app.ts' }, 1002)).toHaveLength(1);
    expect(registry.listConflicts({ action: 'deny' })).toHaveLength(1);
  });

  it('expires, releases, and overrides claims', () => {
    const registry = new FileOwnershipRegistry();
    const first = registry.claim({
      sessionKey: 'session-1',
      runId: 'run-a',
      subagentId: 'coder-a',
      path: 'src/app.ts',
      mode: 'write',
      ttlMs: 10,
    }, 'strict', 1000);

    expect(first.claim).toBeDefined();
    expect(registry.listClaims({}, 1005)).toHaveLength(1);
    expect(registry.listClaims({}, 1011)).toHaveLength(0);

    const second = registry.claim({
      sessionKey: 'session-1',
      runId: 'run-b',
      subagentId: 'coder-b',
      path: 'src/next.ts',
      mode: 'write',
    }, 'strict', 2000);
    expect(registry.overrideClaim(second.claim!.claimId)).toBe(true);
    expect(registry.listClaims()).toHaveLength(0);
  });

  it('releases all claims for a run or session', () => {
    const registry = new FileOwnershipRegistry();
    registry.claim({
      sessionKey: 'session-1',
      runId: 'run-a',
      subagentId: 'coder-a',
      path: 'a.ts',
      mode: 'write',
    });
    registry.claim({
      sessionKey: 'session-1',
      runId: 'run-b',
      subagentId: 'coder-b',
      path: 'b.ts',
      mode: 'write',
    });

    expect(registry.releaseRun('run-a')).toBe(1);
    expect(registry.listClaims({ sessionKey: 'session-1' })).toHaveLength(1);
    expect(registry.releaseSession('session-1')).toBe(1);
    expect(registry.listClaims({ sessionKey: 'session-1' })).toHaveLength(0);
  });
});
