/**
 * Process-wide credential store singleton for the Next.js UI process.
 *
 * Mirrors the lazy-construct pattern used by `ui/lib/gateway.ts`: we don't
 * touch `loadMasterKey()` (which throws if `ANTHROCLAW_MASTER_KEY` is
 * missing) until the first caller actually needs a credential. Route
 * handlers that don't deal with credentials don't pay the cost.
 *
 * The UI runs in its own Node process distinct from the gateway, so the two
 * own independent instances. As long as both processes point at the same
 * `OC_AGENTS_DIR` and use the same master key, they read/write identical
 * encrypted blobs — that's the design.
 */

import type {
  CredentialStore,
} from '@backend/agent/credentials/index.js';
import { EncryptedFilesystemCredentialStore } from '@backend/agent/credentials/encrypted-fs-store.js';
import { CredentialAuditLog } from '@backend/agent/credentials/audit.js';

let cached: CredentialStore | null = null;

export function getCredentialStore(): CredentialStore {
  if (cached) return cached;
  cached = new EncryptedFilesystemCredentialStore(new CredentialAuditLog());
  return cached;
}

/** @internal Reset for tests. */
export function _resetForTest(): void {
  cached = null;
}

/** @internal Inject a mock store for tests. */
export function _setForTest(store: CredentialStore): void {
  cached = store;
}
