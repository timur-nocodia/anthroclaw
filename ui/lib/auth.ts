import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { randomBytes } from "crypto";
import bcrypt from "bcrypt";
import { SignJWT, jwtVerify } from "jose";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthData {
  email: string;
  passwordHash: string;
  apiKey?: string;
  resetToken?: string;
  resetTokenExpiry?: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BCRYPT_ROUNDS = 12;
const JWT_EXPIRY = "7d";
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
export const MIN_PASSWORD_LENGTH = 8;

/** Allow tests to override via AUTH_FILE_PATH env var. */
export function getAuthFilePath(): string {
  return (
    process.env.AUTH_FILE_PATH ??
    resolve(process.cwd(), "..", "data", "auth.json")
  );
}

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET env var must be at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readAuthFile(): AuthData | null {
  const path = getAuthFilePath();
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as AuthData;
}

function writeAuthFile(data: AuthData): void {
  const path = getAuthFilePath();
  const dir = resolve(path, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * On first run, read ADMIN_EMAIL + ADMIN_PASSWORD from env,
 * hash the password, and write data/auth.json.
 * No-op if the file already exists.
 */
export async function initAuth(): Promise<void> {
  if (readAuthFile()) return; // already initialised

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "ADMIN_EMAIL and ADMIN_PASSWORD env vars are required on first run",
    );
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  writeAuthFile({
    email,
    passwordHash,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Verify email + password against stored credentials.
 */
export async function verifyCredentials(
  email: string,
  password: string,
): Promise<boolean> {
  const data = readAuthFile();
  if (!data) return false;
  if (data.email !== email) return false;
  return bcrypt.compare(password, data.passwordHash);
}

/**
 * Create a signed JWT session token (7-day expiry, HS256).
 */
export async function createSessionToken(email: string, sessionId?: string): Promise<string> {
  return new SignJWT({ email, sid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(getJwtSecret());
}

/**
 * Verify and decode a JWT session token.
 */
export async function verifySessionToken(
  token: string,
): Promise<{ email: string }> {
  const { payload } = await jwtVerify(token, getJwtSecret());
  return { email: payload.email as string };
}

/**
 * Change the admin password (requires current password).
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<boolean> {
  const data = readAuthFile();
  if (!data) return false;

  const valid = await bcrypt.compare(currentPassword, data.passwordHash);
  if (!valid) return false;

  data.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  data.updatedAt = new Date().toISOString();
  writeAuthFile(data);
  return true;
}

/**
 * Generate a password-reset token (random 32-byte hex, 1-hour TTL).
 */
export function createResetToken(): { token: string; email: string } {
  const data = readAuthFile();
  if (!data) throw new Error("Auth not initialised");

  const token = randomBytes(32).toString("hex");
  data.resetToken = token;
  data.resetTokenExpiry = new Date(
    Date.now() + RESET_TOKEN_TTL_MS,
  ).toISOString();
  data.updatedAt = new Date().toISOString();
  writeAuthFile(data);

  return { token, email: data.email };
}

/**
 * Reset the password using a valid reset token.
 */
export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<boolean> {
  const data = readAuthFile();
  if (!data) return false;
  if (!data.resetToken || data.resetToken !== token) return false;

  const expired =
    data.resetTokenExpiry &&
    new Date(data.resetTokenExpiry).getTime() < Date.now();

  if (!expired) {
    data.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  }

  // Always clear the reset token (whether expired or consumed)
  data.resetToken = undefined;
  data.resetTokenExpiry = undefined;
  data.updatedAt = new Date().toISOString();
  writeAuthFile(data);

  return !expired;
}

/**
 * Return the stored admin email (or null if not initialised).
 */
export function getAdminEmail(): string | null {
  const data = readAuthFile();
  return data?.email ?? null;
}

/**
 * Generate and store a random API key (bearer token).
 */
export function generateApiKey(): string {
  const data = readAuthFile();
  if (!data) throw new Error("Auth not initialised");

  const apiKey = randomBytes(32).toString("hex");
  data.apiKey = apiKey;
  data.updatedAt = new Date().toISOString();
  writeAuthFile(data);
  return apiKey;
}

/**
 * Return the stored API key (or null).
 */
export function getApiKey(): string | null {
  const data = readAuthFile();
  return data?.apiKey ?? null;
}

// ---------------------------------------------------------------------------
// Session tracking
// ---------------------------------------------------------------------------

export interface SessionRecord {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string;
  ip: string;
}

function getSessionsFilePath(): string {
  return resolve(getAuthFilePath(), "..", "sessions.json");
}

function readSessions(): SessionRecord[] {
  const path = getSessionsFilePath();
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as SessionRecord[];
  } catch {
    return [];
  }
}

function writeSessions(sessions: SessionRecord[]): void {
  const path = getSessionsFilePath();
  const dir = resolve(path, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(sessions, null, 2), "utf-8");
}

export function recordSession(userAgent: string, ip: string): string {
  const sessions = readSessions();
  const id = randomBytes(16).toString("hex");
  sessions.push({
    id,
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    userAgent,
    ip,
  });
  writeSessions(sessions);
  return id;
}

export function touchSession(id: string): void {
  const sessions = readSessions();
  const session = sessions.find((s) => s.id === id);
  if (session) {
    session.lastSeenAt = new Date().toISOString();
    writeSessions(sessions);
  }
}

export function getSessions(): SessionRecord[] {
  return readSessions();
}

export function revokeSession(id: string): boolean {
  const sessions = readSessions();
  const idx = sessions.findIndex((s) => s.id === id);
  if (idx === -1) return false;
  sessions.splice(idx, 1);
  writeSessions(sessions);
  return true;
}

export function revokeAllSessions(): void {
  writeSessions([]);
}
