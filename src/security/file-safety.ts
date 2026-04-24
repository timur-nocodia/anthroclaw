/**
 * Write / read path denylist — prevents agents from touching sensitive files
 * such as SSH keys, shell profiles, credential stores, etc.
 */

import { resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { realpathSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Denylist definitions
// ---------------------------------------------------------------------------

/** Files relative to $HOME that are write-denied (exact match). */
const HOME_EXACT_DENY: string[] = [
  '.ssh/authorized_keys',
  '.ssh/id_rsa',
  '.ssh/id_ed25519',
  '.ssh/config',
  '.bashrc',
  '.zshrc',
  '.profile',
  '.bash_profile',
  '.netrc',
  '.npmrc',
  '.pgpass',
  '.pypirc',
];

/** Absolute paths that are write-denied (exact match). */
const ABSOLUTE_EXACT_DENY: string[] = [
  '/etc/sudoers',
  '/etc/passwd',
  '/etc/shadow',
];

/** Directory prefixes relative to $HOME (write-denied). */
const HOME_PREFIX_DENY: string[] = [
  '.ssh/',
  '.aws/',
  '.gnupg/',
  '.kube/',
  '.docker/',
  '.azure/',
  '.config/gh/',
];

/** Absolute directory prefixes (write-denied). */
const ABSOLUTE_PREFIX_DENY: string[] = [
  '/etc/sudoers.d/',
  '/etc/systemd/',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Best-effort path resolution: resolves `..`, symlinks, etc.
 * Falls back to `resolve()` if the file does not exist yet.
 */
function resolvePath(filePath: string): string {
  const resolved = resolve(filePath);
  try {
    return realpathSync(resolved);
  } catch {
    // File may not exist yet — fall back to logical resolution.
    return resolved;
  }
}

function isUnderHome(resolvedPath: string, home: string): boolean {
  return resolvedPath.startsWith(home + '/') || resolvedPath === home;
}

function relativeToHome(resolvedPath: string, home: string): string {
  return resolvedPath.slice(home.length + 1); // strip home + '/'
}

// ---------------------------------------------------------------------------
// Core check
// ---------------------------------------------------------------------------

/**
 * Check a single resolved path against all denylist rules.
 */
function checkPath(resolved: string, home: string, includeEnv: boolean): boolean {
  // --- absolute exact deny ---
  for (const denied of ABSOLUTE_EXACT_DENY) {
    if (resolved === denied) return true;
  }

  // --- absolute prefix deny ---
  for (const prefix of ABSOLUTE_PREFIX_DENY) {
    if (resolved.startsWith(prefix)) return true;
  }

  // --- home-relative checks ---
  if (isUnderHome(resolved, home)) {
    const rel = relativeToHome(resolved, home);

    for (const denied of HOME_EXACT_DENY) {
      if (rel === denied) return true;
    }

    for (const prefix of HOME_PREFIX_DENY) {
      if (rel.startsWith(prefix)) return true;
    }
  }

  // --- .env file check (read-deny only) ---
  if (includeEnv) {
    const base = basename(resolved);
    if (base === '.env' || base.startsWith('.env.')) return true;
  }

  return false;
}

function isDenied(filePath: string, includeEnv: boolean): boolean {
  const logical = resolve(filePath);
  const real = resolvePath(filePath);
  const home = homedir();

  // Check both the logical path and the real (symlink-resolved) path.
  // On macOS, /etc → /private/etc, so the logical "/etc/sudoers" must
  // also be checked against the denylist, not just the resolved form.
  if (checkPath(logical, home, includeEnv)) return true;
  if (real !== logical && checkPath(real, home, includeEnv)) return true;

  // --- WRITE_SAFE_ROOT enforcement ---
  const safeRoot = process.env.WRITE_SAFE_ROOT;
  if (safeRoot) {
    const resolvedRoot = resolvePath(safeRoot);
    if (!real.startsWith(resolvedRoot + '/') && real !== resolvedRoot) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns `true` when `filePath` is on the write denylist.
 *
 * Handles relative paths, `..` traversal, and symlinks.
 * If `WRITE_SAFE_ROOT` env var is set, any path outside that root is denied.
 */
export function isWriteDenied(filePath: string): boolean {
  return isDenied(filePath, false);
}

/**
 * Returns `true` when `filePath` is on the read denylist.
 *
 * Includes everything from the write denylist **plus** `.env` files.
 */
export function isReadDenied(filePath: string): boolean {
  return isDenied(filePath, true);
}
