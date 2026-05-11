import type { HonchoConfig } from './config.js';

const SECRET_PATTERNS: Array<{ regex: RegExp; valueGroup?: boolean }> = [
  { regex: /sk-ant-[a-zA-Z0-9_-]{20,}/g },
  { regex: /sk-proj-[a-zA-Z0-9_-]{20,}/g },
  { regex: /sk-[a-zA-Z0-9_-]{20,}/g },
  { regex: /ghp_[a-zA-Z0-9]{36,}/g },
  { regex: /gho_[a-zA-Z0-9]{36,}/g },
  { regex: /github_pat_[a-zA-Z0-9_]{22,}/g },
  { regex: /xox[bsrpa]-[a-zA-Z0-9-]{10,}/g },
  { regex: /AIza[a-zA-Z0-9_-]{35}/g },
  { regex: /AKIA[A-Z0-9]{16}/g },
  { regex: /sk_live_[a-zA-Z0-9]{24,}/g },
  { regex: /rk_live_[a-zA-Z0-9]{24,}/g },
  { regex: /fal_[a-zA-Z0-9_-]{20,}/g },
  {
    regex: /(?:api[_-]?key|token|secret|password)["':\s=]+([a-zA-Z0-9_-]{20,})/gi,
    valueGroup: true,
  },
];

export function sanitizeMessageText(text: string, config: HonchoConfig): string {
  let clean = text.replace(/\r\n/g, '\n');

  if (config.privacy.strip_prompt_context_blocks) {
    clean = stripContextBlocks(clean);
  }
  if (config.privacy.strip_tool_progress) {
    clean = clean
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('▶'))
      .join('\n');
  }
  if (config.privacy.redact_secrets) {
    clean = redactSecrets(clean);
  }

  clean = clean
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();

  return capText(clean, config.observe.max_message_chars);
}

function stripContextBlocks(text: string): string {
  return text
    .replace(/<memory-context\b[^>]*>[\s\S]*?<\/memory-context>/gi, '')
    .replace(/<lcm-context-[a-f0-9]+\b[^>]*>[\s\S]*?<\/lcm-context-[a-f0-9]+>/gi, '')
    .replace(/<honcho-context-[a-zA-Z0-9_-]+\b[^>]*>[\s\S]*?<\/honcho-context-[a-zA-Z0-9_-]+>/gi, '');
}

function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    if (pattern.valueGroup) {
      result = result.replace(regex, (full, value: string) => {
        const prefix = full.slice(0, full.length - value.length);
        return `${prefix}${maskSecret(value)}`;
      });
    } else {
      result = result.replace(regex, (match) => maskSecret(match));
    }
  }
  return result;
}

function maskSecret(value: string): string {
  if (value.length < 18) return '[REDACTED]';
  return `${value.slice(0, 6)}****${value.slice(-4)}`;
}

function capText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const suffix = '\n[truncated]';
  return `${text.slice(0, Math.max(0, maxChars - suffix.length)).trimEnd()}${suffix}`;
}
