/**
 * Prompt injection detection — scans user/tool content for patterns
 * commonly used to override agent instructions or exfiltrate credentials.
 */

// ---------------------------------------------------------------------------
// Pattern definitions
// ---------------------------------------------------------------------------

interface ThreatPattern {
  regex: RegExp;
  description: string;
}

const THREAT_PATTERNS: ThreatPattern[] = [
  // Override instructions
  {
    regex: /ignore\s+(all\s+)?previous\s+instructions/i,
    description: 'Attempt to override previous instructions',
  },
  {
    regex: /disregard\s+(all\s+)?(prior|previous|above)/i,
    description: 'Attempt to disregard prior instructions',
  },
  {
    regex: /forget\s+(your|all)\s+instructions/i,
    description: 'Attempt to erase instructions',
  },
  {
    regex: /you\s+are\s+now\s+(?:a\s+)?different/i,
    description: 'Attempt to change agent identity',
  },

  // Hidden HTML instructions
  {
    regex: /<!--[\s\S]*?(override|instruction|ignore|system)[\s\S]*?-->/i,
    description: 'Hidden HTML comment with override instruction',
  },

  // Credential exfiltration via CLI tools
  {
    regex: /curl\s+.*-[dX]\s+.*(?:api[_-]?key|token|secret|password)/i,
    description: 'Credential exfiltration attempt via curl',
  },
  {
    regex: /wget\s+--post/i,
    description: 'Credential exfiltration attempt via wget',
  },

  // Invisible Unicode characters
  {
    regex: /[\u200B\u200C\u200D\u2060\u202A-\u202E\uFEFF]/,
    description: 'Invisible Unicode characters detected (potential obfuscation)',
  },

  // Encoded exfiltration
  {
    regex: /base64.*(?:key|token|secret|password)/i,
    description: 'Encoded credential exfiltration attempt',
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface InjectionScanResult {
  safe: boolean;
  threats: string[];
}

/**
 * Scan `content` for prompt injection patterns.
 *
 * @param content - The text to scan (user message, tool output, etc.)
 * @param source  - A human-readable label for where the content came from
 *                  (e.g. "user_message", "tool_output"). Included in logs.
 * @returns `{ safe: true, threats: [] }` if clean, otherwise the list of
 *          human-readable threat descriptions.
 */
export function scanForInjection(content: string, source: string): InjectionScanResult {
  const threats: string[] = [];

  for (const { regex, description } of THREAT_PATTERNS) {
    if (regex.test(content)) {
      threats.push(description);
    }
  }

  return {
    safe: threats.length === 0,
    threats,
  };
}
