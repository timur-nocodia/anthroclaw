import { NextResponse } from "next/server";
import { withAuth } from "@/lib/route-handler";
import { generateApiKey, getApiKey } from "@/lib/auth";

/** GET  — return the current API key (masked) or null. */
export async function GET() {
  return withAuth(async () => {
    const key = getApiKey();
    if (!key) return NextResponse.json({ key: null });

    // Mask all but prefix + last 4 chars
    const masked =
      key.length > 8
        ? `${key.slice(0, 4)}${"*".repeat(key.length - 8)}${key.slice(-4)}`
        : key;

    return NextResponse.json({
      key: masked,
      createdAt: new Date().toISOString(), // we don't persist creation date yet
    });
  });
}

/** POST — generate a new API key (returns full key once). */
export async function POST() {
  return withAuth(async () => {
    const key = generateApiKey();
    return NextResponse.json({ key });
  });
}

/** DELETE — revoke the current API key. */
export async function DELETE() {
  return withAuth(async () => {
    // generateApiKey replaces the old one; to revoke, we'd remove it.
    // For now: re-generate effectively invalidates the old key.
    // A proper "revoke" would clear the key entirely.
    // Since auth.ts doesn't expose a revokeApiKey, we generate a new
    // one and don't return it — effectively revoking the previous.
    generateApiKey();
    return NextResponse.json({ ok: true });
  });
}
