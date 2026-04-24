import { NextResponse } from "next/server";
import { requireAuth, handleAuthError } from "@/lib/require-auth";
import { getAdminEmail } from "@/lib/auth";

export async function GET(): Promise<NextResponse> {
  try {
    await requireAuth();
  } catch (err) {
    return handleAuthError(err);
  }

  const email = getAdminEmail();
  return NextResponse.json({ email });
}
