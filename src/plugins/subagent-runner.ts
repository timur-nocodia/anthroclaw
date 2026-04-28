import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { RunSubagentOpts } from './types.js';

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * ЕДИНСТВЕННЫЙ путь к LLM для плагинов.
 * Использует SDK query() с maxTurns:1, tools:[], canUseTool: deny.
 * Гарантирует нативность: никаких прямых импортов @anthropic-ai/sdk,
 * никакого Messages API, никакого custom orchestration loop.
 */
export async function runSubagent(opts: RunSubagentOpts): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const sdkOptions: Options = {
    model: opts.model ?? 'claude-sonnet-4-6',
    cwd: opts.cwd ?? process.cwd(),
    tools: [],
    allowedTools: [],
    permissionMode: 'dontAsk',
    canUseTool: async () => ({
      behavior: 'deny',
      message: 'Tools disabled in plugin subagent.',
    }),
    settingSources: ['project'],
    persistSession: false,
    maxTurns: 1,
    systemPrompt: opts.systemPrompt
      ? { type: 'preset', preset: 'claude_code', excludeDynamicSections: true, append: opts.systemPrompt }
      : { type: 'preset', preset: 'claude_code', excludeDynamicSections: true },
  };

  const stream = query({ prompt: opts.prompt, options: sdkOptions });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let result = '';
  let resultFound = false;
  const accumulated: string[] = [];

  const completePromise = (async () => {
    try {
      for await (const evt of stream) {
        const e = evt as Record<string, unknown>;
        if (e.type === 'result' && typeof e.result === 'string') {
          result = e.result.trim();
          resultFound = true;
          break;
        }
        if (e.type === 'assistant') {
          const msg = e.message as { content?: Array<{ type?: string; text?: string }> } | undefined;
          if (msg?.content) {
            for (const block of msg.content) {
              if (block.type === 'text' && typeof block.text === 'string') {
                accumulated.push(block.text);
              }
            }
          }
        }
      }
    } finally {
      stream.close?.();
    }
  })();

  const timeoutPromise = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => {
      reject(new Error(`runSubagent timeout after ${timeoutMs}ms`));
    });
  });

  try {
    await Promise.race([completePromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }

  if (!resultFound) {
    result = accumulated.join('').trim();
  }

  if (!result) {
    throw new Error('runSubagent returned empty result');
  }

  return result;
}
