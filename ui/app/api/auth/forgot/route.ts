import { NextRequest, NextResponse } from "next/server";
import { getAdminEmail, createResetToken } from "@/lib/auth";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json();
  const { email } = body as { email?: string };

  // Always return 200 to prevent email enumeration
  if (email === getAdminEmail()) {
    try {
      createResetToken();
    } catch {
      // silently fail — no enumeration
    }
  }

  return NextResponse.json({ ok: true, method: "cli" });
}
