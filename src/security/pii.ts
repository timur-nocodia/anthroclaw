/**
 * PII redaction utilities — hashing and masking of personally identifiable
 * information so that agents never persist raw PII.
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Hash a raw PII value with SHA-256 and return the first 12 hex characters,
 * prepended with `prefix` (default `"user_"`).
 *
 * Example: `hashPii("12345", "user_")` -> `"user_5994471abb01"`.
 */
export function hashPii(raw: string, prefix: string = 'user_'): string {
  const hash = createHash('sha256').update(raw).digest('hex');
  return prefix + hash.slice(0, 12);
}

/**
 * Redact a phone number in international format, keeping the country code
 * and the last 3 digits while masking everything in between.
 *
 * Example: `"+77001234567"` -> `"+7*****567"`.
 *
 * Non-international numbers (no leading `+`) are returned fully masked
 * except for the last 3 digits.
 */
export function redactPhoneNumber(phone: string): string {
  // Strip all non-digit and non-+ characters for normalization.
  const cleaned = phone.replace(/[^+\d]/g, '');

  if (cleaned.startsWith('+')) {
    // Determine country code length (1-3 digits after +)
    // Simple heuristic: find where the country code ends.
    // We keep the '+' and the country code, mask the middle, keep last 3.
    const digits = cleaned.slice(1); // all digits after '+'

    if (digits.length <= 3) {
      // Too short to meaningfully mask.
      return cleaned;
    }

    // Country code: first 1-3 digits. We use a simple approach:
    // keep the first digit group before the subscriber number.
    // For the masking requirement, we just need: +CC*****XXX
    const countryCodeLen = detectCountryCodeLength(digits);
    const cc = digits.slice(0, countryCodeLen);
    const rest = digits.slice(countryCodeLen);

    if (rest.length <= 3) {
      return '+' + cc + rest;
    }

    const last3 = rest.slice(-3);
    const middleLen = rest.length - 3;
    return '+' + cc + '*'.repeat(middleLen) + last3;
  }

  // No '+' prefix — mask everything except last 3 digits.
  if (cleaned.length <= 3) return cleaned;
  const last3 = cleaned.slice(-3);
  return '*'.repeat(cleaned.length - 3) + last3;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Very simple country code length detection.
 * Real-world: use libphonenumber. For our purposes, common lengths:
 * - 1 digit: 1 (US/CA), 7 (RU/KZ), 81 (JP but 2 digits)...
 * - 2 digits: 44 (UK), 49 (DE), 33 (FR), etc.
 * - 3 digits: 380 (UA), 375 (BY), etc.
 *
 * Heuristic: if first digit is 1 or 7 → 1 digit, else if < 4 → check
 * common 2-digit vs 3-digit. This is best-effort.
 */
function detectCountryCodeLength(digits: string): number {
  const first = digits[0];
  if (first === '1' || first === '7') return 1;

  // For 2-digit codes: most codes starting with 2x, 3x, 4x, 5x, 6x, 8x, 9x
  // are 2-digit. Codes starting with 2 can be 2 or 3 digits.
  // Default to 2 for simplicity (covers most common cases).
  // A more complete implementation would use a lookup table.
  return 2;
}
