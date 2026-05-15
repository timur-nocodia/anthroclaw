import type { RuntimeId } from './types.js';

export const DEFAULT_HEADLESS_TIMEOUT_MS = 60_000;

export interface HeadlessRuntimeDefaults {
  model?: string;
  cwd?: string;
  timeoutMs?: number;
  allowedTools?: string[];
}

export interface HeadlessToolCall {
  toolName: string;
  originalToolName: string;
  toolCallId?: string;
  input: Record<string, unknown>;
}

export type HeadlessToolDecision =
  | boolean
  | { behavior: 'allow' | 'deny'; message?: string; reason?: string }
  | { allow: boolean; message?: string; reason?: string }
  | undefined;

export type HeadlessCanUseTool = (
  toolCall: HeadlessToolCall,
  input: HeadlessRunInput,
) => HeadlessToolDecision | Promise<HeadlessToolDecision>;

export type HeadlessToolPolicy =
  | { mode: 'deny' }
  | {
      mode: 'allow-list';
      tools: string[];
      canUseTool?: HeadlessCanUseTool;
      denyMessage?: string;
    };

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
  toolPolicy?: HeadlessToolPolicy;
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
