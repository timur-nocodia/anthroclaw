/**
 * Token estimation. Uses tiktoken (cl100k_base) when available; otherwise
 * falls back to char/4 heuristic (matches hermes-lcm behavior).
 *
 * tiktoken is NOT a hard dep — keeps install footprint small. Plugin
 * works without it (slightly less accurate token counts, no functional impact).
 */

import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);

interface Tokenizer {
  encode(text: string): number[];
}

let cached: Tokenizer | null | undefined;

function loadTokenizer(): Tokenizer | null {
  if (cached !== undefined) return cached;
  try {
    const tiktoken = _require('tiktoken');
    const enc: Tokenizer = tiktoken.encoding_for_model('gpt-4') ?? tiktoken.get_encoding('cl100k_base');
    cached = enc;
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

export function hasNativeTokenizer(): boolean {
  return loadTokenizer() !== null;
}

export interface EstimateOpts {
  forceFallback?: boolean;
}

export function estimateTokens(text: string, opts: EstimateOpts = {}): number {
  if (text.length === 0) return 0;
  if (!opts.forceFallback) {
    const tk = loadTokenizer();
    if (tk) {
      try { return tk.encode(text).length; } catch { /* fall through */ }
    }
  }
  return Math.ceil(text.length / 4);
}
