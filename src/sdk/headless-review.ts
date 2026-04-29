import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Options } from '@anthropic-ai/claude-agent-sdk';

const DEFAULT_TIMEOUT_MS = 60_000;

export interface HeadlessReviewOptions {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  cwd?: string;
  timeoutMs?: number;
  purpose?: string;
  toolDenyMessage?: string;
}

/**
 * Run a non-user-facing review call through the native Claude Agent SDK.
 *
 * This is intentionally not a general agent loop. It is a single-turn,
 * tool-denied SDK query used for summarizers, plugin subagents, and learning
 * reviewers.
 */
export async function runHeadlessReview(opts: HeadlessReviewOptions): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const purpose = opts.purpose ?? 'headless review';

  const sdkOptions: Options = {
    model: opts.model ?? 'claude-sonnet-4-6',
    cwd: opts.cwd ?? process.cwd(),
    tools: [],
    allowedTools: [],
    permissionMode: 'dontAsk',
    canUseTool: async () => ({
      behavior: 'deny',
      message: opts.toolDenyMessage ?? `Tools disabled for ${purpose}.`,
    }),
    abortController: controller,
    settingSources: ['project'],
    persistSession: false,
    maxTurns: 1,
    systemPrompt: opts.systemPrompt
      ? { type: 'preset', preset: 'claude_code', excludeDynamicSections: true, append: opts.systemPrompt }
      : { type: 'preset', preset: 'claude_code', excludeDynamicSections: true },
  };

  const stream = query({ prompt: opts.prompt, options: sdkOptions });
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let result = '';
  let resultFound = false;
  const accumulated: string[] = [];

  const completePromise = (async () => {
    for await (const evt of stream) {
      const e = evt as Record<string, unknown>;

      const isErrorResult = e.type === 'result' && Boolean((e as { is_error?: boolean }).is_error);
      if (isErrorResult) {
        const errors = (e as { errors?: string[] }).errors ?? [];
        const subtype = (e as { subtype?: string }).subtype ?? 'unknown';
        throw new Error(`${purpose} LLM error (${subtype}): ${errors.join('; ') || subtype}`);
      }

      if (e.type === 'result' && typeof e.result === 'string') {
        result = e.result.trim();
        resultFound = true;
        break;
      }

      if (e.type === 'assistant') {
        const msg = e.message as { content?: Array<{ type?: string; text?: string }> } | undefined;
        if (!msg?.content) continue;
        for (const block of msg.content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            accumulated.push(block.text);
          }
        }
      }
    }
  })();

  const timeoutPromise = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => {
      reject(new Error(`${purpose} timeout after ${timeoutMs}ms`));
    });
  });

  try {
    await Promise.race([completePromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
    stream.close?.();
  }

  if (!resultFound) {
    result = accumulated.join('').trim();
  }

  if (!result) {
    throw new Error(`${purpose} returned empty result`);
  }

  return result;
}
