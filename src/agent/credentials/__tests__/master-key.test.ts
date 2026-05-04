import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadMasterKey, MASTER_KEY_ENV } from '../master-key.js';

const ORIGINAL = process.env[MASTER_KEY_ENV];

describe('loadMasterKey', () => {
  beforeEach(() => {
    delete process.env[MASTER_KEY_ENV];
  });

  afterAll(() => {
    if (ORIGINAL === undefined) {
      delete process.env[MASTER_KEY_ENV];
    } else {
      process.env[MASTER_KEY_ENV] = ORIGINAL;
    }
  });

  it('throws when env var is missing', () => {
    delete process.env[MASTER_KEY_ENV];
    expect(() => loadMasterKey()).toThrow(/required/i);
  });

  it('mentions how to generate the key when missing', () => {
    delete process.env[MASTER_KEY_ENV];
    expect(() => loadMasterKey()).toThrow(/openssl rand -hex 32/i);
  });

  it('throws when env var is too short', () => {
    process.env[MASTER_KEY_ENV] = 'short';
    expect(() => loadMasterKey()).toThrow(/length/i);
  });

  it('throws when env var is too long (128 hex chars)', () => {
    // Even though 128 hex chars is valid hex, the key must be exactly 32 bytes
    // for AES-256-GCM. A 128-char string would yield a 64-byte key.
    process.env[MASTER_KEY_ENV] = '0123456789abcdef'.repeat(8); // 128 hex chars
    expect(() => loadMasterKey()).toThrow(/length/i);
  });

  it('throws when env var is not hex (even-length non-hex string)', () => {
    // Critical: Buffer.from(s, 'hex') silently truncates on invalid hex chars,
    // producing a shorter buffer. The regex check MUST run before Buffer.from.
    process.env[MASTER_KEY_ENV] = 'g'.repeat(64);
    expect(() => loadMasterKey()).toThrow(/hex/i);
  });

  it('returns 32-byte buffer for valid hex', () => {
    process.env[MASTER_KEY_ENV] = '0123456789abcdef'.repeat(4); // 64 hex chars = 32 bytes
    const buf = loadMasterKey();
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBe(32);
  });

  it('accepts uppercase hex', () => {
    process.env[MASTER_KEY_ENV] = 'ABCDEF0123456789'.repeat(4);
    const buf = loadMasterKey();
    expect(buf.length).toBe(32);
  });
});
