import { describe, it, expect, vi, afterEach } from 'vitest';
import { validateUrl } from '../../src/security/ssrf.js';

// We mock dns/promises to avoid real DNS lookups in tests.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

import { lookup } from 'node:dns/promises';
const mockLookup = vi.mocked(lookup);

afterEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Invalid URLs
// ---------------------------------------------------------------------------

describe('validateUrl – invalid URLs', () => {
  it('rejects malformed URLs', async () => {
    const result = await validateUrl('not-a-url');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Invalid URL');
  });
});

// ---------------------------------------------------------------------------
// IP literal — blocked ranges
// ---------------------------------------------------------------------------

describe('validateUrl – blocked IPv4 literals', () => {
  const cases: Array<[string, string]> = [
    ['http://10.0.0.1/', 'private range'],
    ['http://10.255.255.255/', 'private range'],
    ['http://172.16.0.1/', 'private range'],
    ['http://172.31.255.255/', 'private range'],
    ['http://192.168.0.1/', 'private range'],
    ['http://192.168.255.255/', 'private range'],
    ['http://127.0.0.1/', 'loopback'],
    ['http://127.255.255.255/', 'loopback'],
    ['http://169.254.1.1/', 'link-local'],
    ['http://169.254.169.254/', 'metadata'],
    ['http://100.64.0.1/', 'CGNAT'],
    ['http://100.127.255.255/', 'CGNAT'],
    ['http://0.0.0.0/', '"this" network'],
    ['http://0.1.2.3/', '"this" network'],
  ];

  for (const [url, label] of cases) {
    it(`blocks ${url} (${label})`, async () => {
      const result = await validateUrl(url);
      expect(result.safe).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// IP literal — allowed public IPs
// ---------------------------------------------------------------------------

describe('validateUrl – allowed public IPv4 literals', () => {
  it('allows 8.8.8.8', async () => {
    const result = await validateUrl('http://8.8.8.8/');
    expect(result.safe).toBe(true);
  });

  it('allows 1.1.1.1', async () => {
    const result = await validateUrl('http://1.1.1.1/');
    expect(result.safe).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// IPv6 blocked
// ---------------------------------------------------------------------------

describe('validateUrl – blocked IPv6', () => {
  it('blocks ::1 (loopback)', async () => {
    const result = await validateUrl('http://[::1]/');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('loopback');
  });

  it('blocks fe80:: (link-local)', async () => {
    const result = await validateUrl('http://[fe80::1]/');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('link-local');
  });
});

// ---------------------------------------------------------------------------
// Metadata endpoints
// ---------------------------------------------------------------------------

describe('validateUrl – cloud metadata', () => {
  it('blocks 169.254.169.254 as metadata', async () => {
    const result = await validateUrl('http://169.254.169.254/latest/meta-data/');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('metadata');
  });

  it('blocks metadata.google.internal', async () => {
    const result = await validateUrl('http://metadata.google.internal/computeMetadata/v1/');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('metadata');
  });
});

// ---------------------------------------------------------------------------
// DNS resolution — blocked
// ---------------------------------------------------------------------------

describe('validateUrl – DNS resolves to private IP', () => {
  it('blocks hostname resolving to 10.x', async () => {
    mockLookup.mockImplementation(async (_host, opts: any) => {
      if (opts?.family === 4) return [{ address: '10.0.0.5', family: 4 }] as any;
      throw new Error('no AAAA');
    });
    const result = await validateUrl('http://internal.corp/');
    expect(result.safe).toBe(false);
  });

  it('blocks hostname resolving to 127.0.0.1', async () => {
    mockLookup.mockImplementation(async (_host, opts: any) => {
      if (opts?.family === 4) return [{ address: '127.0.0.1', family: 4 }] as any;
      throw new Error('no AAAA');
    });
    const result = await validateUrl('http://sneaky.example.com/');
    expect(result.safe).toBe(false);
  });

  it('blocks hostname resolving to IPv6 ::1', async () => {
    mockLookup.mockImplementation(async (_host, opts: any) => {
      if (opts?.family === 4) throw new Error('no A');
      return [{ address: '::1', family: 6 }] as any;
    });
    const result = await validateUrl('http://sneaky-v6.example.com/');
    expect(result.safe).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DNS resolution — allowed
// ---------------------------------------------------------------------------

describe('validateUrl – DNS resolves to public IP', () => {
  it('allows hostname resolving to public IP', async () => {
    mockLookup.mockImplementation(async (_host, opts: any) => {
      if (opts?.family === 4) return [{ address: '93.184.216.34', family: 4 }] as any;
      throw new Error('no AAAA');
    });
    const result = await validateUrl('http://example.com/');
    expect(result.safe).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DNS failure — fail-closed
// ---------------------------------------------------------------------------

describe('validateUrl – DNS failure', () => {
  it('blocks when DNS resolution fails (fail-closed)', async () => {
    mockLookup.mockRejectedValue(new Error('NXDOMAIN'));
    const result = await validateUrl('http://nonexistent.invalid/');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('DNS');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('validateUrl – edge cases', () => {
  it('handles URLs with ports', async () => {
    const result = await validateUrl('http://127.0.0.1:8080/api');
    expect(result.safe).toBe(false);
  });

  it('handles URLs with paths and query strings', async () => {
    const result = await validateUrl('http://10.0.0.1/admin?key=value');
    expect(result.safe).toBe(false);
  });

  it('handles CGNAT boundary — 100.63.x.x is not blocked', async () => {
    const result = await validateUrl('http://100.63.255.255/');
    expect(result.safe).toBe(true);
  });

  it('handles CGNAT boundary — 100.128.0.0 is not blocked', async () => {
    const result = await validateUrl('http://100.128.0.0/');
    expect(result.safe).toBe(true);
  });

  it('172.15.x.x is NOT private', async () => {
    const result = await validateUrl('http://172.15.0.1/');
    expect(result.safe).toBe(true);
  });

  it('172.32.x.x is NOT private', async () => {
    const result = await validateUrl('http://172.32.0.1/');
    expect(result.safe).toBe(true);
  });
});
