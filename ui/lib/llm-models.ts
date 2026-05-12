export const OPENAI_TEXT_MODELS = [
  "gpt-5.4-nano",
  "gpt-5.4-mini",
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5.5-pro",
] as const;

export const ANTHROPIC_API_MODELS = [
  "claude-haiku-4-5",
  "claude-sonnet-4-6",
  "claude-opus-4-7",
] as const;

export const DEFAULT_HONCHO_LLM_PROVIDER = "openai";
export const DEFAULT_HONCHO_OPENAI_MODEL = "gpt-5.4-mini";
export const DEFAULT_HONCHO_ANTHROPIC_MODEL = "claude-haiku-4-5";

export type LlmProvider = "openai" | "anthropic";

export function modelsForProvider(provider: string | undefined): readonly string[] {
  return provider === "anthropic" ? ANTHROPIC_API_MODELS : OPENAI_TEXT_MODELS;
}
