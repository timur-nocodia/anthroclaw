import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { verifySessionToken, getApiKey, getAdminEmail } from "./auth";

// ---------------------------------------------------------------------------
// AuthError
// ---------------------------------------------------------------------------

export class AuthError extends Error {
  code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "AuthError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// requireAuth
// ---------------------------------------------------------------------------

export interface AuthResult {
  email: string;
  authMethod: "cookie" | "bearer";
}

/**
 * Checks BOTH bearer token (Authorization header) and cookie auth.
 * Returns the authenticated user info or throws AuthError.
 *
 * Priority:
 *   1. Authorization: Bearer {token} → compare against auth.json apiKey
 *   2. session cookie → verify JWT
 */
export async function requireAuth(): Promise<AuthResult> {
  // 1. Check bearer token
  const hdrs = await headers();
  const authHeader = hdrs.get("authorization");

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const apiKey = getApiKey();
    const email = apiKey && token === apiKey ? getAdminEmail() : null;
    if (email) {
      return { email, authMethod: "bearer" };
    }
    throw new AuthError("unauthorized", "Invalid bearer token");
  }

  // 2. Check session cookie
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session");

  if (sessionCookie?.value) {
    try {
      const { email } = await verifySessionToken(sessionCookie.value);
      return { email, authMethod: "cookie" };
    } catch {
      throw new AuthError("unauthorized", "Invalid session cookie");
    }
  }

  throw new AuthError("unauthorized", "No valid authentication provided");
}

// ---------------------------------------------------------------------------
// handleAuthError
// ---------------------------------------------------------------------------

/**
 * Convert an AuthError (or any error) to a 401 NextResponse.
 */
export function handleAuthError(err: unknown): NextResponse {
  const code = err instanceof AuthError ? err.code : "unauthorized";
  return NextResponse.json({ error: code }, { status: 401 });
}
