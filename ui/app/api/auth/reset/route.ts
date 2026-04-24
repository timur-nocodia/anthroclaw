import { NextRequest, NextResponse } from "next/server";
import { resetPassword, MIN_PASSWORD_LENGTH } from "@/lib/auth";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json();
  const { token, password } = body as { token?: string; password?: string };

  if (!token || !password) {
    return NextResponse.json(
      { error: "invalid_token" },
      { status: 400 },
    );
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: "password_too_short" },
      { status: 400 },
    );
  }

  const ok = await resetPassword(token, password);
  if (!ok) {
    return NextResponse.json(
      { error: "invalid_token" },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
