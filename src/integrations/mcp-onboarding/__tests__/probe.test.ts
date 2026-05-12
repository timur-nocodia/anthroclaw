import { describe, expect, it, vi, beforeEach } from 'vitest';
import { probe } from '../probe.js';

const MCP_URL = 'https://mcp.example.com/mcp';
const RESOURCE_META_URL = 'https://mcp.example.com/.well-known/oauth-protected-resource';
const AS_URL = 'https://auth.example.com';
const AS_META_URL = `${AS_URL}/.well-known/oauth-authorization-server`;

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });

const unauthorizedResponse = (wwwAuth: string): Response =>
  new Response('{"error":"unauthorized"}', {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': wwwAuth,
    },
  });

describe('probe', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns authMode "none" on 200 with serverInfo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          jsonrpc: '2.0',
          id: 1,
          result: {
            serverInfo: { name: 'example-server', version: '1.0.0' },
          },
        }),
      ),
    );
    const result = await probe(MCP_URL);
    expect(result).toEqual({
      authMode: 'none',
      server: { name: 'example-server', version: '1.0.0' },
    });
  });

  it('returns authMode "oauth" on 401 + Bearer with resource_metadata', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u === MCP_URL) {
        return unauthorizedResponse(
          `Bearer resource_metadata="${RESOURCE_META_URL}"`,
        );
      }
      if (u === RESOURCE_META_URL) {
        return jsonResponse({
          resource: MCP_URL,
          authorization_servers: [AS_URL],
        });
      }
      if (u === AS_META_URL) {
        return jsonResponse({
          issuer: AS_URL,
          authorization_endpoint: `${AS_URL}/authorize`,
          token_endpoint: `${AS_URL}/token`,
          registration_endpoint: `${AS_URL}/register`,
          scopes_supported: ['read', 'write'],
        });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await probe(MCP_URL);
    expect(result.authMode).toBe('oauth');
    if (result.authMode !== 'oauth') throw new Error('narrow');
    expect(result.oauth).toEqual({
      issuer: AS_URL,
      authorizationEndpoint: `${AS_URL}/authorize`,
      tokenEndpoint: `${AS_URL}/token`,
      registrationEndpoint: `${AS_URL}/register`,
      scopesSupported: ['read', 'write'],
      resource: MCP_URL,
    });
  });

  it('returns authMode "apikey" on 401 + Bearer without resource_metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => unauthorizedResponse('Bearer realm="api"')),
    );
    const result = await probe(MCP_URL);
    expect(result.authMode).toBe('apikey');
  });

  it('returns authMode "manual" on 401 with non-Bearer scheme', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => unauthorizedResponse('Basic realm="api"')),
    );
    const result = await probe(MCP_URL);
    expect(result).toEqual({ authMode: 'manual', reason: 'non_bearer_scheme' });
  });

  it('returns authMode "manual" on 5xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('boom', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' },
          }),
      ),
    );
    const result = await probe(MCP_URL);
    expect(result).toEqual({
      authMode: 'manual',
      reason: 'unexpected_status_503',
    });
  });
});
