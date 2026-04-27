export type ToolProgress = 'all' | 'new' | 'off';

export interface DisplayConfig {
  toolProgress: ToolProgress;
  streaming: boolean;
  toolPreviewLength: number;
  showReasoning: boolean;
}

const PLATFORM_DEFAULTS: Record<string, DisplayConfig> = {
  // Tool-progress / verbose surfacing is OFF by default on every platform.
  // It's a debug/dev affordance — for production conversational agents it
  // looks like log spam to the end user (especially in WhatsApp DMs and
  // public Telegram groups). Opt in per-agent via agent.yml:
  //   display:
  //     toolProgress: all   # every tool call posts a status line
  //     toolProgress: new   # only the first call of each tool name
  // Per-platform `streaming` and `toolPreviewLength` defaults are kept since
  // those affect rendering, not whether internal trace leaks to the user.
  telegram: { toolProgress: 'off', streaming: true, toolPreviewLength: 40, showReasoning: false },
  whatsapp: { toolProgress: 'off', streaming: false, toolPreviewLength: 0, showReasoning: false },
};

const GLOBAL_DEFAULTS: DisplayConfig = {
  toolProgress: 'off',
  streaming: false,
  toolPreviewLength: 0,
  showReasoning: false,
};

/**
 * Resolve display config with tiered defaults.
 * Resolution order: overrides > PLATFORM_DEFAULTS[platform] > GLOBAL_DEFAULTS
 * For each field: first non-undefined value wins.
 */
export function resolveDisplayConfig(
  platform: string,
  overrides?: Partial<DisplayConfig>,
): DisplayConfig {
  const platformDefaults = PLATFORM_DEFAULTS[platform];
  return {
    toolProgress: overrides?.toolProgress ?? platformDefaults?.toolProgress ?? GLOBAL_DEFAULTS.toolProgress,
    streaming: overrides?.streaming ?? platformDefaults?.streaming ?? GLOBAL_DEFAULTS.streaming,
    toolPreviewLength: overrides?.toolPreviewLength ?? platformDefaults?.toolPreviewLength ?? GLOBAL_DEFAULTS.toolPreviewLength,
    showReasoning: overrides?.showReasoning ?? platformDefaults?.showReasoning ?? GLOBAL_DEFAULTS.showReasoning,
  };
}
