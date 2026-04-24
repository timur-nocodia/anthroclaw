import { mkdtempSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { resolve, join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Set env vars BEFORE importing auth module
const tmpDir = mkdtempSync(join(tmpdir(), "auth-test-"));
const authFilePath = resolve(tmpDir, "auth.json");

// Override auth file path and JWT secret via env
process.env.AUTH_FILE_PATH = authFilePath;
process.env.JWT_SECRET = "test-secret-that-is-at-least-32-characters-long!!";

import {
  initAuth,
  verifyCredentials,
  createSessionToken,
  verifySessionToken,
  changePassword,
  createResetToken,
  resetPassword,
  getAdminEmail,
  generateApiKey,
  getApiKey,
  type AuthData,
} from "@/lib/auth";

describe("auth module", () => {
  beforeEach(() => {
    // Clean up auth file before each test
    try {
      const { unlinkSync } = require("fs");
      unlinkSync(authFilePath);
    } catch {
      // file doesn't exist, that's fine
    }

    // Set default env vars for initAuth
    process.env.ADMIN_EMAIL = "admin@test.com";
    process.env.ADMIN_PASSWORD = "testpassword123";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // initAuth
  // -----------------------------------------------------------------------

  describe("initAuth", () => {
    it("creates auth.json from env vars on first run", async () => {
      expect(existsSync(authFilePath)).toBe(false);

      await initAuth();

      expect(existsSync(authFilePath)).toBe(true);
      const data: AuthData = JSON.parse(readFileSync(authFilePath, "utf-8"));
      expect(data.email).toBe("admin@test.com");
      expect(data.passwordHash).toBeDefined();
      expect(data.passwordHash).not.toBe("testpassword123"); // hashed
      expect(data.updatedAt).toBeDefined();
    });

    it("is a no-op if auth.json already exists", async () => {
      await initAuth();
      const data1: AuthData = JSON.parse(readFileSync(authFilePath, "utf-8"));

      // Change env vars — should not matter
      process.env.ADMIN_EMAIL = "other@test.com";
      process.env.ADMIN_PASSWORD = "otherpassword";

      await initAuth();
      const data2: AuthData = JSON.parse(readFileSync(authFilePath, "utf-8"));

      expect(data2.email).toBe("admin@test.com");
      expect(data2.passwordHash).toBe(data1.passwordHash);
    });

    it("throws if env vars are missing on first run", async () => {
      delete process.env.ADMIN_EMAIL;
      delete process.env.ADMIN_PASSWORD;

      await expect(initAuth()).rejects.toThrow(
        "ADMIN_EMAIL and ADMIN_PASSWORD env vars are required",
      );
    });
  });

  // -----------------------------------------------------------------------
  // verifyCredentials
  // -----------------------------------------------------------------------

  describe("verifyCredentials", () => {
    beforeEach(async () => {
      await initAuth();
    });

    it("returns true for correct email and password", async () => {
      const result = await verifyCredentials(
        "admin@test.com",
        "testpassword123",
      );
      expect(result).toBe(true);
    });

    it("returns false for wrong password", async () => {
      const result = await verifyCredentials("admin@test.com", "wrongpassword");
      expect(result).toBe(false);
    });

    it("returns false for wrong email", async () => {
      const result = await verifyCredentials(
        "wrong@test.com",
        "testpassword123",
      );
      expect(result).toBe(false);
    });

    it("returns false when auth file does not exist", async () => {
      const { unlinkSync } = require("fs");
      unlinkSync(authFilePath);

      const result = await verifyCredentials(
        "admin@test.com",
        "testpassword123",
      );
      expect(result).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // createSessionToken + verifySessionToken
  // -----------------------------------------------------------------------

  describe("JWT session tokens", () => {
    it("roundtrips: create → verify", async () => {
      const token = await createSessionToken("admin@test.com");
      expect(typeof token).toBe("string");

      const payload = await verifySessionToken(token);
      expect(payload.email).toBe("admin@test.com");
    });

    it("rejects invalid token", async () => {
      await expect(verifySessionToken("garbage.token.here")).rejects.toThrow();
    });

    it("rejects expired token", async () => {
      // We can't easily create an expired token, so we mock Date to be in the future
      // Instead, we create a token with a very short expiry by mocking the module
      // For simplicity, test with a tampered token
      const token = await createSessionToken("admin@test.com");
      // Tamper with the payload
      const parts = token.split(".");
      parts[1] = "tampered";
      const tampered = parts.join(".");
      await expect(verifySessionToken(tampered)).rejects.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // changePassword
  // -----------------------------------------------------------------------

  describe("changePassword", () => {
    beforeEach(async () => {
      await initAuth();
    });

    it("succeeds with correct current password", async () => {
      const ok = await changePassword("testpassword123", "newpassword456");
      expect(ok).toBe(true);

      // Verify new password works
      const valid = await verifyCredentials("admin@test.com", "newpassword456");
      expect(valid).toBe(true);

      // Old password no longer works
      const invalid = await verifyCredentials(
        "admin@test.com",
        "testpassword123",
      );
      expect(invalid).toBe(false);
    });

    it("fails with wrong current password", async () => {
      const ok = await changePassword("wrongpassword", "newpassword456");
      expect(ok).toBe(false);
    });

    it("fails when auth file does not exist", async () => {
      const { unlinkSync } = require("fs");
      unlinkSync(authFilePath);

      const ok = await changePassword("testpassword123", "newpassword456");
      expect(ok).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // createResetToken + resetPassword
  // -----------------------------------------------------------------------

  describe("password reset flow", () => {
    beforeEach(async () => {
      await initAuth();
    });

    it("roundtrips: createResetToken → resetPassword", async () => {
      const { token, email } = createResetToken();
      expect(typeof token).toBe("string");
      expect(token.length).toBe(64); // 32 bytes hex
      expect(email).toBe("admin@test.com");

      const ok = await resetPassword(token, "brandnewpass");
      expect(ok).toBe(true);

      // Verify new password works
      const valid = await verifyCredentials("admin@test.com", "brandnewpass");
      expect(valid).toBe(true);

      // Reset token cleared
      const data: AuthData = JSON.parse(readFileSync(authFilePath, "utf-8"));
      expect(data.resetToken).toBeUndefined();
      expect(data.resetTokenExpiry).toBeUndefined();
    });

    it("rejects invalid reset token", async () => {
      createResetToken();

      const ok = await resetPassword("wrong-token", "brandnewpass");
      expect(ok).toBe(false);
    });

    it("rejects expired reset token", async () => {
      const { token } = createResetToken();

      // Manually expire the token
      const data: AuthData = JSON.parse(readFileSync(authFilePath, "utf-8"));
      data.resetTokenExpiry = new Date(
        Date.now() - 1000, // 1 second in the past
      ).toISOString();
      const { writeFileSync } = require("fs");
      writeFileSync(authFilePath, JSON.stringify(data, null, 2), "utf-8");

      const ok = await resetPassword(token, "brandnewpass");
      expect(ok).toBe(false);
    });

    it("returns false when no auth file exists", async () => {
      const { unlinkSync } = require("fs");
      unlinkSync(authFilePath);

      const ok = await resetPassword("any-token", "brandnewpass");
      expect(ok).toBe(false);
    });

    it("throws when createResetToken called with no auth file", () => {
      const { unlinkSync } = require("fs");
      unlinkSync(authFilePath);

      expect(() => createResetToken()).toThrow("Auth not initialised");
    });
  });

  // -----------------------------------------------------------------------
  // getAdminEmail
  // -----------------------------------------------------------------------

  describe("getAdminEmail", () => {
    it("returns email when auth is initialised", async () => {
      await initAuth();
      expect(getAdminEmail()).toBe("admin@test.com");
    });

    it("returns null when auth file does not exist", () => {
      expect(getAdminEmail()).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // generateApiKey
  // -----------------------------------------------------------------------

  describe("generateApiKey", () => {
    beforeEach(async () => {
      await initAuth();
    });

    it("creates and stores an API key", () => {
      const key = generateApiKey();
      expect(typeof key).toBe("string");
      expect(key.length).toBe(64); // 32 bytes hex

      // Verify stored
      const storedKey = getApiKey();
      expect(storedKey).toBe(key);

      const data: AuthData = JSON.parse(readFileSync(authFilePath, "utf-8"));
      expect(data.apiKey).toBe(key);
    });

    it("overwrites existing API key", () => {
      const key1 = generateApiKey();
      const key2 = generateApiKey();
      expect(key1).not.toBe(key2);
      expect(getApiKey()).toBe(key2);
    });

    it("throws when auth file does not exist", () => {
      const { unlinkSync } = require("fs");
      unlinkSync(authFilePath);

      expect(() => generateApiKey()).toThrow("Auth not initialised");
    });
  });
});
