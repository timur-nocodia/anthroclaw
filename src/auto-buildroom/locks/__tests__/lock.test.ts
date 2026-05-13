import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeBuildroomStorage } from '../../storage/init.js';
import { FileBuildroomLock, BuildroomLockHeldError } from '../lock.js';

describe('FileBuildroomLock', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'anthroclaw-buildroom-lock-'));
    initializeBuildroomStorage({
      projectRoot: root,
      roomId: 'anthroclaw-core',
      operatorId: 'cli:user:local-operator',
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('acquires and releases a lock with a stable idempotency key', () => {
    const lock = new FileBuildroomLock({ projectRoot: root });
    const acquired = lock.acquire({
      roomId: 'anthroclaw-core',
      approvalId: 'approval_20260512_docs',
      buildPlanId: 'plan_20260512_docs',
      owner: 'cli:test',
      now: '2026-05-12T00:00:00.000Z',
    });

    expect(acquired.idempotencyKey).toBe(
      'anthroclaw-core:approval_20260512_docs:plan_20260512_docs',
    );
    expect(lock.isHeld(acquired.idempotencyKey)).toBe(true);

    lock.release(acquired);

    expect(lock.isHeld(acquired.idempotencyKey)).toBe(false);
  });

  it('rejects duplicate acquisition for the same room approval and plan', () => {
    const lock = new FileBuildroomLock({ projectRoot: root });
    lock.acquire({
      roomId: 'anthroclaw-core',
      approvalId: 'approval_20260512_docs',
      buildPlanId: 'plan_20260512_docs',
      owner: 'cli:first',
      now: '2026-05-12T00:00:00.000Z',
    });

    expect(() =>
      lock.acquire({
        roomId: 'anthroclaw-core',
        approvalId: 'approval_20260512_docs',
        buildPlanId: 'plan_20260512_docs',
        owner: 'cli:second',
        now: '2026-05-12T00:00:01.000Z',
      }),
    ).toThrow(BuildroomLockHeldError);
  });
});

