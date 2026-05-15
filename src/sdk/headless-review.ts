import { claudeAgentHeadlessRuntime } from '../runtime/claude-agent-sdk.js';
import type { HeadlessRunInput, HeadlessRuntime } from '../runtime/headless.js';

export interface HeadlessReviewOptions extends HeadlessRunInput {
  runtime?: HeadlessRuntime;
}

/**
 * Run a non-user-facing single-turn review call through the configured
 * headless runtime.
 */
export async function runHeadlessReview(opts: HeadlessReviewOptions): Promise<string> {
  const { runtime, ...input } = opts;
  return (runtime ?? claudeAgentHeadlessRuntime).runText(input);
}
