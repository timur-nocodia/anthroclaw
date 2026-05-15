import type { RunSubagentOpts } from './types.js';
import { runHeadlessReview } from '../sdk/headless-review.js';

/**
 * ЕДИНСТВЕННЫЙ путь к headless LLM для плагинов.
 * Идет через runtime contract с maxTurns:1-equivalent, tools:[], canUseTool: deny.
 * Гарантирует нативность: никаких прямых импортов provider SDK,
 * никакого Messages API в обход harness, никакого custom orchestration loop.
 */
export async function runSubagent(opts: RunSubagentOpts): Promise<string> {
  return runHeadlessReview({
    ...opts,
    purpose: 'runSubagent',
    toolDenyMessage: 'Tools disabled in plugin subagent.',
  });
}
