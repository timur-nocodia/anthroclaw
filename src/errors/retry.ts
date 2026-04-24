/**
 * Jittered exponential backoff and retry wrapper.
 *
 * Pairs with {@link classifyError} to only retry errors that are marked
 * retryable, applying exponential backoff with uniform jitter.
 */

import { classifyError, type ClassifiedError } from './classifier.js';
import { logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Backoff
// ---------------------------------------------------------------------------

export interface BackoffOptions {
  /** Base delay in ms (default 5000). */
  baseDelay?: number;
  /** Maximum delay in ms (default 120000). */
  maxDelay?: number;
  /** Jitter as fraction of computed delay (default 0.5). */
  jitterRatio?: number;
}

/**
 * Compute jittered exponential backoff delay in milliseconds.
 *
 * Formula: `min(base * 2^(attempt-1), max) + uniform(0, jitterRatio * delay)`
 *
 * @param attempt 1-based attempt number (first retry = 1).
 */
export function jitteredBackoff(
  attempt: number,
  opts?: BackoffOptions,
): number {
  const base = opts?.baseDelay ?? 5_000;
  const max = opts?.maxDelay ?? 120_000;
  const jitter = opts?.jitterRatio ?? 0.5;

  const exponential = Math.min(base * 2 ** (attempt - 1), max);
  const jitterAmount = Math.random() * jitter * exponential;
  return exponential + jitterAmount;
}

// ---------------------------------------------------------------------------
// Retry wrapper
// ---------------------------------------------------------------------------

export interface RetryOptions extends BackoffOptions {
  /** Maximum number of attempts (default 3). Includes the initial call. */
  maxAttempts?: number;
  /** Called after each failed attempt with the classified error. */
  onClassified?: (classified: ClassifiedError, attempt: number) => void;
}

/**
 * Execute `fn` with automatic retry on retryable errors.
 *
 * Each failure is classified via {@link classifyError}. If the classified
 * error is not retryable, it is thrown immediately. Otherwise the wrapper
 * waits {@link jitteredBackoff} ms before the next attempt. After all
 * attempts are exhausted the last error is thrown.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions,
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? 3;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const classified = classifyError(err);

      opts?.onClassified?.(classified, attempt);

      logger.warn(
        {
          attempt,
          maxAttempts,
          reason: classified.reason,
          retryable: classified.retryable,
          statusCode: classified.statusCode,
        },
        `withRetry: attempt ${attempt}/${maxAttempts} failed — ${classified.reason}`,
      );

      if (!classified.retryable) {
        throw err;
      }

      if (attempt < maxAttempts) {
        const delay = jitteredBackoff(attempt, opts);
        await sleep(delay);
      }
    }
  }

  // All attempts exhausted — throw the last error.
  throw lastError;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
