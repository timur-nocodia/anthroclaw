import type { RunSubagentOpts } from './types.js';
import { runHeadlessReview } from '../sdk/headless-review.js';

/**
 * ЕДИНСТВЕННЫЙ путь к LLM для плагинов.
 * Использует SDK query() с maxTurns:1, tools:[], canUseTool: deny.
 * Гарантирует нативность: никаких прямых импортов @anthropic-ai/sdk,
 * никакого Messages API, никакого custom orchestration loop.
 */
export async function runSubagent(opts: RunSubagentOpts): Promise<string> {
  return runHeadlessReview({
    ...opts,
    purpose: 'runSubagent',
    toolDenyMessage: 'Tools disabled in plugin subagent.',
  });
}
