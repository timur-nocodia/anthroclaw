import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { autoBuildroomRoot } from '../storage/init.js';

export interface FileBuildroomLockOptions {
  projectRoot: string;
}

export interface AcquireBuildroomLockOptions {
  roomId: string;
  approvalId: string;
  buildPlanId: string;
  owner: string;
  now: string;
}

export interface BuildroomLockHandle {
  idempotencyKey: string;
  path: string;
  owner: string;
}

export class BuildroomLockHeldError extends Error {
  constructor(idempotencyKey: string) {
    super(`Buildroom lock already held: ${idempotencyKey}`);
    this.name = 'BuildroomLockHeldError';
  }
}

export class FileBuildroomLock {
  private readonly locksRoot: string;

  constructor(opts: FileBuildroomLockOptions) {
    this.locksRoot = join(autoBuildroomRoot(opts.projectRoot), 'locks');
  }

  acquire(opts: AcquireBuildroomLockOptions): BuildroomLockHandle {
    mkdirSync(this.locksRoot, { recursive: true });
    const idempotencyKey = `${opts.roomId}:${opts.approvalId}:${opts.buildPlanId}`;
    const path = join(this.locksRoot, `${encodeURIComponent(idempotencyKey)}.lock.json`);
    const handle = { idempotencyKey, path, owner: opts.owner };

    try {
      writeFileSync(
        path,
        `${JSON.stringify({
          schemaVersion: 'auto-buildroom/v1',
          idempotencyKey,
          roomId: opts.roomId,
          approvalId: opts.approvalId,
          buildPlanId: opts.buildPlanId,
          owner: opts.owner,
          acquiredAt: opts.now,
        }, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx' },
      );
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        throw new BuildroomLockHeldError(idempotencyKey);
      }
      throw error;
    }

    return handle;
  }

  release(handle: BuildroomLockHandle): void {
    if (existsSync(handle.path)) unlinkSync(handle.path);
  }

  isHeld(idempotencyKey: string): boolean {
    return existsSync(join(this.locksRoot, `${encodeURIComponent(idempotencyKey)}.lock.json`));
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'EEXIST',
  );
}

