import { describe, expect, it } from 'vitest';
import { generatePkce } from '../oauth-client.js';

describe('generatePkce', () => {
  it('returns 43-char URL-safe verifier and SHA-256 challenge', () => {
    const { verifier, challenge, method } = generatePkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(method).toBe('S256');
    expect(verifier).not.toBe(challenge);
  });

  it('is deterministic when seeded', () => {
    const seed = Buffer.alloc(32, 7);
    const a = generatePkce(seed);
    const b = generatePkce(seed);
    expect(a).toEqual(b);
  });
});
