/**
 * Secret redaction — detects and masks API keys, tokens, and generic secrets
 * in free-form text before it reaches logs, LLM context, or end users.
 */

// ---------------------------------------------------------------------------
// Pattern definitions
// ---------------------------------------------------------------------------

/** A pattern whose full match is the secret token. */
interface FullMatchPattern {
  regex: RegExp;
  kind: 'full';
}

/** A pattern where group(1) is a non-secret prefix and group(2) is the value. */
interface ValueGroupPattern {
  regex: RegExp;
  kind: 'value-group';
}

type SecretPattern = FullMatchPattern | ValueGroupPattern;

const PATTERNS: SecretPattern[] = [
  // Anthropic
  { regex: /sk-ant-[a-zA-Z0-9_-]{20,}/g, kind: 'full' },
  // OpenAI project keys (must be before generic sk-)
  { regex: /sk-proj-[a-zA-Z0-9_-]{20,}/g, kind: 'full' },
  // OpenAI generic
  { regex: /sk-[a-zA-Z0-9_-]{20,}/g, kind: 'full' },
  // GitHub PAT variants
  { regex: /ghp_[a-zA-Z0-9]{36,}/g, kind: 'full' },
  { regex: /gho_[a-zA-Z0-9]{36,}/g, kind: 'full' },
  { regex: /github_pat_[a-zA-Z0-9_]{22,}/g, kind: 'full' },
  // Slack
  { regex: /xox[bsrpa]-[a-zA-Z0-9-]{10,}/g, kind: 'full' },
  // Google
  { regex: /AIza[a-zA-Z0-9_-]{35}/g, kind: 'full' },
  // AWS
  { regex: /AKIA[A-Z0-9]{16}/g, kind: 'full' },
  // Stripe
  { regex: /sk_live_[a-zA-Z0-9]{24,}/g, kind: 'full' },
  { regex: /rk_live_[a-zA-Z0-9]{24,}/g, kind: 'full' },
  // Fal.ai
  { regex: /fal_[a-zA-Z0-9_-]{20,}/g, kind: 'full' },
  // Generic long secrets (redact value only)
  {
    regex: /(?:api[_-]?key|token|secret|password)["':\s=]+([a-zA-Z0-9_-]{20,})/gi,
    kind: 'value-group',
  },
];

// ---------------------------------------------------------------------------
// Masking helper
// ---------------------------------------------------------------------------

function mask(token: string): string {
  if (token.length < 18) {
    return '[REDACTED]';
  }
  return token.slice(0, 6) + '****' + token.slice(-4);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan `text` for known secret patterns and return a copy with secrets masked.
 *
 * Masking rules:
 * - Tokens shorter than 18 characters: replaced entirely with `[REDACTED]`
 * - Tokens >= 18 characters: first 6 chars + `****` + last 4 chars
 */
export function redactSecrets(text: string): string {
  let result = text;

  for (const pattern of PATTERNS) {
    // Reset lastIndex so the regex starts from the beginning each time.
    const re = new RegExp(pattern.regex.source, pattern.regex.flags);

    if (pattern.kind === 'full') {
      result = result.replace(re, (match) => mask(match));
    } else {
      // value-group: only mask the captured value, keep the prefix label.
      result = result.replace(re, (fullMatch, value: string) => {
        const prefix = fullMatch.slice(0, fullMatch.length - value.length);
        return prefix + mask(value);
      });
    }
  }

  return result;
}
