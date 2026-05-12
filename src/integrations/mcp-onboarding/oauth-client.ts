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

// Track which insecure URLs we've already warned about so we don't spam the
// log on retry. Per-process; cleared only by process restart.
const warnedInsecureUrls = new Set<string>();

/**
 * Warn (once per unique URL) when an OAuth-related endpoint is reached over
 * plain HTTP in production. Loopback addresses are exempt — they exist so a
 * locally-hosted MCP server can be exercised against a real authorization
 * server during development. Outside `NODE_ENV=production` we stay quiet
 * because test fixtures bind to http://127.0.0.1.
 */
export function maybeWarnInsecureUrl(url: string, context: string): void {
  if (process.env.NODE_ENV !== 'production') return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol === 'https:') return;
  if (['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) return;
  if (warnedInsecureUrls.has(url)) return;
  warnedInsecureUrls.add(url);
  console.warn(
    `[mcp-onboarding] insecure OAuth endpoint (${context}): ${url}. Use HTTPS in production.`,
  );
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
  maybeWarnInsecureUrl(args.registrationEndpoint, 'registration_endpoint');
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

export interface BuildAuthorizationUrlArgs {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: string[];
}

/**
 * Build a URL the user agent can visit to start the OAuth dance. PKCE is
 * always advertised as S256.
 */
export function buildAuthorizationUrl(args: BuildAuthorizationUrlArgs): string {
  assertWellFormedUrl(args.authorizationEndpoint, 'authorization_url_invalid');
  const u = new URL(args.authorizationEndpoint);
  u.searchParams.set('client_id', args.clientId);
  u.searchParams.set('redirect_uri', args.redirectUri);
  u.searchParams.set('state', args.state);
  u.searchParams.set('code_challenge', args.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('response_type', 'code');
  if (args.scopes?.length) u.searchParams.set('scope', args.scopes.join(' '));
  return u.toString();
}

export interface ExchangeResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
}

export interface ExchangeCodeArgs {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}

/**
 * RFC 6749 §4.1.3 authorization-code grant + PKCE verifier (RFC 7636).
 *
 * Returns access token (+ optional refresh token and expiry). Throws
 * `token_exchange_failed: <status>` on non-2xx.
 */
export async function exchangeCode(args: ExchangeCodeArgs): Promise<ExchangeResult> {
  assertWellFormedUrl(args.tokenEndpoint, 'token_exchange_failed');
  maybeWarnInsecureUrl(args.tokenEndpoint, 'token_endpoint');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: args.clientId,
    code_verifier: args.codeVerifier,
  });
  if (args.clientSecret) body.set('client_secret', args.clientSecret);
  const res = await fetch(args.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`token_exchange_failed: ${res.status}`);
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
    scopes: json.scope?.split(/\s+/),
  };
}

export interface RefreshTokenArgs {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
}

/**
 * RFC 6749 §6 refresh-token grant.
 *
 * Throws `refresh_revoked` if the AS replies 400 + `error: invalid_grant`
 * (user revoked consent or the refresh token expired). Throws
 * `refresh_failed: <status>` for other non-2xx.
 */
export async function refreshToken(args: RefreshTokenArgs): Promise<ExchangeResult> {
  assertWellFormedUrl(args.tokenEndpoint, 'refresh_failed');
  maybeWarnInsecureUrl(args.tokenEndpoint, 'token_endpoint');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: args.refreshToken,
    client_id: args.clientId,
  });
  if (args.clientSecret) body.set('client_secret', args.clientSecret);
  const res = await fetch(args.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (res.status === 400) {
    const err = (await res
      .clone()
      .json()
      .catch(() => ({}))) as { error?: string };
    if (err.error === 'invalid_grant') throw new Error('refresh_revoked');
  }
  if (!res.ok) throw new Error(`refresh_failed: ${res.status}`);
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
    scopes: json.scope?.split(/\s+/),
  };
}
