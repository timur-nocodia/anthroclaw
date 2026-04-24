import { getServer } from '@/lib/fleet';

/**
 * Proxies an API request to a fleet server (local or remote).
 *
 * For the local server (apiKey === 'self'), the request is forwarded to
 * localhost.  For remote servers, the request is forwarded with a Bearer
 * token derived from the server's apiKey.
 */
export async function proxyRequest(
  serverId: string,
  path: string,
  method: string,
  headers: Record<string, string>,
  body?: string | null,
): Promise<Response> {
  const server = getServer(serverId);
  if (!server) throw new Error('server_not_found');

  if (server.apiKey === 'self') {
    const url = `http://localhost:${process.env.PORT ?? 3000}/api/${path}`;
    return fetch(url, { method, headers, body, redirect: 'manual' });
  }

  // Remote: forward with bearer token
  return fetch(`${server.url}/api/${path}`, {
    method,
    headers: { ...headers, Authorization: `Bearer ${server.apiKey}` },
    body,
    signal: AbortSignal.timeout(30_000),
  });
}
