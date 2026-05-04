import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EncryptedFilesystemCredentialStore } from '../encrypted-fs-store.js';
import { CredentialAuditLog } from '../audit.js';

let dir: string;
const KEY = 'a'.repeat(64); // 32 bytes hex

const ORIGINAL_AGENTS_DIR = process.env.OC_AGENTS_DIR;
const ORIGINAL_DATA_DIR = process.env.OC_DATA_DIR;
const ORIGINAL_MASTER_KEY = process.env.ANTHROCLAW_MASTER_KEY;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'creds-test-'));
  process.env.OC_AGENTS_DIR = dir;
  process.env.OC_DATA_DIR = dir;
  process.env.ANTHROCLAW_MASTER_KEY = KEY;
  mkdirSync(join(dir, 'agenta'));
  mkdirSync(join(dir, 'agentb'));
});

afterEach(() => {
  if (ORIGINAL_AGENTS_DIR === undefined) delete process.env.OC_AGENTS_DIR;
  else process.env.OC_AGENTS_DIR = ORIGINAL_AGENTS_DIR;
  if (ORIGINAL_DATA_DIR === undefined) delete process.env.OC_DATA_DIR;
  else process.env.OC_DATA_DIR = ORIGINAL_DATA_DIR;
  if (ORIGINAL_MASTER_KEY === undefined) delete process.env.ANTHROCLAW_MASTER_KEY;
  else process.env.ANTHROCLAW_MASTER_KEY = ORIGINAL_MASTER_KEY;
  rmSync(dir, { recursive: true, force: true });
});

const cred = {
  service: 'google_calendar',
  account: 'timur@nocodia.dev',
  accessToken: 'ya29.abc',
  refreshToken: '1//refresh',
  expiresAt: 1_700_000_000_000,
  scopes: ['calendar.readonly'],
};

function readAuditLines(): Array<Record<string, unknown>> {
  const auditPath = join(dir, 'credential-access.jsonl');
  if (!existsSync(auditPath)) return [];
  const content = readFileSync(auditPath, 'utf-8');
  if (!content.trim()) return [];
  return content
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('EncryptedFilesystemCredentialStore', () => {
  // ---- Plan-required tests ---------------------------------------------------

  it('round-trips set/get returning identical credential', async () => {
    const store = new EncryptedFilesystemCredentialStore(new CredentialAuditLog());
    await store.set({ agentId: 'agenta', service: 'google_calendar' }, cred);
    const out = await store.get(
      { agentId: 'agenta', service: 'google_calendar' },
      'test',
    );
    expect(out).toEqual(cred);
  });

  it('writes encrypted bytes — plaintext token strings absent on disk', async () => {
    const store = new EncryptedFilesystemCredentialStore(new CredentialAuditLog());
    await store.set({ agentId: 'agenta', service: 'google_calendar' }, cred);
    const path = join(dir, 'agenta', 'credentials', 'google_calendar.enc');
    const blob = readFileSync(path);
    expect(blob.includes(Buffer.from('ya29.abc'))).toBe(false);
    expect(blob.includes(Buffer.from('1//refresh'))).toBe(false);
  });

  it('decryption fails when blob is copied to a different agent', async () => {
    const store = new EncryptedFilesystemCredentialStore(new CredentialAuditLog());
    await store.set({ agentId: 'agenta', service: 'google_calendar' }, cred);
    const blob = readFileSync(
      join(dir, 'agenta', 'credentials', 'google_calendar.enc'),
    );
    mkdirSync(join(dir, 'agentb', 'credentials'), { recursive: true });
    writeFileSync(
      join(dir, 'agentb', 'credentials', 'google_calendar.enc'),
      blob,
    );

    await expect(
      store.get({ agentId: 'agentb', service: 'google_calendar' }, 'test'),
    ).rejects.toThrow();
  });

  it('decryption fails on tampered ciphertext (AES-GCM auth)', async () => {
    const store = new EncryptedFilesystemCredentialStore(new CredentialAuditLog());
    await store.set({ agentId: 'agenta', service: 'google_calendar' }, cred);
    const path = join(dir, 'agenta', 'credentials', 'google_calendar.enc');
    const blob = Buffer.from(readFileSync(path));
    blob[blob.length - 1] ^= 0xff; // flip a bit in last ciphertext byte
    writeFileSync(path, blob);
    await expect(
      store.get({ agentId: 'agenta', service: 'google_calendar' }, 'test'),
    ).rejects.toThrow();
  });

  it('list returns metadata without accessToken/refreshToken fields', async () => {
    const store = new EncryptedFilesystemCredentialStore(new CredentialAuditLog());
    await store.set({ agentId: 'agenta', service: 'google_calendar' }, cred);
    const meta = await store.list('agenta');
    expect(meta.length).toBe(1);
    expect(meta[0]).not.toHaveProperty('accessToken');
    expect(meta[0]).not.toHaveProperty('refreshToken');
    expect(meta[0].service).toBe('google_calendar');
    expect(meta[0].account).toBe('timur@nocodia.dev');
    expect(meta[0].scopes).toEqual(['calendar.readonly']);
  });

  it('delete removes the file and subsequent get rejects', async () => {
    const store = new EncryptedFilesystemCredentialStore(new CredentialAuditLog());
    await store.set({ agentId: 'agenta', service: 'google_calendar' }, cred);
    const path = join(dir, 'agenta', 'credentials', 'google_calendar.enc');
    expect(existsSync(path)).toBe(true);
    await store.delete({ agentId: 'agenta', service: 'google_calendar' });
    expect(existsSync(path)).toBe(false);
    await expect(
      store.get({ agentId: 'agenta', service: 'google_calendar' }, 'test'),
    ).rejects.toThrow();
  });

  it('get writes audit entry with reason', async () => {
    const store = new EncryptedFilesystemCredentialStore(new CredentialAuditLog());
    await store.set({ agentId: 'agenta', service: 'google_calendar' }, cred);
    await store.get(
      { agentId: 'agenta', service: 'google_calendar' },
      'mcp_call:list_events',
    );
    const lines = readAuditLines();
    const getLine = lines.find((l) => l.action === 'get');
    expect(getLine).toBeDefined();
    expect(getLine!.reason).toBe('mcp_call:list_events');
    expect(getLine!.agentId).toBe('agenta');
    expect(getLine!.service).toBe('google_calendar');
    expect(typeof getLine!.ts).toBe('number');
  });

  // ---- Additional guardrail tests --------------------------------------------

  it('delete is idempotent — non-existent ref does not throw, but writes audit entry', async () => {
    const store = new EncryptedFilesystemCredentialStore(new CredentialAuditLog());
    // Never set anything for agenta/notion.
    await expect(
      store.delete({ agentId: 'agenta', service: 'notion' }),
    ).resolves.toBeUndefined();
    const lines = readAuditLines();
    const deleteLine = lines.find(
      (l) => l.action === 'delete' && l.service === 'notion',
    );
    expect(deleteLine).toBeDefined();
    expect(deleteLine!.agentId).toBe('agenta');
  });

  it('set followed by set overwrites cleanly (no append-mode footgun)', async () => {
    const store = new EncryptedFilesystemCredentialStore(new CredentialAuditLog());
    await store.set({ agentId: 'agenta', service: 'google_calendar' }, cred);
    const replacement = { ...cred, accessToken: 'ya29.NEW', scopes: ['calendar.write'] };
    await store.set({ agentId: 'agenta', service: 'google_calendar' }, replacement);
    const out = await store.get(
      { agentId: 'agenta', service: 'google_calendar' },
      'test',
    );
    expect(out.accessToken).toBe('ya29.NEW');
    expect(out.scopes).toEqual(['calendar.write']);

    // Verify file size matches what a single replacement would produce — i.e.
    // not double-the-size from append-mode.
    const path = join(dir, 'agenta', 'credentials', 'google_calendar.enc');
    const blob = readFileSync(path);
    // version(1) + iv(12) + tag(16) + ct(~roughly len(plaintext))
    const plaintextLen = Buffer.from(JSON.stringify(replacement), 'utf-8').length;
    expect(blob.length).toBe(1 + 12 + 16 + plaintextLen);
  });

  it('list does NOT write get audit entries (load-bearing fix)', async () => {
    const store = new EncryptedFilesystemCredentialStore(new CredentialAuditLog());
    await store.set({ agentId: 'agenta', service: 'google_calendar' }, cred);
    await store.set({ agentId: 'agenta', service: 'notion' }, { ...cred, service: 'notion' });

    // Snapshot lines before list().
    const before = readAuditLines();
    const beforeGetCount = before.filter((l) => l.action === 'get').length;
    expect(beforeGetCount).toBe(0);

    await store.list('agenta');

    const after = readAuditLines();
    const afterGetCount = after.filter((l) => l.action === 'get').length;
    expect(afterGetCount).toBe(0); // list() must not emit synthetic 'get' entries
  });

  it('per-service key isolation — file for service A still decrypts after writing service B', async () => {
    const store = new EncryptedFilesystemCredentialStore(new CredentialAuditLog());
    const credA = { ...cred, service: 'google_calendar', accessToken: 'TOKEN_A' };
    const credB = { ...cred, service: 'notion', accessToken: 'TOKEN_B' };
    await store.set({ agentId: 'agenta', service: 'google_calendar' }, credA);
    await store.set({ agentId: 'agenta', service: 'notion' }, credB);

    const outA = await store.get(
      { agentId: 'agenta', service: 'google_calendar' },
      'test',
    );
    const outB = await store.get({ agentId: 'agenta', service: 'notion' }, 'test');
    expect(outA.accessToken).toBe('TOKEN_A');
    expect(outB.accessToken).toBe('TOKEN_B');

    // Cross-service tampering: copy A's blob to B's path → decrypt fails.
    const blobA = readFileSync(
      join(dir, 'agenta', 'credentials', 'google_calendar.enc'),
    );
    writeFileSync(join(dir, 'agenta', 'credentials', 'notion.enc'), blobA);
    await expect(
      store.get({ agentId: 'agenta', service: 'notion' }, 'test'),
    ).rejects.toThrow();
  });

  it('bad version byte throws with a version-mismatch message', async () => {
    const store = new EncryptedFilesystemCredentialStore(new CredentialAuditLog());
    await store.set({ agentId: 'agenta', service: 'google_calendar' }, cred);
    const path = join(dir, 'agenta', 'credentials', 'google_calendar.enc');
    const blob = Buffer.from(readFileSync(path));
    blob[0] = 99;
    writeFileSync(path, blob);
    await expect(
      store.get({ agentId: 'agenta', service: 'google_calendar' }, 'test'),
    ).rejects.toThrow(/version/i);
  });

  it('truncated blob throws (does not silently return empty)', async () => {
    const store = new EncryptedFilesystemCredentialStore(new CredentialAuditLog());
    await store.set({ agentId: 'agenta', service: 'google_calendar' }, cred);
    const path = join(dir, 'agenta', 'credentials', 'google_calendar.enc');
    // Truncate to fewer bytes than even the header would need (1 + 12 + 16 = 29).
    writeFileSync(path, Buffer.from([1, 2, 3, 4, 5]));
    await expect(
      store.get({ agentId: 'agenta', service: 'google_calendar' }, 'test'),
    ).rejects.toThrow();
  });

  it('constructor throws when ANTHROCLAW_MASTER_KEY is missing', () => {
    delete process.env.ANTHROCLAW_MASTER_KEY;
    expect(() => new EncryptedFilesystemCredentialStore(new CredentialAuditLog())).toThrow(
      /required/i,
    );
  });

  it('audit-log shape: every operation writes {ts, agentId, service, action} and get adds reason', async () => {
    const store = new EncryptedFilesystemCredentialStore(new CredentialAuditLog());
    await store.set({ agentId: 'agenta', service: 'google_calendar' }, cred);
    await store.get(
      { agentId: 'agenta', service: 'google_calendar' },
      'mcp_call:list_events',
    );
    await store.delete({ agentId: 'agenta', service: 'google_calendar' });

    const lines = readAuditLines();
    expect(lines.length).toBe(3);

    for (const line of lines) {
      expect(typeof line.ts).toBe('number');
      expect(line.agentId).toBe('agenta');
      expect(line.service).toBe('google_calendar');
      expect(['get', 'set', 'delete']).toContain(line.action);
    }

    const setLine = lines.find((l) => l.action === 'set')!;
    const getLine = lines.find((l) => l.action === 'get')!;
    const deleteLine = lines.find((l) => l.action === 'delete')!;
    expect(setLine.reason).toBeUndefined();
    expect(getLine.reason).toBe('mcp_call:list_events');
    expect(deleteLine.reason).toBeUndefined();
  });
});
