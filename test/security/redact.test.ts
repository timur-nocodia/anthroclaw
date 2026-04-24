import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../../src/security/redact.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a string of given length from a-z0-9. */
function fakeKey(prefix: string, length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_-';
  let result = prefix;
  while (result.length < prefix.length + length) {
    result += chars[result.length % chars.length];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Masking rules
// ---------------------------------------------------------------------------

describe('redactSecrets – masking rules', () => {
  it('tokens >= 18 chars: keep first 6 + **** + last 4', () => {
    // Anthropic key (well over 18 chars)
    const key = 'sk-ant-' + 'a'.repeat(30);
    const result = redactSecrets(`Key: ${key}`);
    expect(result).toContain('sk-ant****' + 'a'.repeat(4));
    expect(result).not.toContain(key);
  });

  it('tokens < 18 chars: replace with [REDACTED]', () => {
    // A very short xox token (xoxb-xxxxxxxxxx = 15 chars total)
    const key = 'xoxb-1234567890';
    const result = redactSecrets(`Token: ${key}`);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain(key);
  });
});

// ---------------------------------------------------------------------------
// Anthropic keys
// ---------------------------------------------------------------------------

describe('redactSecrets – Anthropic', () => {
  it('redacts sk-ant-... keys', () => {
    const key = fakeKey('sk-ant-', 30);
    const result = redactSecrets(`My key is ${key} ok?`);
    expect(result).not.toContain(key);
    expect(result).toContain('sk-ant****');
  });
});

// ---------------------------------------------------------------------------
// OpenAI keys
// ---------------------------------------------------------------------------

describe('redactSecrets – OpenAI', () => {
  it('redacts sk-proj-... keys', () => {
    const key = fakeKey('sk-proj-', 30);
    const result = redactSecrets(key);
    expect(result).not.toContain(key);
    expect(result).toContain('sk-pro****');
  });

  it('redacts generic sk-... keys', () => {
    const key = fakeKey('sk-', 25);
    const result = redactSecrets(key);
    expect(result).not.toContain(key);
  });
});

// ---------------------------------------------------------------------------
// GitHub PATs
// ---------------------------------------------------------------------------

describe('redactSecrets – GitHub', () => {
  it('redacts ghp_ tokens', () => {
    const key = 'ghp_' + 'A'.repeat(36);
    const result = redactSecrets(key);
    expect(result).not.toContain(key);
  });

  it('redacts gho_ tokens', () => {
    const key = 'gho_' + 'B'.repeat(36);
    const result = redactSecrets(key);
    expect(result).not.toContain(key);
  });

  it('redacts github_pat_ tokens', () => {
    const key = 'github_pat_' + 'C'.repeat(22);
    const result = redactSecrets(key);
    expect(result).not.toContain(key);
  });
});

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------

describe('redactSecrets – Slack', () => {
  it('redacts xoxb-... tokens', () => {
    const key = 'xoxb-' + 'a'.repeat(20);
    const result = redactSecrets(key);
    expect(result).not.toContain(key);
  });

  it('redacts xoxs-... tokens', () => {
    const key = 'xoxs-' + 'b'.repeat(20);
    const result = redactSecrets(key);
    expect(result).not.toContain(key);
  });
});

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

describe('redactSecrets – Google', () => {
  it('redacts AIza... keys (exactly 39 chars)', () => {
    const key = 'AIza' + 'X'.repeat(35);
    expect(key.length).toBe(39);
    const result = redactSecrets(key);
    expect(result).not.toContain(key);
  });
});

// ---------------------------------------------------------------------------
// AWS
// ---------------------------------------------------------------------------

describe('redactSecrets – AWS', () => {
  it('redacts AKIA... keys (exactly 20 chars)', () => {
    const key = 'AKIA' + 'A'.repeat(16);
    expect(key.length).toBe(20);
    const result = redactSecrets(key);
    expect(result).not.toContain(key);
  });
});

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------

describe('redactSecrets – Stripe', () => {
  it('redacts sk_live_ keys', () => {
    const key = 'sk_live_' + 'a'.repeat(24);
    const result = redactSecrets(key);
    expect(result).not.toContain(key);
  });

  it('redacts rk_live_ keys', () => {
    const key = 'rk_live_' + 'b'.repeat(24);
    const result = redactSecrets(key);
    expect(result).not.toContain(key);
  });
});

// ---------------------------------------------------------------------------
// Fal.ai
// ---------------------------------------------------------------------------

describe('redactSecrets – Fal.ai', () => {
  it('redacts fal_... tokens', () => {
    const key = fakeKey('fal_', 25);
    const result = redactSecrets(key);
    expect(result).not.toContain(key);
  });
});

// ---------------------------------------------------------------------------
// Generic long secrets
// ---------------------------------------------------------------------------

describe('redactSecrets – generic secrets', () => {
  it('redacts api_key="value" (only the value)', () => {
    const value = 'a'.repeat(25);
    const text = `api_key="${value}"`;
    const result = redactSecrets(text);
    expect(result).not.toContain(value);
    expect(result).toContain('api_key="');
  });

  it('redacts token: value', () => {
    const value = 'Z'.repeat(25);
    const text = `token: ${value}`;
    const result = redactSecrets(text);
    expect(result).not.toContain(value);
    expect(result).toContain('token: ');
  });

  it('redacts secret=value', () => {
    const value = 'x'.repeat(25);
    const text = `secret=${value}`;
    const result = redactSecrets(text);
    expect(result).not.toContain(value);
  });

  it('redacts password: value (case insensitive)', () => {
    const value = 'M'.repeat(25);
    const text = `PASSWORD: ${value}`;
    const result = redactSecrets(text);
    expect(result).not.toContain(value);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('redactSecrets – edge cases', () => {
  it('returns empty string unchanged', () => {
    expect(redactSecrets('')).toBe('');
  });

  it('returns text without secrets unchanged', () => {
    const text = 'Hello, this is a normal message with no secrets.';
    expect(redactSecrets(text)).toBe(text);
  });

  it('redacts multiple secrets in the same string', () => {
    const key1 = fakeKey('sk-ant-', 30);
    const key2 = 'ghp_' + 'A'.repeat(36);
    const text = `First: ${key1}, Second: ${key2}`;
    const result = redactSecrets(text);
    expect(result).not.toContain(key1);
    expect(result).not.toContain(key2);
  });

  it('handles multiline text', () => {
    const key = fakeKey('sk-ant-', 30);
    const text = `line 1\n${key}\nline 3`;
    const result = redactSecrets(text);
    expect(result).not.toContain(key);
    expect(result).toContain('line 1');
    expect(result).toContain('line 3');
  });
});
