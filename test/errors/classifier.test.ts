import { describe, it, expect } from 'vitest';
import { classifyError, FailoverReason } from '../../src/errors/classifier.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fake API error with a status code and message. */
function apiError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

/** Create an error with status_code (some SDKs use snake_case). */
function apiErrorSnake(statusCode: number, message: string): Error & { status_code: number } {
  const err = new Error(message) as Error & { status_code: number };
  err.status_code = statusCode;
  return err;
}

/** Create an error whose `.cause` has the status code. */
function causedError(status: number, message: string): Error {
  const cause = new Error('inner') as Error & { status: number };
  cause.status = status;
  return new Error(message, { cause });
}

// ---------------------------------------------------------------------------
// Status-code based classification
// ---------------------------------------------------------------------------

describe('classifyError – status-code pipeline', () => {
  it('401 → Auth, not retryable', () => {
    const c = classifyError(apiError(401, 'Unauthorized'));
    expect(c.reason).toBe(FailoverReason.Auth);
    expect(c.statusCode).toBe(401);
    expect(c.retryable).toBe(false);
  });

  it('402 without transient signal → Billing', () => {
    const c = classifyError(apiError(402, 'Payment required'));
    expect(c.reason).toBe(FailoverReason.Billing);
    expect(c.retryable).toBe(false);
    expect(c.shouldFallback).toBe(true);
  });

  it('402 with usage limit + transient signal → RateLimit', () => {
    const c = classifyError(apiError(402, 'usage limit exceeded, try again later'));
    expect(c.reason).toBe(FailoverReason.RateLimit);
    expect(c.retryable).toBe(true);
  });

  it('402 with usage limit + "resets at" → RateLimit', () => {
    const c = classifyError(apiError(402, 'usage limit reached, resets at midnight'));
    expect(c.reason).toBe(FailoverReason.RateLimit);
    expect(c.retryable).toBe(true);
  });

  it('402 with usage limit but no transient signal → Billing', () => {
    const c = classifyError(apiError(402, 'usage limit exceeded permanently'));
    expect(c.reason).toBe(FailoverReason.Billing);
    expect(c.retryable).toBe(false);
  });

  it('404 → ModelNotFound, shouldFallback', () => {
    const c = classifyError(apiError(404, 'Not found'));
    expect(c.reason).toBe(FailoverReason.ModelNotFound);
    expect(c.retryable).toBe(false);
    expect(c.shouldFallback).toBe(true);
  });

  it('413 → PayloadTooLarge, shouldCompress', () => {
    const c = classifyError(apiError(413, 'Request entity too large'));
    expect(c.reason).toBe(FailoverReason.PayloadTooLarge);
    expect(c.retryable).toBe(false);
    expect(c.shouldCompress).toBe(true);
  });

  it('429 → RateLimit, retryable', () => {
    const c = classifyError(apiError(429, 'Too many requests'));
    expect(c.reason).toBe(FailoverReason.RateLimit);
    expect(c.retryable).toBe(true);
  });

  it('400 with context overflow message → ContextOverflow', () => {
    const c = classifyError(apiError(400, "prompt is too long (context length exceeded)"));
    expect(c.reason).toBe(FailoverReason.ContextOverflow);
    expect(c.shouldCompress).toBe(true);
    expect(c.retryable).toBe(false);
  });

  it('400 with token limit message → ContextOverflow', () => {
    const c = classifyError(apiError(400, 'too many tokens in request'));
    expect(c.reason).toBe(FailoverReason.ContextOverflow);
  });

  it('400 without overflow pattern → FormatError', () => {
    const c = classifyError(apiError(400, 'Invalid JSON in request body'));
    expect(c.reason).toBe(FailoverReason.FormatError);
    expect(c.retryable).toBe(false);
  });

  it('500 → ServerError, retryable + shouldFallback', () => {
    const c = classifyError(apiError(500, 'Internal server error'));
    expect(c.reason).toBe(FailoverReason.ServerError);
    expect(c.retryable).toBe(true);
    expect(c.shouldFallback).toBe(true);
  });

  it('502 → ServerError', () => {
    const c = classifyError(apiError(502, 'Bad gateway'));
    expect(c.reason).toBe(FailoverReason.ServerError);
    expect(c.retryable).toBe(true);
  });

  it('503 → Overloaded', () => {
    const c = classifyError(apiError(503, 'Service unavailable'));
    expect(c.reason).toBe(FailoverReason.Overloaded);
    expect(c.retryable).toBe(true);
    expect(c.shouldFallback).toBe(true);
  });

  it('529 → Overloaded', () => {
    const c = classifyError(apiError(529, 'Overloaded'));
    expect(c.reason).toBe(FailoverReason.Overloaded);
  });
});

// ---------------------------------------------------------------------------
// Status code extraction variants
// ---------------------------------------------------------------------------

describe('classifyError – status code extraction', () => {
  it('reads status_code (snake_case)', () => {
    const c = classifyError(apiErrorSnake(429, 'Rate limited'));
    expect(c.reason).toBe(FailoverReason.RateLimit);
    expect(c.statusCode).toBe(429);
  });

  it('walks the .cause chain for status codes', () => {
    const c = classifyError(causedError(503, 'Request failed'));
    expect(c.reason).toBe(FailoverReason.Overloaded);
    expect(c.statusCode).toBe(503);
  });

  it('ignores non-numeric status values', () => {
    const err = new Error('mystery') as Error & { status: string };
    err.status = 'bad' as unknown as string;
    const c = classifyError(err);
    expect(c.statusCode).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Message pattern matching (no status code)
// ---------------------------------------------------------------------------

describe('classifyError – message patterns', () => {
  it('billing pattern: "insufficient credits"', () => {
    const c = classifyError(new Error('You have insufficient credits'));
    expect(c.reason).toBe(FailoverReason.Billing);
    expect(c.retryable).toBe(false);
  });

  it('billing pattern: "billing hard limit"', () => {
    const c = classifyError(new Error('You hit your billing hard limit'));
    expect(c.reason).toBe(FailoverReason.Billing);
  });

  it('billing pattern: "exceeded your current quota"', () => {
    const c = classifyError(new Error('You exceeded your current quota'));
    expect(c.reason).toBe(FailoverReason.Billing);
  });

  it('rate limit pattern: "rate limit"', () => {
    const c = classifyError(new Error('rate limit exceeded'));
    expect(c.reason).toBe(FailoverReason.RateLimit);
    expect(c.retryable).toBe(true);
  });

  it('rate limit pattern: "throttled"', () => {
    const c = classifyError(new Error('Request was throttled'));
    expect(c.reason).toBe(FailoverReason.RateLimit);
  });

  it('context overflow pattern: "context length"', () => {
    const c = classifyError(new Error('Exceeds context length'));
    expect(c.reason).toBe(FailoverReason.ContextOverflow);
    expect(c.shouldCompress).toBe(true);
  });

  it('context overflow pattern: "max_tokens"', () => {
    const c = classifyError(new Error('max_tokens is too large'));
    expect(c.reason).toBe(FailoverReason.ContextOverflow);
  });

  it('auth pattern: "invalid api key"', () => {
    const c = classifyError(new Error('Invalid API key provided'));
    expect(c.reason).toBe(FailoverReason.Auth);
  });

  it('auth pattern: "access denied"', () => {
    const c = classifyError(new Error('Access denied to resource'));
    expect(c.reason).toBe(FailoverReason.Auth);
  });

  it('model not found: "model not found"', () => {
    const c = classifyError(new Error('model not found: gpt-5'));
    expect(c.reason).toBe(FailoverReason.ModelNotFound);
    expect(c.shouldFallback).toBe(true);
  });

  it('model not found: "does not exist"', () => {
    const c = classifyError(new Error('The model does not exist'));
    expect(c.reason).toBe(FailoverReason.ModelNotFound);
  });

  it('auth patterns take priority over rate limit patterns', () => {
    // "unauthorized" matches auth, even if there were rate limit keywords too
    const c = classifyError(new Error('unauthorized'));
    expect(c.reason).toBe(FailoverReason.Auth);
  });
});

// ---------------------------------------------------------------------------
// Transport errors
// ---------------------------------------------------------------------------

describe('classifyError – transport errors', () => {
  it('TimeoutError name → Timeout', () => {
    const err = new Error('The operation timed out');
    err.name = 'TimeoutError';
    const c = classifyError(err);
    expect(c.reason).toBe(FailoverReason.Timeout);
    expect(c.retryable).toBe(true);
  });

  it('AbortError name → Timeout', () => {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    const c = classifyError(err);
    expect(c.reason).toBe(FailoverReason.Timeout);
  });

  it('ECONNREFUSED message → Timeout', () => {
    const c = classifyError(new Error('connect ECONNREFUSED 127.0.0.1:443'));
    expect(c.reason).toBe(FailoverReason.Timeout);
    expect(c.retryable).toBe(true);
  });

  it('ECONNRESET → Timeout', () => {
    const c = classifyError(new Error('read ECONNRESET'));
    expect(c.reason).toBe(FailoverReason.Timeout);
  });

  it('socket hang up → Timeout', () => {
    const c = classifyError(new Error('socket hang up'));
    expect(c.reason).toBe(FailoverReason.Timeout);
  });

  it('fetch failed → Timeout', () => {
    const c = classifyError(new Error('fetch failed'));
    expect(c.reason).toBe(FailoverReason.Timeout);
  });
});

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

describe('classifyError – fallback', () => {
  it('unknown error → Unknown, retryable', () => {
    const c = classifyError(new Error('Something completely unexpected'));
    expect(c.reason).toBe(FailoverReason.Unknown);
    expect(c.retryable).toBe(true);
  });

  it('non-Error throw (string) → Unknown', () => {
    const c = classifyError('oops');
    expect(c.reason).toBe(FailoverReason.Unknown);
    expect(c.message).toBe('oops');
  });

  it('non-Error throw (number) → Unknown', () => {
    const c = classifyError(42);
    expect(c.reason).toBe(FailoverReason.Unknown);
  });

  it('null → Unknown', () => {
    const c = classifyError(null);
    expect(c.reason).toBe(FailoverReason.Unknown);
  });

  it('undefined → Unknown', () => {
    const c = classifyError(undefined);
    expect(c.reason).toBe(FailoverReason.Unknown);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('classifyError – edge cases', () => {
  it('preserves original error reference', () => {
    const orig = apiError(500, 'Boom');
    const c = classifyError(orig);
    expect(c.original).toBe(orig);
  });

  it('case-insensitive message matching', () => {
    const c = classifyError(new Error('RATE LIMIT EXCEEDED'));
    expect(c.reason).toBe(FailoverReason.RateLimit);
  });

  it('status code overrides message patterns (400 + "unauthorized" → FormatError)', () => {
    // Status 400 is handled before message patterns, so even if message
    // contains "unauthorized", the 400 branch (FormatError) wins.
    const c = classifyError(apiError(400, 'unauthorized field in body'));
    expect(c.reason).toBe(FailoverReason.FormatError);
  });
});
