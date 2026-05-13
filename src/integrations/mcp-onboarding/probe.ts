import type { ProbeResult, DiscoveredOAuth } from './types.js';

const INITIALIZE_PAYLOAD = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'anthroclaw-probe', version: '0.1.0' },
  },
};

/**
 * Probe an MCP server URL to classify how the gateway should authenticate
 * with it. Sends a single MCP `initialize` POST and inspects the response:
 *
 *  - 2xx → `none` (open server, no auth wired)
 *  - 401 + `Bearer resource_metadata="..."` → `oauth` (discover AS metadata)
 *  - 401 + `Bearer ...` (no resource_metadata) → `apikey` (header-based)
 *  - 401 + non-Bearer scheme → `manual` (operator must configure)
 *  - anything else → `manual` with `unexpected_status_<code>` reason
 *
 * Network failures collapse to `manual` so the caller never has to catch.
 */
export async function probe(url: string): Promise<ProbeResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      // MCP Streamable HTTP transport REQUIRES the client to advertise both
      // application/json and text/event-stream — servers (e.g. Browserbase's
      // mcp.browserbase.com) reject with HTTP 406 if either is missing.
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(INITIALIZE_PAYLOAD),
    });
  } catch (err) {
    return {
      authMode: 'manual',
      reason: `network_error: ${(err as Error).message}`,
    };
  }

  if (res.status >= 200 && res.status < 300) {
    const server = await readInitializeServerInfo(res);
    return { authMode: 'none', server };
  }

  if (res.status !== 401) {
    return { authMode: 'manual', reason: `unexpected_status_${res.status}` };
  }

  const wwwAuth = res.headers.get('WWW-Authenticate') ?? '';
  if (!wwwAuth.toLowerCase().startsWith('bearer')) {
    return { authMode: 'manual', reason: 'non_bearer_scheme' };
  }

  const metadataMatch = wwwAuth.match(/resource_metadata="([^"]+)"/i);
  if (!metadataMatch) return { authMode: 'apikey', server: {} };

  try {
    const oauth = await discoverOAuth(metadataMatch[1]!);
    return { authMode: 'oauth', server: {}, oauth };
  } catch {
    return { authMode: 'apikey', server: {} };
  }
}

async function discoverOAuth(resourceMetadataUrl: string): Promise<DiscoveredOAuth> {
  const meta = await fetchJson<{
    resource: string;
    authorization_servers: string[];
  }>(resourceMetadataUrl);
  const asUrl = meta.authorization_servers[0];
  if (!asUrl) throw new Error('no authorization_servers');
  const asWellKnown = `${asUrl.replace(/\/$/, '')}/.well-known/oauth-authorization-server`;
  const as = await fetchJson<{
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    registration_endpoint?: string;
    scopes_supported?: string[];
  }>(asWellKnown);
  return {
    issuer: as.issuer,
    authorizationEndpoint: as.authorization_endpoint,
    tokenEndpoint: as.token_endpoint,
    registrationEndpoint: as.registration_endpoint,
    scopesSupported: as.scopes_supported,
    resource: meta.resource,
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`);
  return (await r.json()) as T;
}

/**
 * Parse the initialize response, handling both JSON and SSE bodies. MCP
 * Streamable HTTP servers may reply either as `application/json` with the
 * JSON-RPC envelope inline, or as `text/event-stream` with one `data:` line
 * carrying the same envelope.
 *
 * Failure to extract `serverInfo` is non-fatal — the caller only uses it to
 * pre-fill `serverName` in the wizard.
 */
async function readInitializeServerInfo(
  res: Response,
): Promise<{ name?: string; version?: string }> {
  const ct = (res.headers.get('Content-Type') ?? '').toLowerCase();
  try {
    if (ct.includes('text/event-stream')) {
      const text = await res.text();
      // Pull the first `data: { ... }` line and parse it. Servers are free
      // to interleave comments / pings; we just want the first JSON event.
      for (const line of text.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        const env = JSON.parse(payload) as {
          result?: { serverInfo?: { name?: string; version?: string } };
        };
        return env.result?.serverInfo ?? {};
      }
      return {};
    }
    const body = (await res.json()) as {
      result?: { serverInfo?: { name?: string; version?: string } };
    };
    return body.result?.serverInfo ?? {};
  } catch {
    return {};
  }
}
