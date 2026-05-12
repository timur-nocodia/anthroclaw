import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openPendingStore,
  type PendingStore,
  type PendingConnection,
} from '../pending-store.js';

describe('PendingStore', () => {
  let dir: string;
  let store: PendingStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-pending-'));
    store = openPendingStore(join(dir, 'mcp.sqlite'));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates schema on first open', () => {
    expect(store.list()).toEqual([]);
  });
});
