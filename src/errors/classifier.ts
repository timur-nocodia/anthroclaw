/**
 * Error classification pipeline for API errors.
 *
 * Extracts a structured {@link ClassifiedError} from any thrown value,
 * walking the `.cause` chain for status codes and applying priority-ordered
 * pattern matching to produce actionable recovery hints.
 */

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

export enum FailoverReason {
  Auth = 'Auth',
  Billing = 'Billing',
  RateLimit = 'RateLimit',
  Overloaded = 'Overloaded',
  ServerError = 'ServerError',
  Timeout = 'Timeout',
  ContextOverflow = 'ContextOverflow',
  PayloadTooLarge = 'PayloadTooLarge',
  ModelNotFound = 'ModelNotFound',
  FormatError = 'FormatError',
  Unknown = 'Unknown',
}

export interface ClassifiedError {
  reason: FailoverReason;
  statusCode?: number;
  message: string;
  retryable: boolean;
  shouldCompress: boolean;
  shouldFallback: boolean;
  original: unknown;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Walk the error / cause chain to find a numeric HTTP status code. */
function extractStatusCode(err: unknown): number | undefined {
  let cur: unknown = err;
  for (let depth = 0; depth < 10 && cur != null; depth++) {
    if (typeof cur === 'object' && cur !== null) {
      const obj = cur as Record<string, unknown>;
      for (const key of ['status', 'status_code', 'statusCode']) {
        const v = obj[key];
        if (typeof v === 'number' && v >= 100 && v < 600) return v;
      }
      cur = obj['cause'] ?? undefined;
    } else {
      break;
    }
  }
  return undefined;
}

/** Coerce an unknown throwable to a lowered message string. */
function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return String(err);
  } catch {
    return 'unknown error';
  }
}

// ---------------------------------------------------------------------------
// Pattern sets (all lowercase for case-insensitive matching)
// ---------------------------------------------------------------------------

const BILLING_PATTERNS = [
  'insufficient credits',
  'payment required',
  'billing hard limit',
  'exceeded your current quota',
] as const;

const RATE_LIMIT_PATTERNS = [
  'rate limit',
  'too many requests',
  'throttled',
  'try again in',
] as const;

const CONTEXT_OVERFLOW_PATTERNS = [
  'context length',
  'token limit',
  'too many tokens',
  'prompt is too long',
  'max_tokens',
] as const;

const AUTH_PATTERNS = [
  'invalid api key',
  'unauthorized',
  'forbidden',
  'access denied',
] as const;

const MODEL_NOT_FOUND_PATTERNS = [
  'model not found',
  'invalid model',
  'does not exist',
] as const;

const TRANSIENT_SIGNAL_PATTERNS = [
  'try again',
  'retry',
  'resets at',
] as const;

function matchesAny(msg: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => msg.includes(p));
}

// ---------------------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------------------

function build(
  reason: FailoverReason,
  opts: {
    statusCode?: number;
    message: string;
    retryable?: boolean;
    shouldCompress?: boolean;
    shouldFallback?: boolean;
    original: unknown;
  },
): ClassifiedError {
  return {
    reason,
    statusCode: opts.statusCode,
    message: opts.message,
    retryable: opts.retryable ?? false,
    shouldCompress: opts.shouldCompress ?? false,
    shouldFallback: opts.shouldFallback ?? false,
    original: opts.original,
  };
}

// ---------------------------------------------------------------------------
// Transport-error detection
// ---------------------------------------------------------------------------

const TIMEOUT_NAMES = new Set([
  'TimeoutError',
  'AbortError',
  'ConnectTimeoutError',
  'UND_ERR_CONNECT_TIMEOUT',
]);

const CONNECTION_PATTERNS = [
  'econnrefused',
  'econnreset',
  'epipe',
  'enotfound',
  'etimedout',
  'socket hang up',
  'network error',
  'fetch failed',
] as const;

function isTransportError(err: unknown, msg: string): boolean {
  if (err instanceof Error && TIMEOUT_NAMES.has(err.name)) return true;
  return matchesAny(msg, [...CONNECTION_PATTERNS]);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify an unknown thrown value into a structured error with recovery hints.
 *
 * Priority pipeline:
 *  1. Extract HTTP status code
 *  2. Status-code based classification
 *  3. Message pattern matching
 *  4. Transport error detection
 *  5. Fallback to Unknown (retryable)
 */
export function classifyError(err: unknown): ClassifiedError {
  const statusCode = extractStatusCode(err);
  const message = extractMessage(err);
  const msgLower = message.toLowerCase();

  // ---- Step 2: HTTP status code classification ----------------------------

  if (statusCode !== undefined) {
    switch (statusCode) {
      case 401:
        return build(FailoverReason.Auth, {
          statusCode,
          message,
          retryable: false,
          original: err,
        });

      case 402: {
        // 402 disambiguation: transient usage-limit vs hard billing stop
        const isUsageLimit = msgLower.includes('usage limit');
        const hasTransient = matchesAny(msgLower, [...TRANSIENT_SIGNAL_PATTERNS]);
        if (isUsageLimit && hasTransient) {
          return build(FailoverReason.RateLimit, {
            statusCode,
            message,
            retryable: true,
            original: err,
          });
        }
        return build(FailoverReason.Billing, {
          statusCode,
          message,
          retryable: false,
          shouldFallback: true,
          original: err,
        });
      }

      case 404:
        return build(FailoverReason.ModelNotFound, {
          statusCode,
          message,
          retryable: false,
          shouldFallback: true,
          original: err,
        });

      case 413:
        return build(FailoverReason.PayloadTooLarge, {
          statusCode,
          message,
          retryable: false,
          shouldCompress: true,
          original: err,
        });

      case 429:
        return build(FailoverReason.RateLimit, {
          statusCode,
          message,
          retryable: true,
          original: err,
        });

      case 400: {
        // Check for context overflow patterns before generic format error
        if (matchesAny(msgLower, [...CONTEXT_OVERFLOW_PATTERNS])) {
          return build(FailoverReason.ContextOverflow, {
            statusCode,
            message,
            retryable: false,
            shouldCompress: true,
            original: err,
          });
        }
        return build(FailoverReason.FormatError, {
          statusCode,
          message,
          retryable: false,
          original: err,
        });
      }

      case 500:
      case 502:
        return build(FailoverReason.ServerError, {
          statusCode,
          message,
          retryable: true,
          shouldFallback: true,
          original: err,
        });

      case 503:
      case 529:
        return build(FailoverReason.Overloaded, {
          statusCode,
          message,
          retryable: true,
          shouldFallback: true,
          original: err,
        });
    }
  }

  // ---- Step 3: Message pattern matching -----------------------------------

  if (matchesAny(msgLower, [...AUTH_PATTERNS])) {
    return build(FailoverReason.Auth, {
      statusCode,
      message,
      retryable: false,
      original: err,
    });
  }

  if (matchesAny(msgLower, [...BILLING_PATTERNS])) {
    return build(FailoverReason.Billing, {
      statusCode,
      message,
      retryable: false,
      shouldFallback: true,
      original: err,
    });
  }

  if (matchesAny(msgLower, [...RATE_LIMIT_PATTERNS])) {
    return build(FailoverReason.RateLimit, {
      statusCode,
      message,
      retryable: true,
      original: err,
    });
  }

  if (matchesAny(msgLower, [...CONTEXT_OVERFLOW_PATTERNS])) {
    return build(FailoverReason.ContextOverflow, {
      statusCode,
      message,
      retryable: false,
      shouldCompress: true,
      original: err,
    });
  }

  if (matchesAny(msgLower, [...MODEL_NOT_FOUND_PATTERNS])) {
    return build(FailoverReason.ModelNotFound, {
      statusCode,
      message,
      retryable: false,
      shouldFallback: true,
      original: err,
    });
  }

  // ---- Step 4: Transport errors -------------------------------------------

  if (isTransportError(err, msgLower)) {
    return build(FailoverReason.Timeout, {
      statusCode,
      message,
      retryable: true,
      original: err,
    });
  }

  // ---- Step 5: Fallback ---------------------------------------------------

  return build(FailoverReason.Unknown, {
    statusCode,
    message,
    retryable: true,
    original: err,
  });
}
