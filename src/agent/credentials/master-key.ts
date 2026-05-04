/**
 * Master key loader for the encrypted credential store.
 *
 * Reads a 32-byte (64 hex char) AES-256-GCM key from the
 * `ANTHROCLAW_MASTER_KEY` environment variable. Used by
 * `EncryptedFilesystemCredentialStore` (Task 8) at construction time.
 */

export const MASTER_KEY_ENV = 'ANTHROCLAW_MASTER_KEY';

/** Required exact length of the hex-encoded key (32 bytes = 64 hex chars). */
const KEY_HEX_LENGTH = 64;

/**
 * Load and validate the master key from `process.env`.
 *
 * Validation order matters:
 *   1. presence
 *   2. exact length (== 64 hex chars)
 *   3. hex format (regex check before `Buffer.from`, which would silently
 *      truncate on invalid hex chars)
 *
 * @throws Error if missing, wrong length, or not hex.
 * @returns 32-byte Buffer suitable for AES-256-GCM.
 */
export function loadMasterKey(): Buffer {
  const raw = process.env[MASTER_KEY_ENV];

  if (!raw) {
    throw new Error(
      `${MASTER_KEY_ENV} env var is required. ` +
        `Generate one with: openssl rand -hex 32`,
    );
  }

  if (raw.length !== KEY_HEX_LENGTH) {
    throw new Error(
      `${MASTER_KEY_ENV} has wrong length — expected exactly ${KEY_HEX_LENGTH} ` +
        `hex chars (32 bytes for AES-256-GCM), got ${raw.length}`,
    );
  }

  if (!/^[0-9a-fA-F]+$/.test(raw)) {
    throw new Error(
      `${MASTER_KEY_ENV} must be hex-encoded (chars 0-9, a-f, A-F only)`,
    );
  }

  return Buffer.from(raw, 'hex');
}
