import { NextRequest, NextResponse } from "next/server";
import { changePassword, MIN_PASSWORD_LENGTH } from "@/lib/auth";
import { requireAuth, handleAuthError } from "@/lib/require-auth";

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAuth();
  } catch (err) {
    return handleAuthError(err);
  }

  const body = await request.json();
  const { currentPassword, newPassword } = body as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { error: "missing_fields" },
      { status: 400 },
    );
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: "password_too_short" },
      { status: 400 },
    );
  }

  const ok = await changePassword(currentPassword, newPassword);
  if (!ok) {
    return NextResponse.json(
      { error: "wrong_password" },
      { status: 401 },
    );
  }

  return NextResponse.json({ ok: true });
}
