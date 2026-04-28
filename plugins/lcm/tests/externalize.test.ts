import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import {
  maybeExternalize,
  readExternalizedPayload,
  findExternalizedPayload,
  type ExternalizeDeps,
} from '../src/externalize.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let dir: string;
const logger = { warn: vi.fn(), debug: vi.fn() };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lcm-ext-'));
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const deps = (): ExternalizeDeps => ({
  largeOutputsDir: dir,
  thresholdChars: 100,
  logger,
});

/** Generate a string of exactly `n` characters. */
function str(n: number): string {
  return 'x'.repeat(n);
}

function sha256Prefix(text: string, len = 16): string {
  return createHash('sha256').update(text).digest('hex').slice(0, len);
}

// ---------------------------------------------------------------------------
// maybeExternalize — threshold boundary
// ---------------------------------------------------------------------------

describe('maybeExternalize', () => {
  it('returns null when content length < threshold', () => {
    const result = maybeExternalize(deps(), str(99), 'tc-1', 'my_tool');
    expect(result).toBeNull();
  });

  it('returns null when content length === threshold (strictly greater-than required)', () => {
    const result = maybeExternalize(deps(), str(100), 'tc-1', 'my_tool');
    expect(result).toBeNull();
  });

  it('writes file and returns result when content length > threshold', () => {
    const content = str(101);
    const result = maybeExternalize(deps(), content, 'tc-1', 'my_tool');
    expect(result).not.toBeNull();
    expect(result!.ref).toBeTruthy();
    expect(existsSync(join(dir, result!.ref))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Placeholder format
  // ---------------------------------------------------------------------------

  it('placeholder includes tool_call_id, chars, bytes, and ref', () => {
    const content = str(200);
    const result = maybeExternalize(deps(), content, 'tc-abc', 'my_tool');
    expect(result).not.toBeNull();
    const { placeholder, ref } = result!;
    expect(placeholder).toContain('tool_call_id=tc-abc');
    expect(placeholder).toContain(`chars=${content.length}`);
    expect(placeholder).toContain(`bytes=${Buffer.byteLength(content, 'utf8')}`);
    expect(placeholder).toContain(`ref=${ref}`);
  });

  it('ref is a filename with no path separator', () => {
    const content = str(200);
    const result = maybeExternalize(deps(), content, 'tc-2', 'my_tool');
    expect(result).not.toBeNull();
    expect(result!.ref).not.toContain('/');
    expect(result!.ref).not.toContain('\\');
  });

  // ---------------------------------------------------------------------------
  // Idempotency / content-addressing
  // ---------------------------------------------------------------------------

  it('same content + toolCallId → same ref (idempotent)', () => {
    const content = str(201);
    const r1 = maybeExternalize(deps(), content, 'tc-3', 'my_tool');
    const r2 = maybeExternalize(deps(), content, 'tc-3', 'my_tool');
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r1!.ref).toBe(r2!.ref);
  });

  it('different content → different ref', () => {
    const r1 = maybeExternalize(deps(), str(201), 'tc-4', 'my_tool');
    const r2 = maybeExternalize(deps(), str(202), 'tc-4', 'my_tool');
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r1!.ref).not.toBe(r2!.ref);
  });

  // ---------------------------------------------------------------------------
  // JSON file structure
  // ---------------------------------------------------------------------------

  it('written JSON file has expected fields: tool_call_id, tool_name, content, ts, sha256, bytes', () => {
    const content = str(150);
    const result = maybeExternalize(deps(), content, 'tc-5', 'web_search');
    expect(result).not.toBeNull();
    const raw = readFileSync(join(dir, result!.ref), 'utf8');
    const obj = JSON.parse(raw) as Record<string, unknown>;
    expect(obj).toHaveProperty('tool_call_id', 'tc-5');
    expect(obj).toHaveProperty('tool_name', 'web_search');
    expect(obj).toHaveProperty('content', content);
    expect(obj).toHaveProperty('ts');
    expect(typeof obj['ts']).toBe('number');
    expect(obj).toHaveProperty('sha256');
    expect(typeof obj['sha256']).toBe('string');
    expect(obj).toHaveProperty('bytes');
    expect(typeof obj['bytes']).toBe('number');
  });

  it('stores null tool_call_id when undefined', () => {
    const content = str(150);
    const result = maybeExternalize(deps(), content, undefined, 'my_tool');
    expect(result).not.toBeNull();
    const raw = readFileSync(join(dir, result!.ref), 'utf8');
    const obj = JSON.parse(raw) as Record<string, unknown>;
    expect(obj['tool_call_id']).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// readExternalizedPayload
// ---------------------------------------------------------------------------

describe('readExternalizedPayload', () => {
  it('roundtrips content correctly', () => {
    const content = str(300);
    const writeResult = maybeExternalize(deps(), content, 'tc-6', 'my_tool');
    expect(writeResult).not.toBeNull();

    const readResult = readExternalizedPayload(deps(), writeResult!.ref);
    expect(readResult).not.toBeNull();
    expect(readResult!.content).toBe(content);
  });

  it('returns null for unknown ref', () => {
    const result = readExternalizedPayload(deps(), 'nonexistent-file.json');
    expect(result).toBeNull();
  });

  it('returns metadata with all stored fields', () => {
    const content = str(300);
    const writeResult = maybeExternalize(deps(), content, 'tc-meta', 'meta_tool');
    const readResult = readExternalizedPayload(deps(), writeResult!.ref);
    expect(readResult).not.toBeNull();
    expect(readResult!.metadata).toHaveProperty('tool_call_id', 'tc-meta');
    expect(readResult!.metadata).toHaveProperty('tool_name', 'meta_tool');
    expect(readResult!.metadata).toHaveProperty('sha256');
  });
});

// ---------------------------------------------------------------------------
// findExternalizedPayload
// ---------------------------------------------------------------------------

describe('findExternalizedPayload', () => {
  it('finds existing file by content match', () => {
    const content = str(400);
    maybeExternalize(deps(), content, 'tc-7', 'my_tool');
    const found = findExternalizedPayload(deps(), content, 'tc-7');
    expect(found).not.toBeNull();
    expect(found).toMatch(/\.json$/);
  });

  it('returns null if no match (different content)', () => {
    const content = str(400);
    maybeExternalize(deps(), content, 'tc-8', 'my_tool');
    const found = findExternalizedPayload(deps(), str(500), 'tc-8');
    expect(found).toBeNull();
  });

  it('returns null when largeOutputsDir does not exist', () => {
    const nonExistentDeps: ExternalizeDeps = {
      largeOutputsDir: join(tmpdir(), 'no-such-dir-lcm-ext-' + Date.now()),
      thresholdChars: 100,
      logger,
    };
    const found = findExternalizedPayload(nonExistentDeps, str(400), 'tc-9');
    expect(found).toBeNull();
  });

  it('prefers exact toolCallId match when multiple candidates exist', () => {
    const content = str(600);
    const hashPrefix = sha256Prefix(content, 16);

    // Simulate two files with the same hash prefix but different toolCallId suffixes.
    // '-' is in the allowed charset so 'tc-10' stays 'tc-10' after sanitization.
    mkdirSync(dir, { recursive: true });
    const otherFile = `${hashPrefix}-other_id_here.json`;
    const exactFile = `${hashPrefix}-tc-10.json`;
    const basePayload = { content, tool_call_id: null, tool_name: null, ts: Date.now(), sha256: '', bytes: 0 };
    writeFileSync(join(dir, otherFile), JSON.stringify(basePayload), 'utf8');
    writeFileSync(join(dir, exactFile), JSON.stringify(basePayload), 'utf8');

    const found = findExternalizedPayload(deps(), content, 'tc-10');
    // 'tc-10' sanitized keeps the '-' (allowed), so exactFile should be preferred.
    expect(found).toBe(exactFile);
  });

  it('falls back to first candidate when no exact toolCallId match', () => {
    const content = str(700);
    const writeResult = maybeExternalize(deps(), content, 'tc-11', 'my_tool');
    expect(writeResult).not.toBeNull();

    // Search with a different toolCallId — should still find by hash prefix.
    const found = findExternalizedPayload(deps(), content, 'different-id');
    expect(found).not.toBeNull();
    expect(found).toBe(writeResult!.ref);
  });
});
