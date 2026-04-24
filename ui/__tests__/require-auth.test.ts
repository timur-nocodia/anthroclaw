import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { resolve, join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Set env vars BEFORE importing
const tmpDir = mkdtempSync(join(tmpdir(), "require-auth-test-"));
const authFilePath = resolve(tmpDir, "auth.json");

process.env.AUTH_FILE_PATH = authFilePath;
process.env.JWT_SECRET = "test-secret-that-is-at-least-32-characters-long!!";
process.env.ADMIN_EMAIL = "admin@test.com";
process.env.ADMIN_PASSWORD = "testpassword123";

// Mock next/headers BEFORE importing require-auth
vi.mock("next/headers", () => {
  let mockCookies: Record<string, { name: string; value: string }> = {};
  let mockHeaders: Record<string, string> = {};

  return {
    cookies: vi.fn(async () => ({
      get: (name: string) => mockCookies[name],
      set: vi.fn(),
    })),
    headers: vi.fn(async () => ({
      get: (name: string) => mockHeaders[name.toLowerCase()] ?? null,
    })),
    __setMockCookies: (c: Record<string, { name: string; value: string }>) => {
      mockCookies = c;
    },
    __setMockHeaders: (h: Record<string, string>) => {
      mockHeaders = h;
    },
  };
});

import {
  requireAuth,
  AuthError,
  handleAuthError,
} from "@/lib/require-auth";
import {
  initAuth,
  createSessionToken,
  generateApiKey,
} from "@/lib/auth";

// Access mock helpers
async function setMockCookies(
  c: Record<string, { name: string; value: string }>,
) {
  const mod = await import("next/headers");
  (mod as any).__setMockCookies(c);
}

async function setMockHeaders(h: Record<string, string>) {
  const mod = await import("next/headers");
  (mod as any).__setMockHeaders(h);
}

describe("require-auth", () => {
  beforeEach(async () => {
    // Clean auth file
    try {
      const { unlinkSync } = require("fs");
      unlinkSync(authFilePath);
    } catch {
      // fine
    }

    // Reset mocks
    await setMockCookies({});
    await setMockHeaders({});

    // Init auth
    process.env.ADMIN_EMAIL = "admin@test.com";
    process.env.ADMIN_PASSWORD = "testpassword123";
    await initAuth();
  });

  // -----------------------------------------------------------------------
  // requireAuth with cookie
  // -----------------------------------------------------------------------

  it("passes with valid session cookie", async () => {
    const token = await createSessionToken("admin@test.com");
    await setMockCookies({
      session: { name: "session", value: token },
    });

    const result = await requireAuth();
    expect(result.email).toBe("admin@test.com");
    expect(result.authMethod).toBe("cookie");
  });

  // -----------------------------------------------------------------------
  // requireAuth with bearer token
  // -----------------------------------------------------------------------

  it("passes with valid bearer token", async () => {
    const apiKey = generateApiKey();
    await setMockHeaders({
      authorization: `Bearer ${apiKey}`,
    });

    const result = await requireAuth();
    expect(result.email).toBe("admin@test.com");
    expect(result.authMethod).toBe("bearer");
  });

  // -----------------------------------------------------------------------
  // requireAuth rejects
  // -----------------------------------------------------------------------

  it("rejects with no auth", async () => {
    await expect(requireAuth()).rejects.toThrow(AuthError);
    try {
      await requireAuth();
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).code).toBe("unauthorized");
    }
  });

  it("rejects with invalid session cookie", async () => {
    await setMockCookies({
      session: { name: "session", value: "invalid-jwt" },
    });

    await expect(requireAuth()).rejects.toThrow(AuthError);
  });

  it("rejects with invalid bearer token", async () => {
    generateApiKey(); // create a real key
    await setMockHeaders({
      authorization: "Bearer wrong-token",
    });

    await expect(requireAuth()).rejects.toThrow(AuthError);
  });

  // -----------------------------------------------------------------------
  // AuthError
  // -----------------------------------------------------------------------

  it("AuthError has correct code property", () => {
    const err = new AuthError("unauthorized", "test message");
    expect(err.code).toBe("unauthorized");
    expect(err.message).toBe("test message");
    expect(err.name).toBe("AuthError");
    expect(err instanceof Error).toBe(true);
  });

  // -----------------------------------------------------------------------
  // handleAuthError
  // -----------------------------------------------------------------------

  it("handleAuthError returns 401 for AuthError", () => {
    const err = new AuthError("unauthorized");
    const response = handleAuthError(err);
    expect(response.status).toBe(401);
  });

  it("handleAuthError returns 401 for generic errors", () => {
    const err = new Error("something");
    const response = handleAuthError(err);
    expect(response.status).toBe(401);
  });
});
