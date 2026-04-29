/**
 * Canonical list of Anthropic models offered in dropdowns across the UI.
 * Single source of truth for both the agent config page and plugin config forms,
 * so plugin model fields surface the same options as the parent agent.
 */
export const ANTHROPIC_MODELS = [
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-haiku-4-5",
  "claude-sonnet-4-5",
  "claude-opus-4-7",
] as const;

export type AnthropicModel = (typeof ANTHROPIC_MODELS)[number];
