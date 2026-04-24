/**
 * SSRF protection — validates URLs before making outbound requests.
 *
 * Blocks private, loopback, link-local, CGNAT, "this" network, cloud metadata
 * endpoints, and IPv6 loopback / link-local.  DNS failures are treated as
 * blocked (fail-closed).
 */

import { lookup } from 'node:dns/promises';

// ---------------------------------------------------------------------------
// Private / reserved range checks
// ---------------------------------------------------------------------------

function isPrivateIPv4(ip: string): { blocked: boolean; reason?: string } {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return { blocked: true, reason: 'Invalid IPv4 address' };
  }
  const [a, b] = parts;

  // 0.x.x.x — "this" network
  if (a === 0) return { blocked: true, reason: 'Blocked "this" network (0.0.0.0/8)' };

  // 10.x.x.x
  if (a === 10) return { blocked: true, reason: 'Blocked private range (10.0.0.0/8)' };

  // 172.16-31.x.x
  if (a === 172 && b >= 16 && b <= 31) return { blocked: true, reason: 'Blocked private range (172.16.0.0/12)' };

  // 192.168.x.x
  if (a === 192 && b === 168) return { blocked: true, reason: 'Blocked private range (192.168.0.0/16)' };

  // 127.x.x.x — loopback
  if (a === 127) return { blocked: true, reason: 'Blocked loopback (127.0.0.0/8)' };

  // 169.254.x.x — link-local
  if (a === 169 && b === 254) return { blocked: true, reason: 'Blocked link-local (169.254.0.0/16)' };

  // 100.64-127.x.x — CGNAT
  if (a === 100 && b >= 64 && b <= 127) return { blocked: true, reason: 'Blocked CGNAT range (100.64.0.0/10)' };

  return { blocked: false };
}

function isBlockedIPv6(ip: string): { blocked: boolean; reason?: string } {
  const normalized = ip.toLowerCase().replace(/^\[|]$/g, '');

  // ::1 — loopback
  if (normalized === '::1' || normalized === '0000:0000:0000:0000:0000:0000:0000:0001') {
    return { blocked: true, reason: 'Blocked IPv6 loopback (::1)' };
  }

  // fe80::/10 — link-local
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') ||
      normalized.startsWith('fea') || normalized.startsWith('feb')) {
    return { blocked: true, reason: 'Blocked IPv6 link-local (fe80::/10)' };
  }

  return { blocked: false };
}

// ---------------------------------------------------------------------------
// Metadata hostname check
// ---------------------------------------------------------------------------

const METADATA_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface UrlValidationResult {
  safe: boolean;
  reason?: string;
}

/**
 * Validate that a URL does not point to internal / reserved infrastructure.
 *
 * Algorithm:
 * 1. Parse URL, extract hostname.
 * 2. If hostname is a known metadata endpoint → block.
 * 3. If hostname is an IP literal → check directly.
 * 4. Otherwise DNS-resolve → check all resolved IPs.
 * 5. DNS failure → blocked (fail-closed).
 */
export async function validateUrl(url: string): Promise<UrlValidationResult> {
  // --- parse ---
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { safe: false, reason: 'Invalid URL' };
  }

  const hostname = parsed.hostname; // brackets stripped for IPv6

  // --- metadata hostname ---
  if (METADATA_HOSTS.has(hostname.toLowerCase())) {
    return { safe: false, reason: 'Blocked cloud metadata endpoint' };
  }

  // --- IP literal ---
  if (isIPv4Literal(hostname)) {
    const check = isPrivateIPv4(hostname);
    if (check.blocked) return { safe: false, reason: check.reason };
    return { safe: true };
  }

  if (isIPv6Literal(hostname)) {
    const check = isBlockedIPv6(hostname);
    if (check.blocked) return { safe: false, reason: check.reason };
    return { safe: true };
  }

  // --- DNS resolve ---
  try {
    const addresses = await resolveAll(hostname);
    for (const addr of addresses) {
      // IPv4
      const v4 = isPrivateIPv4(addr);
      if (v4.blocked) return { safe: false, reason: v4.reason };
      // IPv6
      const v6 = isBlockedIPv6(addr);
      if (v6.blocked) return { safe: false, reason: v6.reason };
    }
    return { safe: true };
  } catch {
    // Fail-closed: DNS failure means we block.
    return { safe: false, reason: 'DNS resolution failed (fail-closed)' };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isIPv4Literal(host: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

function isIPv6Literal(host: string): boolean {
  return host.includes(':');
}

/**
 * Resolve hostname to all A + AAAA records.
 */
async function resolveAll(hostname: string): Promise<string[]> {
  const results: string[] = [];

  // Try both IPv4 and IPv6; collect all addresses.
  try {
    const v4 = await lookup(hostname, { family: 4, all: true });
    for (const r of v4) results.push(r.address);
  } catch {
    // no A record — that's fine
  }

  try {
    const v6 = await lookup(hostname, { family: 6, all: true });
    for (const r of v6) results.push(r.address);
  } catch {
    // no AAAA record — that's fine
  }

  if (results.length === 0) {
    throw new Error('No DNS records found');
  }

  return results;
}
