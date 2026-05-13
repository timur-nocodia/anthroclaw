import type { ProfileName } from '../security/types.js';

export type ToolProgress = 'all' | 'new' | 'off';
export type SubagentTools = 'parent' | 'all' | 'indented';

export interface DisplayConfig {
  toolProgress: ToolProgress;
  streaming: boolean;
  toolPreviewLength: number;
  showReasoning: boolean;
  cleanupProgress: boolean;
  subagentTools: SubagentTools;
  toolEmojis?: Record<string, string>;
}

interface PlatformDefaults {
  streaming: boolean;
  toolPreviewLength: number;
}

// Platform-specific render concerns. Tool-progress visibility is NOT
// per-platform; it's per safety-profile (see below).
const PLATFORM_DEFAULTS: Record<string, PlatformDefaults> = {
  telegram: { streaming: true, toolPreviewLength: 40 },
  whatsapp: { streaming: false, toolPreviewLength: 0 },
};

const PLATFORM_FALLBACK: PlatformDefaults = { streaming: false, toolPreviewLength: 0 };

const HARDCODED_DEFAULTS = {
  showReasoning: false,
  cleanupProgress: false,
  subagentTools: 'parent' as SubagentTools,
};

/**
 * Resolve display config with tiered defaults.
 *
 * Resolution order (per field, first non-undefined wins):
 *   1. agent.yml display.*       (agentOverrides)
 *   2. config.yml defaults.display.* (globalDefaults)
 *   3. safety-profile default (toolProgress only: public→off, else→new)
 *   4. platform default (streaming, toolPreviewLength only)
 *   5. hardcoded fallback
 */
export function resolveDisplayConfig(
  platform: string,
  safetyProfile: ProfileName,
  agentOverrides?: Partial<DisplayConfig>,
  globalDefaults?: Partial<DisplayConfig>,
): DisplayConfig {
  const platformDefaults = PLATFORM_DEFAULTS[platform] ?? PLATFORM_FALLBACK;

  const safetyToolProgress: ToolProgress = safetyProfile === 'public' ? 'off' : 'new';

  return {
    toolProgress:
      agentOverrides?.toolProgress ??
      globalDefaults?.toolProgress ??
      safetyToolProgress,
    streaming:
      agentOverrides?.streaming ??
      globalDefaults?.streaming ??
      platformDefaults.streaming,
    toolPreviewLength:
      agentOverrides?.toolPreviewLength ??
      globalDefaults?.toolPreviewLength ??
      platformDefaults.toolPreviewLength,
    showReasoning:
      agentOverrides?.showReasoning ??
      globalDefaults?.showReasoning ??
      HARDCODED_DEFAULTS.showReasoning,
    cleanupProgress:
      agentOverrides?.cleanupProgress ??
      globalDefaults?.cleanupProgress ??
      HARDCODED_DEFAULTS.cleanupProgress,
    subagentTools:
      agentOverrides?.subagentTools ??
      globalDefaults?.subagentTools ??
      HARDCODED_DEFAULTS.subagentTools,
    toolEmojis:
      agentOverrides?.toolEmojis ??
      globalDefaults?.toolEmojis,
  };
}
