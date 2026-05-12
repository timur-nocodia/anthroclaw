import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadMasterKey } from '../agent/credentials/master-key.js';
import {
  formatSecretRef,
  parseSecretRef,
  type SecretRef,
} from './ref.js';

const FORMAT_VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = 1 + IV_LEN + TAG_LEN;

export interface StoredSecret {
  ref: string;
  value: string;
  label?: string;
  createdAt: string;
  updatedAt: string;
}

export type SecretMetadata = Omit<StoredSecret, 'value'> & {
  scope: SecretRef['scope'];
  ownerId?: string;
  service: string;
  key: string;
};

export interface SetSecretInput extends SecretRef {
  value: string;
  label?: string;
}

function dataRoot(): string {
  return resolve(process.env.OC_DATA_DIR ?? 'data');
}

function secretsRoot(): string {
  return resolve(dataRoot(), 'secrets');
}

function deriveKey(masterKey: Buffer, ref: string): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      masterKey,
      Buffer.from(ref, 'utf-8'),
      Buffer.from('anthroclaw-secret-vault', 'utf-8'),
      32,
    ),
  );
}

function pathFor(ref: SecretRef): string {
  if (ref.scope === 'global') {
    return resolve(secretsRoot(), 'global', ref.service, `${ref.key}.enc`);
  }
  if (!ref.ownerId) {
    throw new Error(`${ref.scope} secret refs require ownerId`);
  }
  return resolve(secretsRoot(), ref.scope, ref.ownerId, ref.service, `${ref.key}.enc`);
}

function encryptRecord(record: StoredSecret): Buffer {
  const ref = record.ref;
  const key = deriveKey(loadMasterKey(), ref);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(record), 'utf-8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([FORMAT_VERSION]), iv, tag, ciphertext]);
}

function decryptRecord(ref: SecretRef, blob: Buffer): StoredSecret {
  if (blob.length < HEADER_LEN) {
    throw new Error(`secret file truncated: got ${blob.length} bytes`);
  }
  if (blob[0] !== FORMAT_VERSION) {
    throw new Error(`unsupported secret file version: ${blob[0]}`);
  }

  const refString = formatSecretRef(ref);
  const key = deriveKey(loadMasterKey(), refString);
  const iv = blob.subarray(1, 1 + IV_LEN);
  const tag = blob.subarray(1 + IV_LEN, HEADER_LEN);
  const ciphertext = blob.subarray(HEADER_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf-8')) as StoredSecret;
}

function toMetadata(record: StoredSecret): SecretMetadata {
  const parsed = parseSecretRef(record.ref);
  return {
    ref: record.ref,
    label: record.label,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    scope: parsed.scope,
    ownerId: parsed.ownerId,
    service: parsed.service,
    key: parsed.key,
  };
}

export function setSecretSync(input: SetSecretInput): SecretMetadata {
  if (!input.value) {
    throw new Error('secret value is required');
  }

  const ref = formatSecretRef(input);
  const path = pathFor(input);
  const now = new Date().toISOString();
  const existing = existsSync(path)
    ? decryptRecord(input, readFileSync(path))
    : null;
  const record: StoredSecret = {
    ref,
    value: input.value,
    label: input.label?.trim() || existing?.label,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, encryptRecord(record), { mode: 0o600 });
  return toMetadata(record);
}

export function getSecretValueSync(refString: string): string {
  const ref = parseSecretRef(refString);
  const record = decryptRecord(ref, readFileSync(pathFor(ref)));
  return record.value;
}

export function getSecretMetadataSync(refString: string): SecretMetadata {
  const ref = parseSecretRef(refString);
  return toMetadata(decryptRecord(ref, readFileSync(pathFor(ref))));
}

export function deleteSecretSync(refString: string): void {
  const ref = parseSecretRef(refString);
  rmSync(pathFor(ref), { force: true });
}

export function listSecretsSync(filter?: {
  scope?: SecretRef['scope'];
  ownerId?: string;
}): SecretMetadata[] {
  const root = secretsRoot();
  if (!existsSync(root)) return [];

  const out: SecretMetadata[] = [];
  const files = listEncryptedFiles(root);
  for (const file of files) {
    const ref = refFromPath(root, file);
    if (!ref) continue;
    if (filter?.scope && ref.scope !== filter.scope) continue;
    if (filter?.ownerId && ref.ownerId !== filter.ownerId) continue;
    try {
      out.push(toMetadata(decryptRecord(ref, readFileSync(file))));
    } catch {
      // Ignore corrupt or unreadable secret files in metadata listings.
    }
  }
  return out.sort((a, b) => a.ref.localeCompare(b.ref));
}

function listEncryptedFiles(root: string): string[] {
  const out: string[] = [];
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...listEncryptedFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.enc')) {
      out.push(full);
    }
  }
  return out;
}

function refFromPath(root: string, file: string): SecretRef | null {
  const rel = file.slice(root.length + 1).split(/[\\/]/);
  if (rel[0] === 'global' && rel.length === 3) {
    return {
      scope: 'global',
      service: rel[1],
      key: rel[2].slice(0, -4),
    };
  }
  if ((rel[0] === 'agent' || rel[0] === 'fleet') && rel.length === 4) {
    return {
      scope: rel[0],
      ownerId: rel[1],
      service: rel[2],
      key: rel[3].slice(0, -4),
    };
  }
  return null;
}
