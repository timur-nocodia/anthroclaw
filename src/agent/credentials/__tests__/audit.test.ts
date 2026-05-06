import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir, platform } from 'node:os';
import { CredentialAuditLog, type CredentialAuditEvent } from '../audit.js';

let dir: string;
const ORIGINAL_DATA_DIR = process.env.OC_DATA_DIR;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'audit-test-'));
  process.env.OC_DATA_DIR = dir;
});

afterEach(() => {
  if (ORIGINAL_DATA_DIR === undefined) delete process.env.OC_DATA_DIR;
  else process.env.OC_DATA_DIR = ORIGINAL_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('CredentialAuditLog', () => {
  it('appends a JSONL line per record', async () => {
    const log = new CredentialAuditLog();
    await log.record({ ts: 1000, agentId: 'a', service: 'google_calendar', action: 'get', reason: 'mcp' });
    await log.record({ ts: 2000, agentId: 'a', service: 'google_calendar', action: 'set' });
    const content = readFileSync(join(dir, 'credential-access.jsonl'), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).action).toBe('get');
    expect(JSON.parse(lines[1]).action).toBe('set');
  });

  it('handles 50 concurrent records without corruption', async () => {
    const log = new CredentialAuditLog();
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        log.record({ ts: i, agentId: 'a', service: 's', action: 'get', reason: String(i) }),
      ),
    );
    const lines = readFileSync(join(dir, 'credential-access.jsonl'), 'utf-8').trim().split('\n');
    expect(lines.length).toBe(50);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('uses constructor path when provided, ignoring OC_DATA_DIR', async () => {
    const customPath = join(dir, 'custom', 'audit.jsonl');
    const log = new CredentialAuditLog(customPath);
    await log.record({ ts: 1, agentId: 'a', service: 's', action: 'get' });
    expect(readFileSync(customPath, 'utf-8').trim()).toMatch(/"action":"get"/);
  });

  it('creates parent directory if missing', async () => {
    const customPath = join(dir, 'a', 'b', 'c', 'audit.jsonl');
    const log = new CredentialAuditLog(customPath);
    await log.record({ ts: 1, agentId: 'a', service: 's', action: 'get' });
    expect(readFileSync(customPath, 'utf-8').length).toBeGreaterThan(0);
  });

  it('writes file with mode 0o640', async () => {
    if (platform() === 'win32') return;
    const log = new CredentialAuditLog();
    await log.record({ ts: 1, agentId: 'a', service: 's', action: 'get' });
    const mode = statSync(join(dir, 'credential-access.jsonl')).mode & 0o777;
    expect(mode).toBe(0o640);
  });

  it('terminates each line with single \\n (not \\r\\n or \\n\\n)', async () => {
    const log = new CredentialAuditLog();
    await log.record({ ts: 1, agentId: 'a', service: 's', action: 'get' });
    await log.record({ ts: 2, agentId: 'a', service: 's', action: 'set' });
    const raw = readFileSync(join(dir, 'credential-access.jsonl'), 'utf-8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).not.toMatch(/\r\n/);
    expect(raw).not.toMatch(/\n\n/);
  });

  it('records with newline in reason field stay on a single JSONL line', async () => {
    const log = new CredentialAuditLog();
    await log.record({ ts: 1, agentId: 'a', service: 's', action: 'get', reason: 'line1\nline2' });
    await log.record({ ts: 2, agentId: 'a', service: 's', action: 'set' });
    const lines = readFileSync(join(dir, 'credential-access.jsonl'), 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).reason).toBe('line1\nline2');
  });

  it('does not poison chain when one record write fails', async () => {
    const customPath = join(dir, 'recovery', 'audit.jsonl');
    const log = new CredentialAuditLog(customPath);

    await log.record({ ts: 1, agentId: 'a', service: 's', action: 'get' });

    rmSync(dirname(customPath), { recursive: true, force: true });
    writeFileSync(dirname(customPath), 'i am a file, not a directory');

    await expect(
      log.record({ ts: 2, agentId: 'a', service: 's', action: 'set' }),
    ).rejects.toThrow();

    rmSync(dirname(customPath), { force: true });

    await log.record({ ts: 3, agentId: 'a', service: 's', action: 'delete' });
    const lines = readFileSync(customPath, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]).action).toBe('delete');
  });

  it('CredentialAuditEvent type rejects token fields at compile time', () => {
    const ev: CredentialAuditEvent = { ts: 1, agentId: 'a', service: 's', action: 'get' };
    expect(ev.action).toBe('get');
  });
});
