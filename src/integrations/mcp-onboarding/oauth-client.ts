/**
 * OAuth 2.1 client for MCP onboarding (PKCE + DCR + code exchange + refresh).
 *
 * Phase 4 Task 16: PKCE generation. Subsequent tasks add DCR, authorization
 * URL building, and token exchange / refresh.
 *
 * Security notes:
 *  - All endpoints SHOULD be HTTPS in production. We validate the URL is
 *    well-formed via `new URL(...)`. We do NOT hard-reject non-HTTPS URLs
 *    because test fixtures hit http://127.0.0.1:<port>. Callers should
 *    validate at the boundary where URLs are read off the wire.
 *  - PKCE verifier is generated from 32 bytes of `randomBytes` → 43 chars
 *    base64url. Challenge is SHA-256 of the verifier, base64url'd.
 */

import { createHash, randomBytes } from 'node:crypto';

export interface PkcePair {
  verifier: string;
  challenge: string;
  method: 'S256';
}

/**
 * Generate a fresh PKCE verifier + S256 challenge pair (RFC 7636).
 *
 * `seed` exists only for tests so the generator can be made deterministic.
 * Production callers should always omit it.
 */
export function generatePkce(seed?: Buffer): PkcePair {
  const verifier = (seed ?? randomBytes(32)).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge, method: 'S256' };
}

function assertWellFormedUrl(url: string, label: string): void {
  try {
    // eslint-disable-next-line no-new
    new URL(url);
  } catch {
    throw new Error(`${label}: malformed URL`);
  }
}

export interface RegisterArgs {
  registrationEndpoint: string;
  redirectUri: string;
  clientName: string;
  scopes?: string[];
}

export interface RegisterResult {
  clientId: string;
  clientSecret?: string;
}

/**
 * RFC 7591 dynamic client registration. Returns the issued client_id (and
 * optional client_secret for confidential clients).
 *
 * Throws `dcr_failed: <status>` on non-2xx. The caller (facade) maps that
 * to a `{status: 'rejected'}` response so the wizard can surface it.
 *
 * The endpoint is required to be a well-formed URL but we don't enforce
 * HTTPS here so test fixtures bound to http://127.0.0.1:<port> work.
 * Production callers should validate at the boundary where the URL is
 * read off the wire (the probe's resource_metadata response).
 */
export async function registerClient(args: RegisterArgs): Promise<RegisterResult> {
  assertWellFormedUrl(args.registrationEndpoint, 'dcr_failed');
  const res = await fetch(args.registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: args.clientName,
      redirect_uris: [args.redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: args.scopes?.join(' '),
    }),
  });
  if (!res.ok) throw new Error(`dcr_failed: ${res.status}`);
  const body = (await res.json()) as {
    client_id: string;
    client_secret?: string;
  };
  return { clientId: body.client_id, clientSecret: body.client_secret };
}
