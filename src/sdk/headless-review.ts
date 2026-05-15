import type { HeadlessRunInput } from '../runtime/headless.js';
import {
  resolveHeadlessRuntime,
  type HeadlessRuntimeResolverOptions,
  type HeadlessRuntimeSelection,
} from '../runtime/headless-registry.js';

export interface HeadlessReviewOptions extends HeadlessRunInput {
  runtime?: HeadlessRuntimeSelection;
  runtimeOptions?: HeadlessRuntimeResolverOptions;
}

/**
 * Run a non-user-facing single-turn review call through the configured
 * headless runtime.
 */
export async function runHeadlessReview(opts: HeadlessReviewOptions): Promise<string> {
  const { runtime, runtimeOptions, ...input } = opts;
  return resolveHeadlessRuntime(runtime, runtimeOptions).runText(input);
}
