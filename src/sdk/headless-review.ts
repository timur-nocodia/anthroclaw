import type { HeadlessRunInput, HeadlessRunResult } from '../runtime/headless.js';
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
  return (await runHeadlessReviewResult(opts)).text;
}

export async function runHeadlessReviewResult(opts: HeadlessReviewOptions): Promise<HeadlessRunResult> {
  const { runtime, runtimeOptions, ...input } = opts;
  const resolved = resolveHeadlessRuntime(runtime, runtimeOptions);
  if (resolved.run) return resolved.run(input);
  return {
    text: await resolved.runText(input),
  };
}
