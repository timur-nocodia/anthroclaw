import { NextRequest, NextResponse } from "next/server";
import { requireAuth, handleAuthError } from "@/lib/require-auth";
import { getSessions, revokeSession, revokeAllSessions } from "@/lib/auth";

export async function GET(): Promise<NextResponse> {
  try {
    await requireAuth();
  } catch (err) {
    return handleAuthError(err);
  }

  return NextResponse.json({ sessions: getSessions() });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAuth();
  } catch (err) {
    return handleAuthError(err);
  }

  const { id } = await request.json() as { id?: string };

  if (id === "all") {
    revokeAllSessions();
    return NextResponse.json({ ok: true });
  }

  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  const ok = revokeSession(id);
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
