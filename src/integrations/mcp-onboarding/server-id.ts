import { createHash } from 'node:crypto';

const STRIP_PREFIXES = ['mcp.', 'api.'];

/**
 * Derive a stable, human-readable server id from an MCP URL.
 *
 * Strategy: lowercase host → strip a leading `mcp.`/`api.` label → take the
 * first remaining label and sanitise to `[a-z0-9-]`. If the resulting base is
 * empty (e.g. IP-only host), fall back to `srv-<sha256(host)[0:8]>` so the id
 * stays deterministic. When the candidate collides with a name already in
 * `taken`, suffix with `-2`, `-3`, ...
 */
export function deriveServerId(url: string, taken: Set<string>): string {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    host = url.toLowerCase();
  }
  for (const p of STRIP_PREFIXES) {
    if (host.startsWith(p)) {
      host = host.slice(p.length);
      break;
    }
  }
  // Treat IPv4 / IPv6 literals as opaque and hash them — taking the first
  // label of an IP (`192`) would produce useless, collision-prone ids.
  const isIpLiteral =
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':');
  const firstLabel = host.split('.')[0] ?? '';
  const cleaned = isIpLiteral
    ? ''
    : firstLabel.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const base =
    cleaned || `srv-${createHash('sha256').update(host).digest('hex').slice(0, 8)}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
