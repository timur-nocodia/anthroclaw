/**
 * Fake MCP+AS server for the OAuth onboarding integration test.
 *
 * Implements the minimum surface to exercise the full round-trip:
 *
 *  - `POST /mcp` JSON-RPC: `initialize` returns 401+WWW-Authenticate when no
 *    bearer token is present (with `resource_metadata` pointing back at
 *    `/.well-known/oauth-protected-resource`); succeeds when authorised.
 *    `tools/list` returns a single `demo_tool` entry.
 *  - `GET /.well-known/oauth-protected-resource` (RFC 9728).
 *  - `GET /.well-known/oauth-authorization-server` (RFC 8414).
 *  - `POST /register` — RFC 7591 stub, hands out `cli_test` / `sec_test`.
 *  - `GET /authorize` — skips the user consent UI: just constructs the
 *    redirect back to the wizard's callback with a fixed `code` and the
 *    incoming `state`. Stores the `code_challenge` so `/token` can verify
 *    it against the verifier the client supplies later.
 *  - `POST /token` — handles `authorization_code` (validates PKCE) and
 *    `refresh_token`. PKCE validation is real: SHA-256(verifier).base64url
 *    must equal the stored code_challenge for the issued code.
 *
 * The PKCE check must actually run — that's the value of this fixture
 * over a pure mock. If `oauth-client.ts` ever forgets to send the
 * verifier or computes the wrong challenge, this fixture will return 400
 * and the integration test will fail loudly.
 */

import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

interface IssuedCode {
  codeChallenge: string;
  redirectUri: string;
  clientId: string;
}

interface IssuedToken {
  clientId: string;
  refreshToken: string;
}

export interface OAuthFixture {
  baseUrl: string;
  stop: () => Promise<void>;
}

export async function startOAuthFixtureServer(
  opts: { port?: number } = {},
): Promise<OAuthFixture> {
  const issuedCodes = new Map<string, IssuedCode>();
  const refreshTokens = new Map<string, IssuedToken>();
  let baseUrl = '';

  async function readBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf-8');
  }

  function sendJson(res: ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    });
    res.end(payload);
  }

  const server: Server = createServer(async (req, res) => {
    if (!req.url) {
      res.writeHead(400).end();
      return;
    }
    const u = new URL(req.url, baseUrl || 'http://placeholder');
    const path = u.pathname;
    const method = req.method ?? 'GET';

    try {
      // --- MCP JSON-RPC endpoint ---
      if (method === 'POST' && path === '/mcp') {
        const body = await readBody(req);
        let rpc: { method?: string; id?: number } = {};
        try {
          rpc = JSON.parse(body);
        } catch {
          rpc = {};
        }
        const auth = req.headers['authorization'] as string | undefined;
        if (!auth) {
          res.writeHead(401, {
            'WWW-Authenticate': `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
            'Content-Type': 'application/json',
          });
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
        if (rpc.method === 'initialize') {
          sendJson(res, 200, {
            jsonrpc: '2.0',
            id: rpc.id ?? 1,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'fixture', version: '0.1.0' },
            },
          });
          return;
        }
        if (rpc.method === 'tools/list') {
          sendJson(res, 200, {
            jsonrpc: '2.0',
            id: rpc.id ?? 2,
            result: {
              tools: [
                {
                  name: 'demo_tool',
                  description: 'fixture demo tool',
                  inputSchema: { type: 'object', properties: {} },
                },
              ],
            },
          });
          return;
        }
        sendJson(res, 400, { error: 'unknown_method' });
        return;
      }

      // --- RFC 9728: protected-resource metadata ---
      if (method === 'GET' && path === '/.well-known/oauth-protected-resource') {
        sendJson(res, 200, {
          resource: `${baseUrl}/mcp`,
          authorization_servers: [baseUrl],
        });
        return;
      }

      // --- RFC 8414: authorization-server metadata ---
      if (method === 'GET' && path === '/.well-known/oauth-authorization-server') {
        sendJson(res, 200, {
          issuer: baseUrl,
          authorization_endpoint: `${baseUrl}/authorize`,
          token_endpoint: `${baseUrl}/token`,
          registration_endpoint: `${baseUrl}/register`,
          scopes_supported: ['read', 'write'],
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
        });
        return;
      }

      // --- RFC 7591: dynamic client registration ---
      if (method === 'POST' && path === '/register') {
        await readBody(req); // body intentionally ignored by the stub
        sendJson(res, 201, {
          client_id: 'cli_test',
          client_secret: 'sec_test',
          token_endpoint_auth_method: 'none',
        });
        return;
      }

      // --- Authorization endpoint — instant redirect with a fixed code ---
      if (method === 'GET' && path === '/authorize') {
        const state = u.searchParams.get('state') ?? '';
        const codeChallenge = u.searchParams.get('code_challenge') ?? '';
        const codeChallengeMethod = u.searchParams.get('code_challenge_method');
        const clientId = u.searchParams.get('client_id') ?? '';
        const redirectUri = u.searchParams.get('redirect_uri') ?? '';
        if (codeChallengeMethod !== 'S256' || !codeChallenge) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'missing_pkce' }));
          return;
        }
        const code = 'auth_test_code';
        issuedCodes.set(code, { codeChallenge, redirectUri, clientId });
        const dest = new URL(redirectUri);
        dest.searchParams.set('code', code);
        dest.searchParams.set('state', state);
        res.writeHead(302, { Location: dest.toString() });
        res.end();
        return;
      }

      // --- Token endpoint — auth_code (with PKCE) + refresh_token ---
      if (method === 'POST' && path === '/token') {
        const body = await readBody(req);
        const params = new URLSearchParams(body);
        const grantType = params.get('grant_type');
        if (grantType === 'authorization_code') {
          const code = params.get('code') ?? '';
          const codeVerifier = params.get('code_verifier') ?? '';
          const issued = issuedCodes.get(code);
          if (!issued) {
            sendJson(res, 400, { error: 'invalid_grant' });
            return;
          }
          // Real PKCE validation: SHA-256(verifier).base64url must match.
          const expected = createHash('sha256')
            .update(codeVerifier)
            .digest('base64url');
          if (expected !== issued.codeChallenge) {
            sendJson(res, 400, { error: 'invalid_grant', detail: 'pkce_mismatch' });
            return;
          }
          issuedCodes.delete(code);
          const refresh = `rfr_${Math.random().toString(36).slice(2)}`;
          refreshTokens.set(refresh, {
            clientId: issued.clientId,
            refreshToken: refresh,
          });
          sendJson(res, 200, {
            access_token: 'access_test_token',
            refresh_token: refresh,
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'read write',
          });
          return;
        }
        if (grantType === 'refresh_token') {
          const refresh = params.get('refresh_token') ?? '';
          const record = refreshTokens.get(refresh);
          if (!record) {
            sendJson(res, 400, { error: 'invalid_grant' });
            return;
          }
          sendJson(res, 200, {
            access_token: 'access_test_token_2',
            refresh_token: refresh,
            token_type: 'Bearer',
            expires_in: 3600,
          });
          return;
        }
        sendJson(res, 400, { error: 'unsupported_grant_type' });
        return;
      }

      res.writeHead(404).end();
    } catch (err) {
      // Surface unexpected errors to the test runner so failures aren't silent.
      console.error('[oauth-fixture] handler error', err);
      try {
        res.writeHead(500).end();
      } catch {
        /* socket may already be closed */
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
