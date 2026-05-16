import { claudeAgentHeadlessRuntime } from './claude-agent-sdk.js';
import type { HeadlessRuntime } from './headless.js';
import { createOpenCodeHeadlessRuntime, type OpenCodeHeadlessRuntimeOptions } from './opencode-headless.js';
import { createPiHeadlessRuntime, type PiHeadlessRuntimeOptions } from './pi-headless.js';

export type BuiltInHeadlessRuntimeId = 'claude-agent-sdk' | 'pi' | 'opencode';
export type HeadlessRuntimeSelection = BuiltInHeadlessRuntimeId | HeadlessRuntime;

export interface HeadlessRuntimeResolverOptions {
  pi?: PiHeadlessRuntimeOptions;
  opencode?: OpenCodeHeadlessRuntimeOptions;
}

export function resolveHeadlessRuntime(
  runtime?: HeadlessRuntimeSelection,
  options: HeadlessRuntimeResolverOptions = {},
): HeadlessRuntime {
  if (!runtime || runtime === 'claude-agent-sdk') {
    return claudeAgentHeadlessRuntime;
  }

  if (runtime === 'pi') {
    return createPiHeadlessRuntime(options.pi);
  }

  if (runtime === 'opencode') {
    return createOpenCodeHeadlessRuntime(options.opencode);
  }

  if (isHeadlessRuntime(runtime)) {
    return runtime;
  }

  throw new Error(`Unknown headless runtime: ${String(runtime)}`);
}

function isHeadlessRuntime(value: unknown): value is HeadlessRuntime {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { id?: unknown }).id === 'string'
    && typeof (value as { runText?: unknown }).runText === 'function';
}

export function isBuiltInHeadlessRuntimeId(value: string): value is BuiltInHeadlessRuntimeId {
  return value === 'claude-agent-sdk' || value === 'pi' || value === 'opencode';
}
