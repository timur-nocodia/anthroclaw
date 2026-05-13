/**
 * Authenticated MCP Streamable HTTP transport call.
 *
 * Used by `attachApiKey` (initial handshake) and by the
 * `discover-tools` API route (re-list tools for an already-attached
 * server). Carries a bearer token, propagates the `Mcp-Session-Id`
 * header, and parses either application/json or text/event-stream
 * response bodies. Mirrors the read path of `readInitializeServerInfo`
 * in `probe.ts`.
 *
 * `notifications/initialized` is a notification (no JSON-RPC `id`) and
 * servers reply 200/202 with no body — `body` is `null` in that case.
 */
export async function mcpFetch(
  url: string,
  token: string,
  sessionId: string | undefined,
  payload: object,
  scheme: string = 'Bearer',
): Promise<{ ok: boolean; body: unknown; sessionId?: string; status?: number }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `${scheme} ${token}`,
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, body: null };
  }
  const sid = res.headers.get('mcp-session-id') ?? undefined;
  if (!res.ok) return { ok: false, body: null, sessionId: sid, status: res.status };

  if (res.status === 202) return { ok: true, body: null, sessionId: sid, status: 202 };
  const ct = (res.headers.get('Content-Type') ?? '').toLowerCase();
  if (ct.includes('text/event-stream')) {
    const text = await res.text();
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      try {
        return { ok: true, body: JSON.parse(data), sessionId: sid, status: res.status };
      } catch {
        continue;
      }
    }
    return { ok: true, body: null, sessionId: sid, status: res.status };
  }
  try {
    return { ok: true, body: await res.json(), sessionId: sid, status: res.status };
  } catch {
    return { ok: true, body: null, sessionId: sid, status: res.status };
  }
}

/**
 * Full discover-tools handshake against an authenticated MCP server:
 * initialize → notifications/initialized → tools/list. Returns the tool
 * list on success, throws on any handshake failure (caller maps to a
 * surface-appropriate error).
 */
export async function discoverMcpTools(opts: {
  mcpUrl: string;
  token: string;
  scheme?: string;
  clientName?: string;
}): Promise<Array<{ name: string; description?: string }>> {
  const scheme = opts.scheme ?? 'Bearer';
  const clientName = opts.clientName ?? 'anthroclaw';

  const init = await mcpFetch(opts.mcpUrl, opts.token, undefined, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: clientName, version: '0.1' },
    },
  }, scheme);
  if (!init.ok) throw new Error(`mcp_initialize_failed_${init.status ?? 'network'}`);
  const sessionId = init.sessionId;

  if (sessionId) {
    await mcpFetch(opts.mcpUrl, opts.token, sessionId, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    }, scheme).catch(() => undefined);
  }

  const listed = await mcpFetch(opts.mcpUrl, opts.token, sessionId, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  }, scheme);
  if (!listed.ok) throw new Error(`mcp_tools_list_failed_${listed.status ?? 'network'}`);
  const body = listed.body as
    | { result?: { tools?: Array<{ name: string; description?: string }> } }
    | null;
  return body?.result?.tools ?? [];
}
