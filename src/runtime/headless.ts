import type { RuntimeId } from './types.js';

export const DEFAULT_HEADLESS_TIMEOUT_MS = 60_000;

export interface HeadlessRuntimeDefaults {
  model?: string;
  cwd?: string;
  timeoutMs?: number;
  allowedTools?: string[];
}

export interface HeadlessRunInput {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  cwd?: string;
  timeoutMs?: number;
  runtimeDefaults?: HeadlessRuntimeDefaults;
  purpose?: string;
  toolDenyMessage?: string;
}

export interface HeadlessRuntime {
  id: RuntimeId;
  runText(input: HeadlessRunInput): Promise<string>;
}
