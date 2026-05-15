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
  sessionId?: string;
  runtimeDefaults?: HeadlessRuntimeDefaults;
  purpose?: string;
  toolDenyMessage?: string;
}

export interface HeadlessRunResult {
  text: string;
  sessionId?: string;
}

export interface HeadlessRuntime {
  id: RuntimeId;
  run?(input: HeadlessRunInput): Promise<HeadlessRunResult>;
  runText(input: HeadlessRunInput): Promise<string>;
}
