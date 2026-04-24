import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { resolve, join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Set env vars BEFORE any module imports
const tmpDir = mkdtempSync(join(tmpdir(), "api-auth-test-"));
const authFilePath = resolve(tmpDir, "auth.json");

process.env.AUTH_FILE_PATH = authFilePath;
process.env.JWT_SECRET = "test-secret-that-is-at-least-32-characters-long!!";
process.env.ADMIN_EMAIL = "admin@test.com";
process.env.ADMIN_PASSWORD = "testpassword123";

// Track cookies set by responses
let responseCookies: Map<string, string> = new Map();

// Mock next/headers for requireAuth in password route
let mockCookies: Record<string, { name: string; value: string }> = {};
let mockHeaders: Record<string, string> = {};

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => mockCookies[name],
    set: vi.fn(),
  })),
  headers: vi.fn(async () => ({
    get: (name: string) => mockHeaders[name.toLowerCase()] ?? null,
  })),
}));

import { initAuth, createSessionToken, createResetToken } from "@/lib/auth";

// Helper to create JSON request
function jsonRequest(
  url: string,
  body: Record<string, unknown>,
  method = "POST",
): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("auth API routes", () => {
  beforeEach(async () => {
    // Clean auth file
    try {
      const { unlinkSync } = require("fs");
      unlinkSync(authFilePath);
    } catch {
      // fine
    }
    responseCookies = new Map();
    mockCookies = {};
    mockHeaders = {};

    process.env.ADMIN_EMAIL = "admin@test.com";
    process.env.ADMIN_PASSWORD = "testpassword123";
    await initAuth();
  });

  // -----------------------------------------------------------------------
  // Login
  // -----------------------------------------------------------------------

  describe("POST /api/auth/login", () => {
    it("returns 200 + sets cookie on valid login", async () => {
      const { POST } = await import("@/app/api/auth/login/route");

      const req = jsonRequest("/api/auth/login", {
        email: "admin@test.com",
        password: "testpassword123",
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.ok).toBe(true);

      // Check Set-Cookie header
      const setCookie = res.headers.getSetCookie();
      expect(setCookie.length).toBeGreaterThan(0);
      const sessionCookie = setCookie.find((c: string) =>
        c.startsWith("session="),
      );
      expect(sessionCookie).toBeDefined();
      expect(sessionCookie).toContain("HttpOnly");
      expect(sessionCookie?.toLowerCase()).toContain("samesite=lax");
    });

    it("returns 401 on wrong password", async () => {
      const { POST } = await import("@/app/api/auth/login/route");

      const req = jsonRequest("/api/auth/login", {
        email: "admin@test.com",
        password: "wrongpassword",
      });

      const res = await POST(req);
      expect(res.status).toBe(401);

      const json = await res.json();
      expect(json.error).toBe("invalid_credentials");
    });

    it("returns 401 on wrong email", async () => {
      const { POST } = await import("@/app/api/auth/login/route");

      const req = jsonRequest("/api/auth/login", {
        email: "wrong@test.com",
        password: "testpassword123",
      });

      const res = await POST(req);
      expect(res.status).toBe(401);

      const json = await res.json();
      expect(json.error).toBe("invalid_credentials");
    });
  });

  // -----------------------------------------------------------------------
  // Logout
  // -----------------------------------------------------------------------

  describe("POST /api/auth/logout", () => {
    it("returns 200 and clears the cookie", async () => {
      const { POST } = await import("@/app/api/auth/logout/route");

      const res = await POST();
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.ok).toBe(true);

      // Cookie should be cleared (maxAge=0)
      const setCookie = res.headers.getSetCookie();
      const sessionCookie = setCookie.find((c: string) =>
        c.startsWith("session="),
      );
      expect(sessionCookie).toBeDefined();
      expect(sessionCookie).toContain("Max-Age=0");
    });
  });

  // -----------------------------------------------------------------------
  // Password change
  // -----------------------------------------------------------------------

  describe("PUT /api/auth/password", () => {
    it("returns 200 on success", async () => {
      // Set up auth cookie
      const token = await createSessionToken("admin@test.com");
      mockCookies = {
        session: { name: "session", value: token },
      };

      const { PUT } = await import("@/app/api/auth/password/route");

      const req = jsonRequest(
        "/api/auth/password",
        {
          currentPassword: "testpassword123",
          newPassword: "newpassword456",
        },
        "PUT",
      );

      const res = await PUT(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    it("returns 400 if new password is too short", async () => {
      const token = await createSessionToken("admin@test.com");
      mockCookies = {
        session: { name: "session", value: token },
      };

      const { PUT } = await import("@/app/api/auth/password/route");

      const req = jsonRequest(
        "/api/auth/password",
        {
          currentPassword: "testpassword123",
          newPassword: "short",
        },
        "PUT",
      );

      const res = await PUT(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toBe("password_too_short");
    });

    it("returns 401 if current password is wrong", async () => {
      const token = await createSessionToken("admin@test.com");
      mockCookies = {
        session: { name: "session", value: token },
      };

      const { PUT } = await import("@/app/api/auth/password/route");

      const req = jsonRequest(
        "/api/auth/password",
        {
          currentPassword: "wrongpassword",
          newPassword: "newpassword456",
        },
        "PUT",
      );

      const res = await PUT(req);
      expect(res.status).toBe(401);

      const json = await res.json();
      expect(json.error).toBe("wrong_password");
    });

    it("returns 401 if not authenticated", async () => {
      // No cookies, no headers
      const { PUT } = await import("@/app/api/auth/password/route");

      const req = jsonRequest(
        "/api/auth/password",
        {
          currentPassword: "testpassword123",
          newPassword: "newpassword456",
        },
        "PUT",
      );

      const res = await PUT(req);
      expect(res.status).toBe(401);
    });
  });

  // -----------------------------------------------------------------------
  // Forgot password
  // -----------------------------------------------------------------------

  describe("POST /api/auth/forgot", () => {
    it("returns 200 and method:cli for valid email", async () => {
      const { POST } = await import("@/app/api/auth/forgot/route");

      const req = jsonRequest("/api/auth/forgot", {
        email: "admin@test.com",
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.method).toBe("cli");
    });

    it("returns 200 even for unknown email (no enumeration)", async () => {
      const { POST } = await import("@/app/api/auth/forgot/route");

      const req = jsonRequest("/api/auth/forgot", {
        email: "unknown@test.com",
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.ok).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Reset password
  // -----------------------------------------------------------------------

  describe("POST /api/auth/reset", () => {
    it("returns 200 with valid token and password", async () => {
      const { token } = createResetToken();

      const { POST } = await import("@/app/api/auth/reset/route");

      const req = jsonRequest("/api/auth/reset", {
        token,
        password: "brandnewpass123",
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    it("returns 400 with invalid token", async () => {
      createResetToken();

      const { POST } = await import("@/app/api/auth/reset/route");

      const req = jsonRequest("/api/auth/reset", {
        token: "invalid-token",
        password: "brandnewpass123",
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toBe("invalid_token");
    });

    it("returns 400 if password too short", async () => {
      const { token } = createResetToken();

      const { POST } = await import("@/app/api/auth/reset/route");

      const req = jsonRequest("/api/auth/reset", {
        token,
        password: "short",
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toBe("password_too_short");
    });

    it("returns 400 if token or password missing", async () => {
      const { POST } = await import("@/app/api/auth/reset/route");

      const req = jsonRequest("/api/auth/reset", {});

      const res = await POST(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toBe("invalid_token");
    });
  });
});
