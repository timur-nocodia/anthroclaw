import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { hashPii, redactPhoneNumber } from '../../src/security/pii.js';

// ---------------------------------------------------------------------------
// hashPii
// ---------------------------------------------------------------------------

describe('hashPii', () => {
  it('returns prefix + first 12 hex chars of SHA-256', () => {
    const expected = createHash('sha256').update('12345').digest('hex').slice(0, 12);
    expect(hashPii('12345', 'user_')).toBe(`user_${expected}`);
  });

  it('uses default prefix "user_" when not specified', () => {
    const result = hashPii('hello');
    expect(result.startsWith('user_')).toBe(true);
    expect(result.length).toBe(5 + 12); // "user_" + 12 hex chars
  });

  it('accepts custom prefix', () => {
    const result = hashPii('test', 'chat_');
    expect(result.startsWith('chat_')).toBe(true);
    expect(result.length).toBe(5 + 12);
  });

  it('accepts empty prefix', () => {
    const result = hashPii('data', '');
    expect(result.length).toBe(12);
  });

  it('is deterministic', () => {
    expect(hashPii('same_input')).toBe(hashPii('same_input'));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashPii('input_a')).not.toBe(hashPii('input_b'));
  });

  it('handles empty string input', () => {
    const result = hashPii('');
    expect(result.startsWith('user_')).toBe(true);
    expect(result.length).toBe(17);
  });

  it('handles unicode input', () => {
    const result = hashPii('тест');
    expect(result.startsWith('user_')).toBe(true);
    expect(result.length).toBe(17);
  });
});

// ---------------------------------------------------------------------------
// redactPhoneNumber
// ---------------------------------------------------------------------------

describe('redactPhoneNumber', () => {
  it('redacts +7 number: +77001234567 → +7*******567', () => {
    expect(redactPhoneNumber('+77001234567')).toBe('+7*******567');
  });

  it('redacts +1 number: +14155551234 → +1*******234', () => {
    expect(redactPhoneNumber('+14155551234')).toBe('+1*******234');
  });

  it('redacts +44 number: +447911123456 → +44*******456', () => {
    expect(redactPhoneNumber('+447911123456')).toBe('+44*******456');
  });

  it('redacts +49 number: +491234567890 → +49*******890', () => {
    expect(redactPhoneNumber('+491234567890')).toBe('+49*******890');
  });

  it('keeps country code and last 3 digits, masks middle', () => {
    const result = redactPhoneNumber('+77001234567');
    // Country code is "7", last 3 digits are "567"
    expect(result.startsWith('+7')).toBe(true);
    expect(result.endsWith('567')).toBe(true);
    expect(result).toContain('*');
  });

  it('handles number without + prefix', () => {
    const result = redactPhoneNumber('89991234567');
    expect(result.endsWith('567')).toBe(true);
    expect(result).toContain('*');
  });

  it('handles very short numbers gracefully', () => {
    // +7123 (country code 7, digits "123" — too short to mask)
    const result = redactPhoneNumber('+7123');
    // Should not crash; returns something reasonable.
    expect(result.startsWith('+')).toBe(true);
  });

  it('handles numbers with formatting (spaces, dashes)', () => {
    const result = redactPhoneNumber('+7 (700) 123-45-67');
    expect(result.startsWith('+7')).toBe(true);
    expect(result.endsWith('567')).toBe(true);
  });

  it('handles 3-char or fewer input without crashing', () => {
    expect(redactPhoneNumber('123')).toBe('123');
  });
});
