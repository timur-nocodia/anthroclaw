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
