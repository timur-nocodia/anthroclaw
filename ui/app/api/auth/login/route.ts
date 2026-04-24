import { NextRequest, NextResponse } from "next/server";
import { verifyCredentials, createSessionToken, initAuth, recordSession } from "@/lib/auth";

export async function POST(request: NextRequest): Promise<NextResponse> {
  await initAuth();

  const body = await request.json();
  const { email, password } = body as { email?: string; password?: string };

  if (!email || !password) {
    return NextResponse.json(
      { error: "invalid_credentials" },
      { status: 401 },
    );
  }

  const valid = await verifyCredentials(email, password);
  if (!valid) {
    return NextResponse.json(
      { error: "invalid_credentials" },
      { status: 401 },
    );
  }

  const ua = request.headers.get("user-agent") ?? "unknown";
  const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "127.0.0.1";
  const sessionId = recordSession(ua, ip);

  const token = await createSessionToken(email, sessionId);

  const response = NextResponse.json({ ok: true });
  response.cookies.set("session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });

  return response;
}
