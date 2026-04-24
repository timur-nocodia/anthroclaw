import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AccessControl } from '../../src/routing/access.js';
import type { AccessResult } from '../../src/routing/access.js';

describe('AccessControl', () => {
  let tmpDir: string;

  function makeTmp(): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'access-test-'));
    return tmpDir;
  }

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('allows allowlisted sender immediately', () => {
    const ac = new AccessControl(makeTmp());
    const result = ac.check('bot1', 'user42', 'telegram', {
      allowlist: { telegram: ['user42'] },
      pairing: { mode: 'off' },
    });
    expect(result).toEqual({ allowed: true });
  });

  it('allows wildcard allowlist (*)', () => {
    const ac = new AccessControl(makeTmp());
    const result = ac.check('bot1', 'anyone', 'telegram', {
      allowlist: { telegram: ['*'] },
      pairing: { mode: 'off' },
    });
    expect(result).toEqual({ allowed: true });
  });

  it('denies with mode off and no allowlist', () => {
    const ac = new AccessControl(makeTmp());
    const result = ac.check('bot1', 'stranger', 'telegram', {
      pairing: { mode: 'off' },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it('returns pairing_required for code mode', () => {
    const ac = new AccessControl(makeTmp());
    const result = ac.check('bot1', 'newuser', 'telegram', {
      pairing: { mode: 'code', code: 'secret123' },
    });
    expect(result.allowed).toBe(false);
    expect(result.pairingType).toBe('code');
  });

  it('approves on correct code', () => {
    const dir = makeTmp();
    const ac = new AccessControl(dir);
    const config = { pairing: { mode: 'code', code: 'secret123' } };

    // Initially not allowed
    const before = ac.check('bot1', 'newuser', 'telegram', config);
    expect(before.allowed).toBe(false);

    // Try correct code
    const ok = ac.tryCode('bot1', 'newuser', 'secret123', config);
    expect(ok).toBe(true);

    // Now allowed
    const after = ac.check('bot1', 'newuser', 'telegram', config);
    expect(after.allowed).toBe(true);
  });

  it('rejects wrong code', () => {
    const ac = new AccessControl(makeTmp());
    const config = { pairing: { mode: 'code', code: 'secret123' } };

    const ok = ac.tryCode('bot1', 'newuser', 'wrongcode', config);
    expect(ok).toBe(false);

    // Still not allowed
    const result = ac.check('bot1', 'newuser', 'telegram', config);
    expect(result.allowed).toBe(false);
  });

  it('auto-approves in open mode', () => {
    const ac = new AccessControl(makeTmp());
    const result = ac.check('bot1', 'anyone', 'telegram', {
      pairing: { mode: 'open' },
    });
    expect(result.allowed).toBe(true);
  });

  it('persists and reloads approvals', () => {
    const dir = makeTmp();

    // First instance: approve via code
    const ac1 = new AccessControl(dir);
    const config = { pairing: { mode: 'code', code: 'abc' } };
    ac1.tryCode('bot1', 'user1', 'abc', config);
    expect(ac1.check('bot1', 'user1', 'telegram', config).allowed).toBe(true);

    // Second instance: reload from disk
    const ac2 = new AccessControl(dir);
    expect(ac2.check('bot1', 'user1', 'telegram', config).allowed).toBe(true);
  });

  it('adds to pending for approve mode', () => {
    const ac = new AccessControl(makeTmp());
    const result = ac.check('bot1', 'newuser', 'telegram', {
      pairing: { mode: 'approve', approver_chat_id: 'admin1' },
    });
    expect(result.allowed).toBe(false);
    expect(result.pairingType).toBe('approve');
  });

  it('approveManually works for pending sender', () => {
    const dir = makeTmp();
    const ac = new AccessControl(dir);
    const config = {
      pairing: { mode: 'approve', approver_chat_id: 'admin1' },
    };

    // Trigger pending
    ac.check('bot1', 'newuser', 'telegram', config);

    // Manually approve
    const ok = ac.approveManually('bot1', 'newuser');
    expect(ok).toBe(true);

    // Now allowed
    const result = ac.check('bot1', 'newuser', 'telegram', config);
    expect(result.allowed).toBe(true);
  });

  it('forceApprove works without pending', () => {
    const dir = makeTmp();
    const ac = new AccessControl(dir);
    ac.forceApprove('bot1', 'user99');
    const result = ac.check('bot1', 'user99', 'telegram', { pairing: { mode: 'off' } });
    expect(result.allowed).toBe(true);
  });

  it('revoke removes approved user', () => {
    const dir = makeTmp();
    const ac = new AccessControl(dir);
    ac.forceApprove('bot1', 'user1');
    expect(ac.listApproved('bot1')).toContain('user1');

    const ok = ac.revoke('bot1', 'user1');
    expect(ok).toBe(true);
    expect(ac.listApproved('bot1')).not.toContain('user1');
  });

  it('revoke returns false when user not approved', () => {
    const ac = new AccessControl(makeTmp());
    expect(ac.revoke('bot1', 'ghost')).toBe(false);
  });

  it('listPending returns pending senders', () => {
    const ac = new AccessControl(makeTmp());
    ac.check('bot1', 'user1', 'telegram', {
      pairing: { mode: 'approve', approver_chat_id: 'admin' },
    });
    expect(ac.listPending('bot1')).toEqual(['user1']);
  });

  it('listApproved returns approved senders', () => {
    const ac = new AccessControl(makeTmp());
    ac.forceApprove('bot1', 'user-a');
    ac.forceApprove('bot1', 'user-b');
    expect(ac.listApproved('bot1')).toEqual(['user-a', 'user-b']);
  });

  it('listPending/listApproved return empty for unknown agent', () => {
    const ac = new AccessControl(makeTmp());
    expect(ac.listPending('unknown')).toEqual([]);
    expect(ac.listApproved('unknown')).toEqual([]);
  });
});
