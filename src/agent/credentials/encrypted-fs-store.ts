/**
 * Encrypted-on-disk implementation of `CredentialStore`.
 *
 * **Threat model.** Protects credential material at rest from anyone who
 * obtains a snapshot of the filesystem (host backup, container image leak,
 * cold-boot disk image) WITHOUT also obtaining the live process's
 * `ANTHROCLAW_MASTER_KEY`. The key lives only in the gateway env; agents
 * never see plaintext token bytes outside of the in-process `get()` return.
 *
 * **Crypto.** AES-256-GCM with a random 12-byte IV per write. The per-record
 * key is derived via HKDF-SHA256 from the master key, salted with
 * `${agentId}/${service}` — so:
 *   - Even with the master key, an attacker who copies agent A's blob into
 *     agent B's directory cannot decrypt it (different salt → different key).
 *   - The auth tag (16 bytes) covers the whole ciphertext, so any byte flip
 *     fails authentication.
 *
 * **File format.** `[version=1 | iv (12) | tag (16) | ciphertext (variable)]`.
 * Plaintext is `JSON.stringify(credential)` UTF-8 encoded. The leading
 * version byte lets us bump the format later without breaking deployed
 * stores (`get` throws on unexpected versions).
 *
 * **Isolation.** Each credential lives at
 * `<workspaceDir>/credentials/<service>.enc` where `workspaceDir` is the
 * agent's sandboxed root from `agentWorkspaceDir(agentId)`. Per-agent
 * isolation depends on `applyCutoffOptions` (Subsystem 1) honoring
 * workspace dirs at the SDK level — see `src/sdk/cutoff.ts`.
 *
 * **Audit log.** Every `get` / `set` / `delete` writes one row to the
 * `CredentialAuditLog`. `list()` intentionally does NOT write `'get'` rows
 * (decryption is necessary to extract metadata, but emitting a `'get'` per
 * listing entry would pollute the forensic log and obscure real reads —
 * see `list()` below). A future format bump may add an `action: 'list'`
 * row; deferred to keep this commit auditable.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  hkdfSync,
} from 'node:crypto';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { agentWorkspaceDir } from '../sandbox/agent-workspace.js';
import { loadMasterKey } from './master-key.js';
import type {
  CredentialStore,
  CredentialRef,
  OAuthCredential,
  CredentialMetadata,
} from './index.js';
import { CredentialAuditLog } from './audit.js';

/** Format version byte. Bump when the on-disk layout changes. */
const FORMAT_VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = 1 + IV_LEN + TAG_LEN;

/**
 * Per-(agentId, service) AES-256 key derived via HKDF-SHA256 from the master
 * key. Constant-time by virtue of HKDF/Buffer.from + no plaintext-dependent
 * branching here.
 */
function deriveKey(
  masterKey: Buffer,
  agentId: string,
  service: string,
): Buffer {
  const salt = Buffer.from(`${agentId}/${service}`, 'utf-8');
  const info = Buffer.from('credential-key', 'utf-8');
  return Buffer.from(hkdfSync('sha256', masterKey, salt, info, 32));
}

export class EncryptedFilesystemCredentialStore implements CredentialStore {
  private readonly masterKey: Buffer;

  constructor(private readonly auditLog: CredentialAuditLog) {
    // `loadMasterKey()` throws if `ANTHROCLAW_MASTER_KEY` is missing,
    // wrong-length, or non-hex. Construction failure propagates so the
    // gateway fails fast on boot.
    this.masterKey = loadMasterKey();
  }

  async set(ref: CredentialRef, credential: OAuthCredential): Promise<void> {
    const key = deriveKey(this.masterKey, ref.agentId, ref.service);
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const plaintext = Buffer.from(JSON.stringify(credential), 'utf-8');
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const blob = Buffer.concat([Buffer.from([FORMAT_VERSION]), iv, tag, ct]);

    const path = this.pathFor(ref);
    // Mode 0o700 on dir, 0o600 on file: only the gateway process owner can
    // read. mkdir is recursive and idempotent.
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    // writeFile (not appendFile) replaces in full so set→set overwrites
    // cleanly without an append-mode footgun.
    await writeFile(path, blob, { mode: 0o600 });

    await this.auditLog.record({
      ts: Date.now(),
      agentId: ref.agentId,
      service: ref.service,
      action: 'set',
    });
  }

  async get(
    ref: CredentialRef,
    accessReason: string,
  ): Promise<OAuthCredential> {
    const credential = await this.readAndDecrypt(ref);
    await this.auditLog.record({
      ts: Date.now(),
      agentId: ref.agentId,
      service: ref.service,
      action: 'get',
      reason: accessReason,
    });
    return credential;
  }

  /**
   * Decrypt every `.enc` file under the agent's credentials directory and
   * return metadata-only views (token fields stripped).
   *
   * Decryption is unavoidable here — metadata fields (account, expiresAt,
   * scopes) live inside the encrypted blob. We deliberately do NOT call
   * `this.get()` for each entry: doing so would emit one `action: 'get'`
   * audit entry per file per `list()` call, polluting the log and obscuring
   * real credential reads. The forensic record we want is "agent X listed
   * its credentials at time T", which the existing `CredentialAuditEvent`
   * shape doesn't yet model — deferred to a follow-up that extends the
   * action union to include `'list'`.
   */
  async list(agentId: string): Promise<CredentialMetadata[]> {
    const dir = resolve(agentWorkspaceDir(agentId), 'credentials');
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }
    const out: CredentialMetadata[] = [];
    for (const name of entries) {
      if (!name.endsWith('.enc')) continue;
      const service = name.slice(0, -4);
      try {
        // Decrypt inline — same code path as `get()` minus the audit write.
        const cred = await this.readAndDecrypt({ agentId, service });
        const { accessToken: _a, refreshToken: _r, ...meta } = cred;
        out.push(meta);
      } catch {
        // Unreadable / corrupt files are skipped — list() must not fail
        // wholesale because one entry is broken.
      }
    }
    return out;
  }

  /**
   * Idempotent: deleting a non-existent credential resolves successfully.
   * The audit-log entry is written either way — the intent was expressed
   * by the caller, which is forensically interesting on its own.
   */
  async delete(ref: CredentialRef): Promise<void> {
    await unlink(this.pathFor(ref)).catch(() => undefined);
    await this.auditLog.record({
      ts: Date.now(),
      agentId: ref.agentId,
      service: ref.service,
      action: 'delete',
    });
  }

  private pathFor(ref: CredentialRef): string {
    return resolve(
      agentWorkspaceDir(ref.agentId),
      'credentials',
      `${ref.service}.enc`,
    );
  }

  /**
   * Read the file, validate version, and AES-GCM-decrypt. Throws on any
   * failure (missing file, bad version, truncated header, auth-tag mismatch).
   * Does NOT touch the audit log — callers do that explicitly so `list()`
   * can decrypt without polluting the log.
   */
  private async readAndDecrypt(ref: CredentialRef): Promise<OAuthCredential> {
    const blob = await readFile(this.pathFor(ref));
    if (blob.length < HEADER_LEN) {
      throw new Error(
        `credential file truncated: expected at least ${HEADER_LEN} bytes, got ${blob.length}`,
      );
    }
    if (blob[0] !== FORMAT_VERSION) {
      throw new Error(`unsupported credential file version: ${blob[0]}`);
    }
    const iv = blob.subarray(1, 1 + IV_LEN);
    const tag = blob.subarray(1 + IV_LEN, HEADER_LEN);
    const ct = blob.subarray(HEADER_LEN);
    const key = deriveKey(this.masterKey, ref.agentId, ref.service);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(plaintext.toString('utf-8')) as OAuthCredential;
  }
}
