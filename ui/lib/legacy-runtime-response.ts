export const LEGACY_CLAUDE_RUNTIME_META = {
  legacyRuntime: true,
  runtimeRole: 'legacy-fallback',
  provider: 'claude-agent-sdk',
} as const;

export function withLegacyClaudeRuntimeMeta<T extends object>(body: T): T & typeof LEGACY_CLAUDE_RUNTIME_META {
  return {
    ...body,
    ...LEGACY_CLAUDE_RUNTIME_META,
  };
}
